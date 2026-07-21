#!/usr/bin/env node
/**
 * Baixa as linhas municipais de ônibus de São Vicente operadas pela SOU.
 *
 * Caminho até a fonte: a página https://soutransportes.com.br/sao-vicente/linhas-e-horarios/
 * embute um iframe do app https://bus2.info/2you/#/3vc0l, que é um app Flutter
 * (renderiza em canvas, não dá para raspar o DOM). Os endpoints foram extraídos do
 * main.dart.js: o app consome a API pública mobilibus.com/api/*, com project_hash
 * "3vc0l" -> projectId 757 ("São Vicente, SP", agência SOU).
 *
 * robots.txt: soutransportes.com.br libera tudo menos /wp-admin/; bus2.info é
 * "Allow: /". As chamadas são espaçadas para não pesar no serviço.
 *
 * Saída: Bases/TRANSPORTE PUBLICO/sou_linhas_sao_vicente.json
 * Uso: node scripts/scrape-sou-transportes.js
 */
const fs = require("fs");
const path = require("path");

const API = "https://mobilibus.com/api";
const PROJECT_HASH = "3vc0l";
const OUT_DIR = path.join(__dirname, "..", "Bases", "TRANSPORTE PUBLICO");
const UA = "ObservatorioSaoVicente/1.0 (projeto de dados abertos)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tentativas = 3) {
  let erro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      erro = e;
      await sleep(1200 * (i + 1));
    }
  }
  throw new Error(`${erro.message} em ${url}`);
}

/**
 * Decodifica o formato "encoded polyline" do Google, usado no campo `shape`.
 * Devolve pares [lon, lat] na ordem do GeoJSON.
 */
function decodePolyline(str) {
  let i = 0, lat = 0, lon = 0;
  const pontos = [];
  while (i < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    pontos.push([lon / 1e5, lat / 1e5]);
  }
  return pontos;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Resolvendo projeto...");
  const proj = await get(`${API}/project-details?project_hash=${PROJECT_HASH}`);
  console.log(`  ${proj.name} (projectId ${proj.projectId}, agência ${proj.agencies?.[0]?.name})`);

  const rotasRaw = await get(`${API}/routes?origin=web&project_id=${proj.projectId}`);
  const rotas = Array.isArray(rotasRaw) ? rotasRaw : rotasRaw.routes || rotasRaw.data || [];
  console.log(`  ${rotas.length} linhas\n`);

  const linhas = [];
  const paradas = new Map(); // stopId -> parada (deduplicada entre linhas)

  for (const r of rotas) {
    process.stdout.write(`  ${String(r.shortName).padStart(5)} ${r.longName} ... `);
    try {
      const tt = await get(
        `${API}/timetable?origin=web&v=2&project_id=${proj.projectId}&route_id=${r.routeId}`
      );
      const trips = tt.timetable?.trips || [];

      // Conta as partidas por sentido para estimar a frequência da linha.
      const partidas = (tt.timetable?.directions || []).reduce(
        (acc, d) => acc + d.services.reduce((a, s) => a + s.departures.length, 0),
        0
      );

      const sentidos = [];
      for (const trip of trips) {
        await sleep(400);
        const det = await get(`${API}/trip-details?origin=web&v=2&trip_id=${trip.tripId}`);

        if (det.shape) {
          sentidos.push({
            trip_id: trip.tripId,
            sentido: trip.tripDesc || det.tripName || null,
            direction_id: trip.directionId,
            traçado: decodePolyline(det.shape),
            n_paradas: (det.stops || []).length,
          });
        }

        for (const s of det.stops || []) {
          if (!paradas.has(s.stopId)) {
            paradas.set(s.stopId, {
              stop_id: s.stopId,
              nome: s.name || null,
              lat: s.lat,
              lon: s.lng,
              linhas: [],
            });
          }
          const p = paradas.get(s.stopId);
          if (!p.linhas.includes(r.shortName)) p.linhas.push(r.shortName);
        }
      }

      linhas.push({
        route_id: r.routeId,
        linha: r.shortName,
        nome: r.longName,
        cor: r.color || null,
        partidas_semana: partidas,
        sentidos,
      });

      console.log(`${sentidos.length} sentido(s), ${partidas} partidas`);
    } catch (e) {
      console.log(`ERRO: ${e.message}`);
    }
    await sleep(600);
  }

  const totalPontos = linhas.reduce(
    (a, l) => a + l.sentidos.reduce((b, s) => b + s.traçado.length, 0),
    0
  );
  console.log(
    `\n${linhas.length} linhas, ${paradas.size} paradas distintas, ${totalPontos} vértices de traçado.`
  );

  const outFile = path.join(OUT_DIR, "sou_linhas_sao_vicente.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        fonte: "SOU Transportes / Bus2you — API pública mobilibus.com",
        pagina: "https://soutransportes.com.br/sao-vicente/linhas-e-horarios/",
        projeto: { id: proj.projectId, nome: proj.name, hash: PROJECT_HASH },
        coletado_em: new Date().toISOString().slice(0, 10),
        linhas,
        paradas: [...paradas.values()],
      },
      null,
      2
    )
  );
  console.log(`Salvo em ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

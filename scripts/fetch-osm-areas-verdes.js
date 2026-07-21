#!/usr/bin/env node
/**
 * Baixa áreas verdes e de lazer de São Vicente do OpenStreetMap (Overpass API).
 *
 * Substitui os arquivos "AREAS VERDE" e "PARQUES" originais, que eram polígonos
 * únicos desenhados à mão cobrindo ~91-100% do município inteiro (ver README,
 * seção "Qualidade das bases originais") e portanto inúteis como camada temática.
 *
 * Saída: Bases/AREAS VERDES OSM/osm_areas_verdes.geojson
 * Uso: node scripts/fetch-osm-areas-verdes.js
 */
const fs = require("fs");
const path = require("path");

const OVERPASS = "https://overpass-api.de/api/interpreter";
const AREA_ID = 3600297995; // relação OSM 297995 = São Vicente/SP
const OUT_DIR = path.join(__dirname, "..", "Bases", "AREAS VERDES OSM");

const QUERY = `
[out:json][timeout:300];
area(${AREA_ID})->.sv;
(
  way["leisure"~"^(park|garden|nature_reserve|pitch|playground|sports_centre)$"](area.sv);
  relation["leisure"~"^(park|garden|nature_reserve|sports_centre)$"](area.sv);
  way["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"](area.sv);
  relation["landuse"~"^(forest|grass|meadow|recreation_ground)$"](area.sv);
  way["natural"~"^(wood|scrub|wetland|beach)$"](area.sv);
  relation["natural"~"^(wood|scrub|wetland)$"](area.sv);
  way["boundary"="protected_area"](area.sv);
  relation["boundary"="protected_area"](area.sv);
);
out geom;
`;

/**
 * Classifica cada feição em duas dimensões: se conta como "área verde"
 * (vegetação/permeável) e se conta como "área de lazer" (uso público recreativo).
 */
function classificar(tags) {
  const { leisure, landuse, natural, boundary } = tags;

  if (leisure === "park") return { categoria: "Praça / parque urbano", verde: true, lazer: true };
  if (leisure === "garden") return { categoria: "Jardim", verde: true, lazer: true };
  if (leisure === "nature_reserve") return { categoria: "Reserva natural", verde: true, lazer: true };
  if (leisure === "playground") return { categoria: "Playground", verde: false, lazer: true };
  if (leisure === "pitch") return { categoria: "Quadra / campo esportivo", verde: false, lazer: true };
  if (leisure === "sports_centre") return { categoria: "Centro esportivo", verde: false, lazer: true };

  if (landuse === "forest") return { categoria: "Floresta / mata", verde: true, lazer: false };
  if (landuse === "grass" || landuse === "village_green")
    return { categoria: "Gramado / área verde", verde: true, lazer: false };
  if (landuse === "meadow") return { categoria: "Campo", verde: true, lazer: false };
  if (landuse === "recreation_ground")
    return { categoria: "Área de recreação", verde: true, lazer: true };

  if (natural === "wood") return { categoria: "Mata nativa", verde: true, lazer: false };
  if (natural === "scrub") return { categoria: "Vegetação arbustiva", verde: true, lazer: false };
  if (natural === "wetland") return { categoria: "Manguezal / área úmida", verde: true, lazer: false };
  if (natural === "beach") return { categoria: "Praia", verde: false, lazer: true };

  if (boundary === "protected_area")
    return { categoria: "Área de proteção ambiental", verde: true, lazer: false };

  return { categoria: "Outro", verde: false, lazer: false };
}

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ObservatorioSaoVicente/1.0 (projeto de dados abertos)",
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

const chave = (p) => `${p[0]},${p[1]}`;

/**
 * Junta os trechos ("ways") de uma relação multipolygon em anéis fechados.
 * O Overpass devolve os membros fora de ordem e com sentidos variados.
 */
function montarAneis(segmentos) {
  const pendentes = segmentos.map((s) => s.slice());
  const aneis = [];

  while (pendentes.length) {
    let atual = pendentes.shift();
    let mudou = true;
    while (mudou && chave(atual[0]) !== chave(atual[atual.length - 1])) {
      mudou = false;
      for (let i = 0; i < pendentes.length; i++) {
        const seg = pendentes[i];
        const fim = chave(atual[atual.length - 1]);
        const inicio = chave(atual[0]);
        if (chave(seg[0]) === fim) {
          atual = atual.concat(seg.slice(1));
        } else if (chave(seg[seg.length - 1]) === fim) {
          atual = atual.concat(seg.slice().reverse().slice(1));
        } else if (chave(seg[seg.length - 1]) === inicio) {
          atual = seg.slice(0, -1).concat(atual);
        } else if (chave(seg[0]) === inicio) {
          atual = seg.slice().reverse().slice(0, -1).concat(atual);
        } else {
          continue;
        }
        pendentes.splice(i, 1);
        mudou = true;
        break;
      }
    }
    if (atual.length >= 4 && chave(atual[0]) === chave(atual[atual.length - 1])) aneis.push(atual);
  }
  return aneis;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Consultando Overpass API...");
  const data = await overpass(QUERY);

  const features = [];
  let ignorados = 0;

  for (const el of data.elements) {
    const tags = el.tags || {};
    const cls = classificar(tags);
    const props = {
      osm_id: el.id,
      osm_tipo: el.type,
      nome: tags.name || null,
      categoria: cls.categoria,
      e_verde: cls.verde ? 1 : 0,
      e_lazer: cls.lazer ? 1 : 0,
      acesso: tags.access || null,
      operador: tags.operator || null,
    };

    let geometry = null;

    if (el.type === "way" && Array.isArray(el.geometry)) {
      const ring = el.geometry.map((p) => [p.lon, p.lat]);
      if (ring.length >= 4) {
        const fechado =
          chave(ring[0]) === chave(ring[ring.length - 1]) ? ring : ring.concat([ring[0]]);
        geometry = { type: "Polygon", coordinates: [fechado] };
      }
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      const outer = el.members
        .filter((m) => m.type === "way" && m.role !== "inner" && Array.isArray(m.geometry))
        .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
      const inner = el.members
        .filter((m) => m.type === "way" && m.role === "inner" && Array.isArray(m.geometry))
        .map((m) => m.geometry.map((p) => [p.lon, p.lat]));

      const aneisOuter = montarAneis(outer);
      const aneisInner = montarAneis(inner);
      if (aneisOuter.length) {
        geometry = {
          type: "MultiPolygon",
          // Cada anel externo vira um polígono; as ilhas entram no primeiro.
          coordinates: aneisOuter.map((a, i) => (i === 0 ? [a, ...aneisInner] : [a])),
        };
      }
    }

    if (!geometry) { ignorados++; continue; }
    features.push({ type: "Feature", properties: props, geometry });
  }

  const resumo = {};
  features.forEach((f) => {
    resumo[f.properties.categoria] = (resumo[f.properties.categoria] || 0) + 1;
  });
  console.log(`${features.length} feições montadas (${ignorados} sem geometria utilizável).`);
  console.table(resumo);

  const outFile = path.join(OUT_DIR, "osm_areas_verdes.geojson");
  fs.writeFileSync(
    outFile,
    JSON.stringify({
      type: "FeatureCollection",
      fonte: "OpenStreetMap via Overpass API",
      licenca: "ODbL 1.0 — © colaboradores do OpenStreetMap",
      coletado_em: new Date().toISOString().slice(0, 10),
      features,
    })
  );
  console.log(`Salvo em ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

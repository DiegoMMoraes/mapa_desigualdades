#!/usr/bin/env node
/**
 * Baixa as bases oficiais que substituem os polígonos desenhados à mão entregues
 * originalmente (Favelas.geojson, saude_2.geojson, inundação_2.geojson — todos um
 * único polígono de ~9 vértices cobrindo 72-80% do município, sem atributos).
 *
 *  - Favelas   -> IBGE, Censo 2022, "Favelas e Comunidades Urbanas" (malha oficial)
 *  - Saúde     -> Ministério da Saúde, CNES (API de dados abertos)
 *  - Inundação -> IBGE, "População em Áreas de Risco no Brasil" 2018 (BATER)
 *
 * Saídas em Bases/. Uso: node scripts/fetch-fontes-oficiais.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const shapefile = require("shapefile");
const { unzip } = require("./lib/unzip");

const BASES = path.join(__dirname, "..", "Bases");
const TMP = path.join(os.tmpdir(), "obs-sv-fontes");
const UA = "ObservatorioSaoVicente/1.0 (projeto de dados abertos)";

const CD_MUN = "3551009"; // São Vicente/SP no IBGE
const CD_MUN_CNES = "355100"; // mesmo código sem o dígito verificador (padrão DATASUS)

const FCU_URL =
  "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Favelas_e_comunidades_urbanas_Resultados_do_universo/arquivos_vetoriais/poligonos_FCUs_shp.zip";
const BATER_URL =
  "https://geoftp.ibge.gov.br/organizacao_do_territorio/tipologias_do_territorio/populacao_em_areas_de_risco_no_brasil/base_de_dados/PARBR2018_BATER.zip";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url, destino) {
  if (fs.existsSync(destino)) {
    console.log(`  (cache) ${path.basename(destino)}`);
    return fs.readFileSync(destino);
  }
  console.log(`  baixando ${path.basename(destino)}...`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buf);
  return buf;
}

/** Extrai o conjunto .shp/.dbf/.prj de dentro do ZIP para uma pasta temporária. */
function extrairShapefile(zipBuf, pasta) {
  const arquivos = unzip(zipBuf);
  fs.mkdirSync(pasta, { recursive: true });
  let base = null;
  for (const [nome, conteudo] of arquivos) {
    const simples = path.basename(nome);
    fs.writeFileSync(path.join(pasta, simples), conteudo);
    if (simples.toLowerCase().endsWith(".shp")) base = simples.replace(/\.shp$/i, "");
  }
  if (!base) throw new Error("nenhum .shp dentro do ZIP");
  return path.join(pasta, base);
}

async function lerShp(base, encoding = "utf-8") {
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding });
  const out = [];
  let r = await src.read();
  while (!r.done) {
    out.push(r.value);
    r = await src.read();
  }
  return out;
}

function salvar(pasta, arquivo, fc) {
  const dir = path.join(BASES, pasta);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, arquivo), JSON.stringify(fc));
  console.log(`  -> Bases/${pasta}/${arquivo} (${fc.features.length} feições)`);
}

// ---------------------------------------------------------------------------
async function favelas() {
  console.log("\n[1/3] Favelas e Comunidades Urbanas (IBGE, Censo 2022)");
  const zip = await baixar(FCU_URL, path.join(TMP, "poligonos_FCUs_shp.zip"));
  const base = extrairShapefile(zip, path.join(TMP, "fcu"));
  const todas = await lerShp(base, "utf-8");

  // Filtra pelo código do município: filtrar por nome pegaria "Vila São Vicente"
  // e afins em outros estados.
  const sv = todas.filter((f) => String(f.properties.cd_mun) === CD_MUN);
  console.log(`  ${todas.length} FCUs no Brasil, ${sv.length} em São Vicente`);

  salvar("FAVELAS IBGE", "favelas_ibge_2022.geojson", {
    type: "FeatureCollection",
    fonte: "IBGE — Censo 2022, Favelas e Comunidades Urbanas",
    url: FCU_URL,
    coletado_em: new Date().toISOString().slice(0, 10),
    features: sv.map((f) => ({
      type: "Feature",
      properties: {
        cd_fcu: f.properties.cd_fcu,
        nome: f.properties.nm_fcu,
        municipio: f.properties.nm_mun,
      },
      geometry: f.geometry,
    })),
  });
}

async function risco() {
  console.log("\n[2/3] Áreas de risco (IBGE/BATER 2018)");
  const zip = await baixar(BATER_URL, path.join(TMP, "PARBR2018_BATER.zip"));
  const base = extrairShapefile(zip, path.join(TMP, "bater"));
  // Este shapefile veio em latin1 apesar do .CPG.
  const todas = await lerShp(base, "latin1");

  const sv = todas.filter((f) => String(f.properties.GEO_MUN) === CD_MUN);
  console.log(`  ${todas.length} polígonos no Brasil, ${sv.length} em São Vicente`);

  if (!sv.length) {
    // Verificado: a BATER 2018 cobre 89 municípios de SP, incluindo os vizinhos
    // Santos, Cubatão, Praia Grande e Itanhaém — mas São Vicente não foi
    // levantado. Gravar um arquivo vazio só criaria uma camada fantasma.
    console.warn(
      "  [ATENÇÃO] São Vicente não consta na BATER 2018. Nenhum arquivo gravado.\n" +
        "  Para risco de inundação validado, buscar: setores de risco da CPRM/SGB\n" +
        "  ou o Plano Municipal de Redução de Riscos da Prefeitura."
    );
    return;
  }

  salvar("RISCO IBGE", "areas_risco_bater_2018.geojson", {
    type: "FeatureCollection",
    fonte: "IBGE — População em Áreas de Risco no Brasil (BATER) 2018",
    url: BATER_URL,
    coletado_em: new Date().toISOString().slice(0, 10),
    features: sv.map((f) => ({
      type: "Feature",
      properties: {
        geo_bater: f.properties.GEO_BATER,
        municipio: f.properties.MUNICIPIO,
        origem: f.properties.ORIGEM,
        // "ótima" >90% dos domicílios dentro da área de risco, "boa" 60-90%,
        // "regular" <=60% — declarado pelo próprio IBGE.
        acuracia: f.properties.ACURACIA,
        n_poligonos: Number(f.properties.NUM) || null,
        obs: f.properties.OBS || null,
      },
      geometry: f.geometry,
    })),
  });
}

/** Baixa a tabela oficial de tipos de unidade, em vez de chutar os códigos. */
async function tiposUnidade() {
  const mapa = new Map();
  for (let off = 0; off < 400; off += 100) {
    const url = `https://apidadosabertos.saude.gov.br/cnes/tipounidades?limit=100&offset=${off}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) break;
    const lote = (await res.json()).tipos_unidade || [];
    if (!lote.length) break;
    lote.forEach((t) => mapa.set(t.codigo_tipo_unidade, t.descricao_tipo_unidade));
    await sleep(150);
  }
  return mapa;
}

async function saude() {
  console.log("\n[3/3] Estabelecimentos de saúde (CNES / Ministério da Saúde)");
  const tipos = await tiposUnidade();
  console.log(`  ${tipos.size} tipos de unidade na tabela oficial`);

  const todos = [];
  const vistos = new Set();

  // A API devolve no máximo 20 registros por página, independente do `limit`.
  for (let off = 0; off < 5000; off += 20) {
    const url = `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos?codigo_municipio=${CD_MUN_CNES}&limit=20&offset=${off}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) break;
    const lote = (await res.json()).estabelecimentos || [];
    if (!lote.length) break;

    let novos = 0;
    for (const e of lote) {
      if (vistos.has(e.codigo_cnes)) continue;
      vistos.add(e.codigo_cnes);
      todos.push(e);
      novos++;
    }
    if (novos === 0) break;
    await sleep(150);
  }

  const comCoord = todos.filter(
    (e) => e.latitude_estabelecimento_decimo_grau && e.longitude_estabelecimento_decimo_grau
  );
  console.log(`  ${todos.length} estabelecimentos, ${comCoord.length} com coordenada`);

  salvar("SAUDE CNES", "saude_cnes.geojson", {
    type: "FeatureCollection",
    fonte: "Ministério da Saúde — CNES (apidadosabertos.saude.gov.br)",
    coletado_em: new Date().toISOString().slice(0, 10),
    sem_coordenada: todos.length - comCoord.length,
    features: comCoord.map((e) => ({
      type: "Feature",
      properties: {
        cnes: e.codigo_cnes,
        nome: e.nome_fantasia || e.nome_razao_social,
        tipo_cod: e.codigo_tipo_unidade,
        tipo: tipos.get(e.codigo_tipo_unidade) || null,
        esfera: e.descricao_esfera_administrativa,
        gestao: e.tipo_gestao,
        bairro: e.bairro_estabelecimento,
        endereco: [e.endereco_estabelecimento, e.numero_estabelecimento]
          .filter(Boolean)
          .join(", "),
        turno: e.descricao_turno_atendimento,
      },
      geometry: {
        type: "Point",
        coordinates: [
          e.longitude_estabelecimento_decimo_grau,
          e.latitude_estabelecimento_decimo_grau,
        ],
      },
    })),
  });
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  await favelas();
  await risco();
  await saude();
  console.log("\nConcluído.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

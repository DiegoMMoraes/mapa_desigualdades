#!/usr/bin/env node
/**
 * Gera as camadas tratadas do Mapa das Desigualdades.
 *
 * Entradas : Bases/  (IBGE, Prefeitura, CNES, SOU Transportes, OSM)
 * Saídas   : data/shapefiles/<tema>/<tema>.{shp,shx,dbf,prj,cpg}  — QGIS/ArcGIS
 *            data/<tema>.geojson                                   — mapa web
 *            data/manifest.json                                    — dicionário de campos
 *
 * Uso: node scripts/build-layers.js
 */
const fs = require("fs");
const path = require("path");
const turf = require("@turf/turf");
const shapefile = require("shapefile");
const { writeShapefile } = require("./lib/shapefile-writer");

const RAIZ = path.join(__dirname, "..");
const BASES = path.join(RAIZ, "Bases");
const DATA = path.join(RAIZ, "data");
const SHP_OUT = path.join(DATA, "shapefiles");

/**
 * Salário mínimo vigente na coleta do Censo 2022. Confirmado contra os próprios
 * dados: renda_sal == round(field_5 / 1212) em todos os 626 setores com valor.
 */
const SALARIO_MINIMO_2022 = 1212;

/** Tipos do CNES que compõem a rede de atenção à saúde (exclui consultório
 *  particular isolado, farmácia, SADT, apoio administrativo). */
const TIPOS_ATENCAO = new Set([
  "CENTRO DE SAUDE/UNIDADE BASICA",
  "POSTO DE SAUDE",
  "POLICLINICA",
  "PRONTO ATENDIMENTO",
  "HOSPITAL GERAL",
  "HOSPITAL ESPECIALIZADO",
  "CENTRO DE ATENCAO PSICOSSOCIAL",
  "HOSPITAL/DIA - ISOLADO",
]);

/**
 * As páginas de coleta seletiva da prefeitura não usam o mesmo recorte dos
 * bairros do IBGE. Envolve decisão manual — ver README.
 */
const COLETA_PARA_IBGE = {
  "Beira Mar": ["Beira Mar"],
  "Boa Vista e Itararé": ["Boa Vista", "Itararé"],
  "Catiapoã": ["Catiapoã"],
  "Cidade Náutica": ["Cidade Náutica"],
  "Gonzaguinha": ["Gonzaguinha", "Centro"],
  "Humaitá": ["Humaitá"],
  "Japuí e Parque Prainha": ["Japuí"],
  "Jardim Guaçu": ["Jardim Guassu"],
  "Jardim Independência": ["Jardim Independência"],
  "Jardim Rio Branco": ["Jardim Rio Branco"],
  "Náutica III": ["Cidade Náutica"],
  "Parque Bitarú": ["Parque Bitaru"],
  "Parque Continental": ["Parque Continental"],
  "Parque São Vicente": ["Parque São Vicente"],
  "Tancredo": [],
  "Vila Cascatinha": [],
  "Vila Fátima": ["Vila Nossa Senhora de Fátima"],
  "Vila Jóquei Clube": ["Jóckey Club"],
  "Vila Margarida": ["Vila Margarida"],
  "Vila Mello": ["Vila Melo"],
  "Vila São Jorge": ["Vila São Jorge"],
  "Vila Valença": ["Vila Valença"],
  "Vila Voturuá": ["Vila Voturuá"],
};

const lerJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const km2 = (g) => turf.area(g) / 1e6;
const round = (v, n = 2) => (v === null || !isFinite(v) ? null : Number(v.toFixed(n)));

async function lerShapefile(base, encoding = "utf-8") {
  const src = await shapefile.open(`${base}.shp`, `${base}.dbf`, { encoding });
  const out = [];
  let r = await src.read();
  while (!r.done) {
    out.push(r.value);
    r = await src.read();
  }
  return out;
}

/** Une uma lista de geometrias em um único polígono/multipolígono válido. */
function dissolver(geometrias) {
  const polys = [];
  for (const g of geometrias) {
    if (!g) continue;
    const coords =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const c of coords) {
      try {
        const p = turf.polygon(c);
        if (turf.area(p) > 0) polys.push(p);
      } catch (_) { /* anel inválido */ }
    }
  }
  if (!polys.length) return null;
  if (polys.length === 1) return polys[0];
  try {
    return turf.union(turf.featureCollection(polys));
  } catch (_) {
    return turf.combine(turf.featureCollection(polys)).features[0];
  }
}

/** Área da interseção entre uma geometria já dissolvida e o bairro, em m². */
function areaInterseccao(uniao, bairro) {
  if (!uniao) return 0;
  try {
    const i = turf.intersect(turf.featureCollection([uniao, bairro]));
    return i ? turf.area(i) : 0;
  } catch (_) {
    return 0;
  }
}

const manifesto = [];
const DESCRICOES = {
  bairros_indicadores: "Consolidado: todos os indicadores de desigualdade por bairro.",
  renda: "Renda média domiciliar por bairro (IBGE, Censo 2022).",
  densidade: "Densidade demográfica por bairro (IBGE, Censo 2022).",
  favelas: "Favelas e Comunidades Urbanas (IBGE, Censo 2022).",
  saude: "Estabelecimentos de saúde georreferenciados (CNES/Ministério da Saúde).",
  areas_verdes: "Áreas com vegetação: mangue, mata, praças, gramados (OSM).",
  parques_lazer: "Equipamentos de lazer: praças, quadras, playgrounds (OSM).",
  coleta_seletiva: "Situação da coleta seletiva por bairro (portal da Prefeitura).",
  transporte_rotas: "Traçado das linhas municipais de ônibus (SOU Transportes).",
  transporte_paradas: "Pontos de ônibus das linhas municipais (SOU Transportes).",
};

function salvar(nome, fc, tipo, campos) {
  fs.writeFileSync(path.join(DATA, `${nome}.geojson`), JSON.stringify(fc));
  const res = writeShapefile(path.join(SHP_OUT, nome, nome), fc, tipo, campos);

  const amostra = fc.features[0]?.properties || {};
  manifesto.push({
    camada: nome,
    descricao: DESCRICOES[nome] || null,
    geometria: tipo,
    feicoes: res.feicoes,
    geojson: `data/${nome}.geojson`,
    shapefile: `data/shapefiles/${nome}/${nome}.shp`,
    campos: Object.keys(amostra).map((k, i) => ({
      geojson: k,
      dbf: res.campos[i],
      tipo: typeof amostra[k] === "number" ? "numérico" : "texto",
    })),
  });

  console.log(`  ${nome.padEnd(22)} ${String(res.feicoes).padStart(4)} feições`);
  return res;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(SHP_OUT, { recursive: true });

  // ---------------------------------------------------------------
  // 1. Setores censitários -> bairros
  // ---------------------------------------------------------------
  console.log("Lendo IBGE (Censo 2022)...");
  const setoresRenda = await lerShapefile(path.join(BASES, "RENDA", "Renda_2022", "Renda_2022"));
  const setoresDens = await lerShapefile(
    path.join(BASES, "DENSIDADE", "Densidade_demográfica_2022", "Densidade_demográfica_2022")
  );

  // População por setor, para ponderar a renda (um setor de 90 domicílios não
  // pode pesar o mesmo que um de 900 na média do bairro).
  const popPorSetor = new Map();
  for (const f of setoresDens) {
    const hab = Number(f.properties.hab_setor);
    if (!isNaN(hab)) popPorSetor.set(String(f.properties.CD_SETOR), hab);
  }

  const AREA_CONTINENTAL = "Área continental (rural)";
  const nomeBairro = (p) => (p.NM_BAIRRO || "").trim() || AREA_CONTINENTAL;

  const bairros = new Map();
  for (const f of setoresRenda) {
    const b = nomeBairro(f.properties);
    if (!bairros.has(b)) bairros.set(b, { geoms: [], rendas: [] });
    const reg = bairros.get(b);
    reg.geoms.push(f.geometry);

    // field_5 = renda média domiciliar em R$/mês no setor. renda_sal é só a
    // classe derivada (round(field_5/1212)); usar o valor em R$ é mais preciso.
    const rs = Number(f.properties.field_5);
    if (!isNaN(rs) && rs > 0) {
      reg.rendas.push({ rs, pop: popPorSetor.get(String(f.properties.CD_SETOR)) || 0 });
    }
  }

  const densPorBairro = new Map();
  for (const f of setoresDens) {
    const b = nomeBairro(f.properties);
    if (!densPorBairro.has(b)) densPorBairro.set(b, { hab: 0, area: 0 });
    const d = densPorBairro.get(b);
    const hab = Number(f.properties.hab_setor);
    const area = Number(f.properties.area_setor);
    if (!isNaN(hab)) d.hab += hab;
    if (!isNaN(area)) d.area += area;
  }

  console.log("Dissolvendo setores em bairros...");
  const bairroFeats = [];
  for (const [nome, reg] of bairros) {
    const geom = dissolver(reg.geoms);
    if (!geom) continue;
    const dens = densPorBairro.get(nome) || { hab: 0, area: 0 };

    const pesoTotal = reg.rendas.reduce((a, r) => a + r.pop, 0);
    const rendaRS = pesoTotal
      ? reg.rendas.reduce((a, r) => a + r.rs * r.pop, 0) / pesoTotal
      : reg.rendas.length
      ? reg.rendas.reduce((a, r) => a + r.rs, 0) / reg.rendas.length
      : null;

    bairroFeats.push({
      type: "Feature",
      properties: {
        bairro: nome,
        zona: nome === AREA_CONTINENTAL ? "continental" : "urbana",
        area_km2: round(km2(geom), 4),
        populacao: dens.hab || null,
        densidade_hab_km2: dens.area > 0 ? Math.round(dens.hab / dens.area) : null,
        renda_media_rs: round(rendaRS, 0),
        renda_sm: round(rendaRS ? rendaRS / SALARIO_MINIMO_2022 : null, 2),
        n_setores: reg.rendas.length,
      },
      geometry: geom.geometry,
    });
  }
  bairroFeats.sort((a, b) => a.properties.bairro.localeCompare(b.properties.bairro, "pt-BR"));

  const municipio = dissolver(bairroFeats.map((f) => f.geometry));
  console.log(`  ${bairroFeats.length} bairros | município ${km2(municipio).toFixed(2)} km²`);

  // ---------------------------------------------------------------
  // 2. Camadas temáticas
  // ---------------------------------------------------------------
  const verdesRaw = lerJSON(path.join(BASES, "AREAS VERDES OSM", "osm_areas_verdes.geojson"));
  const verdeFeats = [];
  for (const f of verdesRaw.features) {
    let g;
    try {
      g = turf.intersect(turf.featureCollection([turf.feature(f.geometry), municipio]));
    } catch (_) {
      g = null;
    }
    if (!g || turf.area(g) < 50) continue;
    verdeFeats.push({
      type: "Feature",
      properties: { ...f.properties, area_m2: Math.round(turf.area(g)) },
      geometry: g.geometry,
    });
  }
  const areasVerdes = verdeFeats.filter((f) => f.properties.e_verde === 1);
  const areasLazer = verdeFeats.filter((f) => f.properties.e_lazer === 1);

  // -- favelas (IBGE FCU 2022)
  const favelasRaw = lerJSON(path.join(BASES, "FAVELAS IBGE", "favelas_ibge_2022.geojson"));
  const favelaFeats = favelasRaw.features.map((f) => ({
    type: "Feature",
    properties: {
      cd_fcu: f.properties.cd_fcu,
      nome: f.properties.nome,
      area_m2: Math.round(turf.area(turf.feature(f.geometry))),
    },
    geometry: f.geometry,
  }));

  // -- saúde (CNES)
  const saudeRaw = lerJSON(path.join(BASES, "SAUDE CNES", "saude_cnes.geojson"));
  const saudeFeats = saudeRaw.features
    .filter((f) => turf.booleanPointInPolygon(turf.point(f.geometry.coordinates), municipio))
    .map((f) => ({
      type: "Feature",
      properties: {
        cnes: f.properties.cnes,
        nome: f.properties.nome,
        tipo: f.properties.tipo,
        atencao: TIPOS_ATENCAO.has(f.properties.tipo) ? "Sim" : "Não",
        bairro_cnes: f.properties.bairro,
        endereco: f.properties.endereco,
        turno: f.properties.turno,
      },
      geometry: f.geometry,
    }));
  const saudeAtencao = saudeFeats.filter((f) => f.properties.atencao === "Sim");
  console.log(
    `  ${favelaFeats.length} favelas | ${saudeFeats.length} estab. saúde (${saudeAtencao.length} de atenção)`
  );

  // -- transporte (SOU Transportes)
  const sou = lerJSON(path.join(BASES, "TRANSPORTE PUBLICO", "sou_linhas_sao_vicente.json"));
  const rotaFeats = sou.linhas.map((l) => ({
    type: "Feature",
    properties: {
      route_id: l.route_id,
      linha: l.linha,
      nome: l.nome,
      partidas_semana: l.partidas_semana,
      n_sentidos: l.sentidos.length,
    },
    geometry: {
      type: "MultiLineString",
      coordinates: l.sentidos.map((s) => s["traçado"]),
    },
  }));
  const paradaFeats = sou.paradas.map((p) => ({
    type: "Feature",
    properties: {
      stop_id: p.stop_id,
      nome: p.nome,
      linhas: p.linhas.join(", "),
      n_linhas: p.linhas.length,
    },
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
  }));
  const partidasPorLinha = new Map(sou.linhas.map((l) => [l.linha, l.partidas_semana]));
  console.log(`  ${rotaFeats.length} linhas | ${paradaFeats.length} paradas`);

  // -- agregados do Censo por bairro (saneamento, alfabetização, cor/raça,
  //    faixa etária, entorno urbano). Já vêm consolidados por bairro pelo IBGE,
  //    com o mesmo NM_BAIRRO da malha de setores.
  const censoArq = path.join(BASES, "CENSO AGREGADOS", "censo_bairros.json");
  const censoPorBairro = new Map();
  if (fs.existsSync(censoArq)) {
    for (const b of lerJSON(censoArq).bairros) censoPorBairro.set(b.bairro, b);
    console.log(`  ${censoPorBairro.size} bairros com agregados do Censo`);
  } else {
    console.warn("  [aviso] rode `npm run censo:agregados` para os dados socioambientais");
  }

  // -- coleta seletiva
  const coleta = lerJSON(path.join(BASES, "COLETA SELETIVA", "coleta_seletiva_rotas.json"));
  const coletaPorIbge = new Map();
  for (const pag of coleta.bairros) {
    const alvos = COLETA_PARA_IBGE[pag.nome];
    if (!alvos) {
      console.warn(`  [aviso] página de coleta sem mapeamento: "${pag.nome}"`);
      continue;
    }
    for (const alvo of alvos) {
      if (!coletaPorIbge.has(alvo)) coletaPorIbge.set(alvo, []);
      coletaPorIbge.get(alvo).push(pag);
    }
  }

  // ---------------------------------------------------------------
  // 3. Cruzamentos por bairro
  // ---------------------------------------------------------------
  console.log("Cruzando indicadores...");

  // Feições do OSM/IBGE se sobrepõem (mangue dentro de APA, quadra dentro de
  // praça). Sem dissolver antes, a soma das interseções conta a mesma área
  // várias vezes e o percentual passa de 100%.
  const verdeUniao = dissolver(areasVerdes.map((f) => f.geometry));
  const lazerUniao = dissolver(areasLazer.map((f) => f.geometry));
  const favelaUniao = dissolver(favelaFeats.map((f) => f.geometry));

  const coletaFeats = [];

  for (const bf of bairroFeats) {
    const nome = bf.properties.bairro;
    const bGeom = turf.feature(bf.geometry);
    const areaBairro = turf.area(bGeom);
    const pop = bf.properties.populacao || 0;

    const areaVerde = areaInterseccao(verdeUniao, bGeom);
    const areaLazer = areaInterseccao(lazerUniao, bGeom);
    const areaFavela = areaInterseccao(favelaUniao, bGeom);

    const nLazer = areasLazer.filter((v) => {
      try {
        return !!turf.intersect(turf.featureCollection([turf.feature(v.geometry), bGeom]));
      } catch (_) {
        return false;
      }
    }).length;

    const nFavelas = favelaFeats.filter((v) => {
      try {
        return !!turf.intersect(turf.featureCollection([turf.feature(v.geometry), bGeom]));
      } catch (_) {
        return false;
      }
    }).length;

    // -- saúde
    const dentro = (fs_) =>
      fs_.filter((p) => turf.booleanPointInPolygon(turf.point(p.geometry.coordinates), bGeom));
    const nSaude = dentro(saudeFeats).length;
    const nAtencao = dentro(saudeAtencao).length;

    // Distância do centro do bairro ao equipamento de atenção mais próximo —
    // pega bairros que não têm nenhum, mas fazem divisa com um.
    const centro = turf.pointOnFeature(bGeom);
    let distSaude = null;
    for (const s of saudeAtencao) {
      const d = turf.distance(centro, turf.point(s.geometry.coordinates), { units: "meters" });
      if (distSaude === null || d < distSaude) distSaude = d;
    }

    // -- transporte
    const paradasNoBairro = dentro(paradaFeats);
    const linhasNoBairro = new Set();
    paradasNoBairro.forEach((p) =>
      p.properties.linhas.split(", ").filter(Boolean).forEach((l) => linhasNoBairro.add(l))
    );
    const partidasSemana = [...linhasNoBairro].reduce(
      (a, l) => a + (partidasPorLinha.get(l) || 0),
      0
    );

    // -- coleta
    const pags = coletaPorIbge.get(nome) || [];
    const agendas = pags.flatMap((p) => p.agendas);
    const dias = [...new Set(agendas.map((a) => a.dia))];

    const c = censoPorBairro.get(nome) || {};

    Object.assign(bf.properties, {
      // saneamento e domicílios (IBGE)
      domicilios: c.domicilios ?? null,
      pct_esgoto_rede: c.pct_esgoto_rede ?? null,
      pct_esgoto_inadeq: c.pct_esgoto_inadequado ?? null,
      pct_agua_encanada: c.pct_agua_encanada ?? null,
      pct_lixo_coletado: c.pct_lixo_coletado ?? null,
      pct_sem_banheiro: c.pct_sem_banheiro ?? null,
      // educação, cor/raça e faixa etária (IBGE)
      taxa_alfabetiz: c.taxa_alfabetizacao ?? null,
      n_nao_alfabetizados: c.n_nao_alfabetizados ?? null,
      pct_preta_parda: c.pct_preta_parda ?? null,
      pct_branca: c.pct_branca ?? null,
      pct_criancas_0_9: c.pct_criancas_0_9 ?? null,
      pct_idosos_60: c.pct_idosos_60mais ?? null,
      // entorno urbano (IBGE)
      pct_com_calcada: c.pct_com_calcada ?? null,
      pct_sem_calcada: c.pct_sem_calcada ?? null,
      pct_sem_arboriz: c.pct_sem_arborizacao ?? null,
      pct_sem_bueiro: c.pct_sem_bueiro ?? null,
      pct_sem_ilumin: c.pct_sem_iluminacao ?? null,
      pct_sem_rampa: c.pct_sem_rampa ?? null,
      domicilios_entorno: c.domicilios_entorno ?? null,
      pct_via_pavim: c.pct_via_pavimentada ?? null,
      // vulnerabilidade
      area_favela_m2: Math.round(areaFavela),
      pct_area_favela: round((areaFavela / areaBairro) * 100),
      n_favelas: nFavelas,
      // saúde
      n_saude: nSaude,
      n_saude_atencao: nAtencao,
      saude_por_10k: pop ? round((nAtencao / pop) * 10000) : null,
      dist_saude_m: distSaude === null ? null : Math.round(distSaude),
      // transporte
      n_paradas: paradasNoBairro.length,
      paradas_km2: round(paradasNoBairro.length / (areaBairro / 1e6)),
      n_linhas: linhasNoBairro.size,
      partidas_semana: partidasSemana,
      partidas_por_1k: pop ? round((partidasSemana / pop) * 1000) : null,
      // ambiente e lazer
      area_verde_m2: Math.round(areaVerde),
      pct_area_verde: round((areaVerde / areaBairro) * 100),
      m2_verde_hab: pop ? round(areaVerde / pop) : null,
      n_equip_lazer: nLazer,
      lazer_por_10k: pop ? round((nLazer / pop) * 10000) : null,
      // saneamento
      coleta: pags.length ? "Sim" : "Não",
      coleta_dias: dias.join(", ") || null,
      coleta_freq: agendas.length || 0,
      coleta_hora: agendas[0]?.horario_limite || null,
      coleta_turno: agendas[0]?.turno || null,
      coleta_ruas: pags.reduce((a, p) => a + p.ruas.length, 0),
      coleta_pag: pags.map((p) => p.nome).join(" / ") || null,
    });

    coletaFeats.push({
      type: "Feature",
      properties: {
        bairro: nome,
        atendido: pags.length ? "Sim" : "Não",
        dias: dias.join(", ") || null,
        turno: agendas[0]?.turno || null,
        hora_limite: agendas[0]?.horario_limite || null,
        freq_semana: agendas.length || 0,
        n_ruas: pags.reduce((a, p) => a + p.ruas.length, 0),
        n_condominios: pags.reduce((a, p) => a + p.condominios.length, 0),
        pagina_fonte: pags.map((p) => p.nome).join(" / ") || null,
        populacao: bf.properties.populacao,
      },
      geometry: bf.geometry,
    });
  }

  // ---------------------------------------------------------------
  // 4. Gravação
  // ---------------------------------------------------------------
  console.log("\nGravando camadas:");
  const fc = (features) => ({ type: "FeatureCollection", features });
  const sub = (campos) =>
    fc(
      bairroFeats.map((f) => ({
        type: "Feature",
        properties: Object.fromEntries(campos.map((c) => [c, f.properties[c]])),
        geometry: f.geometry,
      }))
    );

  salvar("bairros_indicadores", fc(bairroFeats), "POLYGON");
  salvar(
    "renda",
    sub(["bairro", "renda_media_rs", "renda_sm", "populacao", "n_setores"]),
    "POLYGON"
  );
  salvar("densidade", sub(["bairro", "populacao", "area_km2", "densidade_hab_km2"]), "POLYGON");
  salvar("favelas", fc(favelaFeats), "POLYGON");
  salvar("saude", fc(saudeFeats), "POINT");
  salvar("areas_verdes", fc(areasVerdes), "POLYGON");
  salvar("parques_lazer", fc(areasLazer), "POLYGON");
  salvar("coleta_seletiva", fc(coletaFeats), "POLYGON");
  salvar("transporte_rotas", fc(rotaFeats), "POLYLINE");
  salvar("transporte_paradas", fc(paradaFeats), "POINT");

  fs.writeFileSync(
    path.join(DATA, "manifest.json"),
    JSON.stringify(
      {
        projeto: "Mapa das Desigualdades — São Vicente",
        gerado_em: new Date().toISOString().slice(0, 10),
        crs: "EPSG:4674 (SIRGAS 2000)",
        nota_crs:
          "O GeoJSON (RFC 7946) presume WGS84/EPSG:4326. Em SIRGAS 2000 a diferença no " +
          "Brasil é submétrica; reprojete se seu fluxo exigir 4326 estrito.",
        fontes: {
          "IBGE Censo 2022": ["renda", "densidade", "favelas", "bairros_indicadores"],
          "Prefeitura de São Vicente": ["coleta_seletiva"],
          "CNES / Ministério da Saúde": ["saude"],
          "SOU Transportes (Bus2you)": ["transporte_rotas", "transporte_paradas"],
          "OpenStreetMap (ODbL 1.0)": ["areas_verdes", "parques_lazer"],
        },
        camadas: manifesto,
      },
      null,
      2
    )
  );
  console.log(`  ${"manifest.json".padEnd(22)}`);

  // ---------------------------------------------------------------
  // 5. Quais fatores acompanham a renda? (correlação de Pearson)
  // ---------------------------------------------------------------
  const urbanos = bairroFeats.filter((f) => f.properties.zona === "urbana");
  function correl(campo) {
    const pares = urbanos
      .map((f) => [f.properties.renda_media_rs, f.properties[campo]])
      .filter(([a, b]) => typeof a === "number" && typeof b === "number");
    const n = pares.length;
    if (n < 5) return null;
    const mx = pares.reduce((a, p) => a + p[0], 0) / n;
    const my = pares.reduce((a, p) => a + p[1], 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (const [x, y] of pares) {
      num += (x - mx) * (y - my);
      dx += (x - mx) ** 2;
      dy += (y - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : null;
  }

  console.log("\nCorrelação com a renda média do bairro (só área urbana, n=" + urbanos.length + "):");
  const fatores = [
    ["pct_esgoto_rede", "% domicílios com esgoto em rede"],
    ["pct_esgoto_inadeq", "% com esgotamento inadequado"],
    ["pct_sem_calcada", "% domicílios sem calçada"],
    ["pct_sem_arboriz", "% domicílios sem arborização"],
    ["pct_sem_bueiro", "% domicílios sem bueiro"],
    ["pct_sem_ilumin", "% domicílios sem iluminação pública"],
    ["pct_sem_rampa", "% sem rampa para cadeirante"],
    ["taxa_alfabetiz", "taxa de alfabetização (15+)"],
    ["pct_preta_parda", "% população preta ou parda"],
    ["pct_criancas_0_9", "% de crianças de 0 a 9 anos"],
    ["pct_idosos_60", "% de idosos (60+)"],
    ["pct_area_favela", "% do bairro em favela"],
    ["densidade_hab_km2", "densidade demográfica"],
    ["saude_por_10k", "equip. de saúde por 10 mil hab"],
    ["dist_saude_m", "distância até saúde (m)"],
    ["partidas_por_1k", "partidas de ônibus por mil hab"],
    ["paradas_km2", "paradas por km²"],
    ["m2_verde_hab", "m² de área verde por hab"],
    ["lazer_por_10k", "equip. de lazer por 10 mil hab"],
  ];
  const tabela = fatores
    .map(([campo, rotulo]) => ({ fator: rotulo, r: round(correl(campo), 2) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  console.table(tabela);

  fs.writeFileSync(
    path.join(DATA, "correlacoes_renda.json"),
    JSON.stringify(
      {
        metodo: "Correlação de Pearson entre a renda média do bairro e cada indicador.",
        aviso:
          "Correlação não é causalidade e n=" + urbanos.length + " bairros é uma amostra pequena. " +
          "Serve para priorizar investigação, não como conclusão causal.",
        n_bairros: urbanos.length,
        resultados: tabela,
      },
      null,
      2
    )
  );

  console.log("\nResumo por bairro:");
  console.table(
    bairroFeats.map((f) => ({
      bairro: f.properties.bairro,
      pop: f.properties.populacao,
      "renda R$": f.properties.renda_media_rs,
      "favela%": f.properties.pct_area_favela,
      saude: f.properties.n_saude_atencao,
      "dist.saúde": f.properties.dist_saude_m,
      paradas: f.properties.n_paradas,
      "part/sem": f.properties.partidas_semana,
      coleta: f.properties.coleta,
    }))
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

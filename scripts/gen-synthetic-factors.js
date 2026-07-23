#!/usr/bin/env node
/**
 * Gera FATORES SINTÉTICOS de desigualdade para o protótipo.
 *
 * ATENÇÃO: os valores aqui são FICTÍCIOS. Servem para demonstrar as
 * funcionalidades do mapa (indicadores, desigualdade entre/dentro de bairros e
 * comparação de áreas) enquanto as bases reais não estão disponíveis. Não use
 * para análise ou política pública. Ver DOCUMENTACAO_DADOS.md, seção "Fatores
 * sintéticos".
 *
 * Os fatores foram escolhidos a partir de frameworks consagrados de
 * vulnerabilidade social, mapeando dimensões que ainda não tínhamos:
 *   - IVS/IPEA (Censo IBGE): Infraestrutura Urbana, Capital Humano, Renda e Trabalho
 *   - SVI/CDC-ATSDR: Socioeconomic status, Household composition, Housing/Transport
 *   - Revisão de 121 índices (BMC Public Health 2023): emprego, educação,
 *     moradia, composição domiciliar, saúde, populações em risco
 *
 * Para dar coerência ao protótipo, cada fator é correlacionado com a renda real
 * do bairro (bairro mais pobre → mais vulnerável) mais um ruído controlado.
 *
 * Saídas:
 *   - data/bairros_indicadores.geojson  (acrescenta campos sint_*)
 *   - data/microareas.geojson           (subdivisões sintéticas p/ visão intra-bairro)
 *
 * Uso: node scripts/gen-synthetic-factors.js
 */
const fs = require("fs");
const path = require("path");
const turf = require("@turf/turf");

const DATA = path.join(__dirname, "..", "data");
const ARQ_BAIRROS = path.join(DATA, "bairros_indicadores.geojson");
const ARQ_MICRO = path.join(DATA, "microareas.geojson");

// PRNG determinístico (mulberry32) — mesma saída a cada execução.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, n = 1) => Number(v.toFixed(n));

/**
 * Cada fator: como derivá-lo de um "índice de desvantagem" d ∈ [0,1]
 * (0 = bairro mais rico, 1 = mais pobre). `base`/`amp` definem a faixa e `ruido`
 * o quanto o valor individual pode fugir da tendência.
 */
const FATORES = {
  sint_desemprego:       { base: 4,   amp: 18,  ruido: 2.5, dec: 1 }, // % da PEA
  sint_trab_informal:    { base: 18,  amp: 42,  ruido: 4,   dec: 1 }, // % dos ocupados
  sint_pobreza:          { base: 3,   amp: 55,  ruido: 4,   dec: 1 }, // % renda per capita < ½ SM
  sint_jovens_fora_esc:  { base: 1,   amp: 12,  ruido: 1.5, dec: 1 }, // % 6-14 anos fora da escola
  sint_mort_infantil:    { base: 8,   amp: 24,  ruido: 3,   dec: 1 }, // óbitos <1 ano / mil nasc.
  sint_maes_chefes:      { base: 6,   amp: 26,  ruido: 3,   dec: 1 }, // % dom. mães chefes baixa esc.
  sint_aglomeracao:      { base: 3,   amp: 32,  ruido: 3,   dec: 1 }, // % dom. > 2 moradores/dormitório
  sint_tempo_desloc:     { base: 12,  amp: 40,  ruido: 4,   dec: 1 }, // % com trajeto > 1h
  sint_sem_veiculo:      { base: 20,  amp: 45,  ruido: 4,   dec: 1 }, // % dom. sem automóvel
  sint_criminalidade:    { base: 15,  amp: 70,  ruido: 8,   dec: 1 }, // crimes violentos / 10 mil hab
};

// Ordem das dimensões do IVS para compor o índice sintético final.
const DIM_IVS = {
  "Renda e Trabalho": ["sint_desemprego", "sint_trab_informal", "sint_pobreza"],
  "Capital Humano": ["sint_jovens_fora_esc", "sint_mort_infantil", "sint_maes_chefes"],
  "Infraestrutura e Moradia": ["sint_aglomeracao", "sint_tempo_desloc", "sint_sem_veiculo"],
};

function desvantagemDoBairro(props, faixaRenda) {
  // d = posição inversa da renda no município, em [0,1].
  const r = props.renda_media_rs;
  if (typeof r !== "number") return 0.5;
  const [min, max] = faixaRenda;
  return clamp(1 - (r - min) / (max - min), 0, 1);
}

function gerarFatores(d, rand) {
  const out = {};
  for (const [campo, spec] of Object.entries(FATORES)) {
    const ruido = (rand() - 0.5) * 2 * spec.ruido;
    // Curva levemente convexa: a desvantagem "acelera" nos bairros mais pobres.
    const valor = spec.base + spec.amp * Math.pow(d, 1.15) + ruido;
    out[campo] = round(clamp(valor, 0, spec.base + spec.amp + spec.ruido), spec.dec);
  }
  return out;
}

/** IVS sintético 0–1: média das dimensões, cada uma normalizada pela faixa teórica. */
function ivsSintetico(fatores) {
  const normDim = Object.values(DIM_IVS).map((campos) => {
    const vals = campos.map((c) => {
      const spec = FATORES[c];
      return clamp((fatores[c] - spec.base) / spec.amp, 0, 1);
    });
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  return round(normDim.reduce((a, b) => a + b, 0) / normDim.length, 3);
}

function main() {
  const fc = JSON.parse(fs.readFileSync(ARQ_BAIRROS, "utf8"));
  const urbanos = fc.features.filter((f) => f.properties.zona !== "continental");
  const rendas = urbanos.map((f) => f.properties.renda_media_rs).filter((v) => typeof v === "number");
  const faixaRenda = [Math.min(...rendas), Math.max(...rendas)];

  const micro = [];

  for (const feat of fc.features) {
    const p = feat.properties;
    const rand = rng(hashStr(p.bairro));
    const d = desvantagemDoBairro(p, faixaRenda);

    const fatores = gerarFatores(d, rand);
    Object.assign(p, fatores);
    p.sint_ivs = ivsSintetico(fatores);

    // --- Sub-áreas sintéticas para a visão "dentro do bairro" ------------
    // Subdivide o polígono em uma grade e dá a cada célula um valor que varia
    // ao longo de um gradiente espacial + ruído. A amplitude da variação é
    // maior em bairros mais desiguais (proxy: os mais pobres, aqui).
    if (p.zona === "continental") continue;
    const bGeom = turf.feature(feat.geometry);
    const bbox = turf.bbox(bGeom);
    const larg = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: "kilometers" });
    const cell = clamp(larg / 4, 0.18, 0.5); // ~3–5 células por lado
    let grade;
    try {
      grade = turf.squareGrid(bbox, cell, { units: "kilometers", mask: bGeom });
    } catch (_) {
      grade = { features: [] };
    }

    const dir = rand() * Math.PI * 2; // direção do gradiente intra-bairro
    const amplitude = 0.18 + 0.32 * d; // bairros pobres = mais heterogêneos
    const cx = (bbox[0] + bbox[2]) / 2;
    const cy = (bbox[1] + bbox[3]) / 2;

    grade.features.forEach((celula, i) => {
      const c = turf.centroid(celula).geometry.coordinates;
      // Projeção do centroide no eixo do gradiente, normalizada ~[-1,1].
      const proj = Math.cos(dir) * (c[0] - cx) + Math.sin(dir) * (c[1] - cy);
      const escala = proj / (Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) / 2 || 1);
      const fator = clamp(1 + amplitude * escala + (rand() - 0.5) * 0.12, 0.45, 1.6);

      const props = {
        bairro: p.bairro,
        micro_id: `${p.cd_bairro || p.bairro}-${i + 1}`,
        renda_media_rs: Math.round((p.renda_media_rs || 0) / fator), // renda anda ao contrário
        sint_ivs: round(clamp(p.sint_ivs * fator, 0, 1), 3),
      };
      // Replica os fatores na sub-área, escalados pela heterogeneidade local.
      for (const campo of Object.keys(FATORES)) {
        const spec = FATORES[campo];
        props[campo] = round(clamp(p[campo] * fator, 0, spec.base + spec.amp + spec.ruido), spec.dec);
      }
      // Alguns indicadores reais também variam dentro do bairro (demonstração).
      props.pct_esgoto_rede = round(clamp((p.pct_esgoto_rede ?? 95) / (0.6 + 0.4 * fator), 0, 100), 1);
      props.taxa_alfabetiz = round(clamp((p.taxa_alfabetiz ?? 97) / (0.9 + 0.1 * fator), 0, 100), 1);
      props.pct_preta_parda = round(clamp((p.pct_preta_parda ?? 45) * fator, 0, 100), 1);

      micro.push({ type: "Feature", properties: props, geometry: celula.geometry });
    });
  }

  fs.writeFileSync(ARQ_BAIRROS, JSON.stringify(fc));
  fs.writeFileSync(
    ARQ_MICRO,
    JSON.stringify({
      type: "FeatureCollection",
      sintetico: true,
      nota: "Sub-áreas e valores FICTÍCIOS, apenas para o protótipo.",
      features: micro,
    })
  );

  console.log(`bairros: ${urbanos.length} com fatores sintéticos`);
  console.log(`microareas: ${micro.length} sub-áreas geradas`);
  console.log("\nIVS sintético por bairro (0 = melhor, 1 = pior):");
  console.table(
    urbanos
      .map((f) => ({
        bairro: f.properties.bairro,
        renda: f.properties.renda_media_rs,
        desemprego: f.properties.sint_desemprego,
        pobreza: f.properties.sint_pobreza,
        criminalidade: f.properties.sint_criminalidade,
        IVS: f.properties.sint_ivs,
      }))
      .sort((a, b) => b.IVS - a.IVS)
  );
}

main();

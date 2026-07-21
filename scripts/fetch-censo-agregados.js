#!/usr/bin/env node
/**
 * Baixa os Agregados por Bairro do Censo 2022 (IBGE) e extrai São Vicente.
 *
 * Acrescenta as dimensões de desigualdade que faltavam ao mapa: saneamento,
 * alfabetização, cor/raça, estrutura etária e qualidade do entorno (calçada,
 * arborização, bueiro, iluminação).
 *
 * O IBGE publica esses agregados já consolidados por bairro, com o mesmo
 * CD_BAIRRO usado na malha de setores — o join com a camada de bairros é direto,
 * sem precisar reagregar setor a setor.
 *
 * Saída: Bases/CENSO AGREGADOS/censo_bairros.json
 * Uso: node scripts/fetch-censo-agregados.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { unzip } = require("./lib/unzip");

const BASES = path.join(__dirname, "..", "Bases");
const TMP = path.join(os.tmpdir(), "obs-sv-censo");
const UA = "ObservatorioSaoVicente/1.0 (projeto de dados abertos)";
const CD_MUN = "3551009";

const RAIZ_AGREG =
  "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Bairro_csv";
const RAIZ_ENTORNO =
  "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Caracteristicas_urbanisticas_do_entorno_dos_domicilios/Agregados_por_Bairro_csv";

const ARQUIVOS = [
  { chave: "basico", url: `${RAIZ_AGREG}/Agregados_por_bairros_basico_BR_20260520.zip` },
  { chave: "domicilio1", url: `${RAIZ_AGREG}/Agregados_por_bairros_caracteristicas_domicilio1_BR.zip` },
  { chave: "domicilio2", url: `${RAIZ_AGREG}/Agregados_por_bairros_caracteristicas_domicilio2_BR_20250417.zip` },
  { chave: "alfabetizacao", url: `${RAIZ_AGREG}/Agregados_por_bairros_alfabetizacao_BR.zip` },
  { chave: "cor_raca", url: `${RAIZ_AGREG}/Agregados_por_bairros_cor_ou_raca_BR.zip` },
  { chave: "demografia", url: `${RAIZ_AGREG}/Agregados_por_bairros_demografia_BR.zip` },
  { chave: "entorno", url: `${RAIZ_ENTORNO}/Agregados_por_bairros_entorno_domic%c3%adlios_BR.zip` },
];

/**
 * Variáveis usadas, conforme o dicionário oficial do IBGE
 * (dicionario_de_dados_agregados_por_setores_censitarios e dicionario_entorno).
 */
const VARS = {
  domicilio1: {
    V00001: "domicilios_total",
  },
  domicilio2: {
    // Apesar de serem "características do domicílio", as variáveis de água
    // ficam no arquivo Parte 2 — a Parte 1 vai só até V00089.
    V00199: "agua_encanada_dentro",
    V00200: "agua_encanada_terreno",
    V00201: "agua_nao_encanada",
    V00309: "esgoto_rede_geral",
    V00310: "esgoto_fossa_ligada_rede",
    V00311: "esgoto_fossa_nao_ligada",
    V00312: "esgoto_fossa_rudimentar",
    V00313: "esgoto_vala",
    V00314: "esgoto_corpo_dagua",
    V00315: "esgoto_outra",
    V00316: "sem_banheiro",
    V00397: "lixo_coletado_porta",
    V00398: "lixo_cacamba",
    V00399: "lixo_queimado",
    V00400: "lixo_enterrado",
    V00401: "lixo_terreno_baldio",
    V00402: "lixo_outro",
  },
  alfabetizacao: {
    V00900: "alfabetizados_15mais",
    V00901: "nao_alfabetizados_15mais",
  },
  cor_raca: {
    V01317: "cor_branca",
    V01318: "cor_preta",
    V01319: "cor_amarela",
    V01320: "cor_parda",
    V01321: "cor_indigena",
  },
  demografia: {
    V01006: "moradores",
    V01031: "idade_0_4",
    V01032: "idade_5_9",
    V01040: "idade_60_69",
    V01041: "idade_70_mais",
  },
  // Cada quesito do entorno tem SIM / NÃO / NÃO DECLARADO. Trazemos os três para
  // usar como denominador o total efetivamente pesquisado, e não o total de
  // domicílios do bairro — o módulo de entorno só é aplicado em setores sorteados.
  entorno: {
    V05006: "pav_sim", V05007: "pav_nao", V05008: "pav_nd",
    V05009: "bueiro_sim", V05010: "bueiro_nao", V05011: "bueiro_nd",
    V05012: "ilum_sim", V05013: "ilum_nao", V05014: "ilum_nd",
    V05021: "calcada_sim", V05022: "calcada_nao", V05023: "calcada_nd",
    V05027: "rampa_sim", V05028: "rampa_nao", V05029: "rampa_nd",
    V05030: "arb_sem", V05031: "arb_1_2", V05032: "arb_3_4",
    V05033: "arb_5mais", V05034: "arb_saltado",
  },
};

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

/** Converte o valor do CSV. O IBGE usa "X" para dado suprimido por sigilo. */
function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/"/g, "").trim();
  if (!s || s === "X" || s === "-") return null;
  const n = Number(s.replace(",", "."));
  return isFinite(n) ? n : null;
}

/**
 * Lê o CSV (separador ';', codificação latin1) e devolve, por CD_BAIRRO, só as
 * variáveis pedidas. Os arquivos são nacionais e têm centenas de colunas, então
 * filtrar durante a leitura evita carregar tudo na memória.
 */
function extrair(csvBuf, mapaVars) {
  const linhas = csvBuf.toString("latin1").split(/\r?\n/);
  const head = linhas[0].split(";").map((s) => s.replace(/"/g, "").trim());
  const iBairro = head.indexOf("CD_BAIRRO");
  const iNome = head.indexOf("NM_BAIRRO");

  // As colunas aparecem como "v0001" ou "V00001" conforme o arquivo.
  const cols = {};
  for (const [cod, nome] of Object.entries(mapaVars)) {
    const idx = head.findIndex((h) => h.toUpperCase() === cod.toUpperCase());
    if (idx >= 0) cols[nome] = idx;
    else console.warn(`    [aviso] variável ${cod} (${nome}) não encontrada`);
  }

  const out = new Map();
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i]) continue;
    const c = linhas[i].split(";");
    const cd = String(c[iBairro] || "").replace(/"/g, "").trim();
    // Só o arquivo "básico" traz CD_MUN; nos demais o município vem do prefixo
    // do próprio CD_BAIRRO (3551009001 = bairro 001 de São Vicente).
    if (!cd.startsWith(CD_MUN)) continue;
    const reg = { _nome: String(c[iNome] || "").replace(/"/g, "").trim() };
    for (const [nome, idx] of Object.entries(cols)) reg[nome] = num(c[idx]);
    out.set(cd, reg);
  }
  return out;
}

const pct = (parte, total) =>
  total && parte !== null && total > 0 ? Number(((parte / total) * 100).toFixed(2)) : null;
const soma = (...vs) => {
  const validos = vs.filter((v) => typeof v === "number");
  return validos.length ? validos.reduce((a, b) => a + b, 0) : null;
};

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  console.log("Baixando Agregados por Bairro do Censo 2022 (~19 MB)...");

  const dados = {};
  for (const { chave, url } of ARQUIVOS) {
    const zipPath = path.join(TMP, `${chave}.zip`);
    const buf = await baixar(url, zipPath);
    const arquivos = unzip(buf);
    const csv = [...arquivos.entries()].find(([n]) => n.toLowerCase().endsWith(".csv"));
    if (!csv) throw new Error(`sem CSV dentro de ${chave}.zip`);
    if (chave === "basico") {
      dados[chave] = extrair(csv[1], {});
    } else {
      console.log(`  lendo ${chave}...`);
      dados[chave] = extrair(csv[1], VARS[chave]);
    }
  }

  const codigos = [...dados.basico.keys()];
  console.log(`\n${codigos.length} bairros de São Vicente\n`);

  const bairros = codigos.map((cd) => {
    const g = (arq) => dados[arq].get(cd) || {};
    const d1 = g("domicilio1");
    const d2 = g("domicilio2");
    const alf = g("alfabetizacao");
    const cr = g("cor_raca");
    const dem = g("demografia");
    const ent = g("entorno");

    const domicilios = d1.domicilios_total;
    const pessoas15 = soma(alf.alfabetizados_15mais, alf.nao_alfabetizados_15mais);
    const totalCor = soma(
      cr.cor_branca, cr.cor_preta, cr.cor_amarela, cr.cor_parda, cr.cor_indigena
    );
    const moradores = dem.moradores;

    // Cada quesito tem seu próprio denominador (SIM + NÃO + NÃO DECLARADO).
    const baseEnt = (...vs) => {
      const t = soma(...vs);
      return t && t > 0 ? t : null;
    };
    const basePav = baseEnt(ent.pav_sim, ent.pav_nao, ent.pav_nd);
    const baseBueiro = baseEnt(ent.bueiro_sim, ent.bueiro_nao, ent.bueiro_nd);
    const baseIlum = baseEnt(ent.ilum_sim, ent.ilum_nao, ent.ilum_nd);
    const baseCalcada = baseEnt(ent.calcada_sim, ent.calcada_nao, ent.calcada_nd);
    const baseRampa = baseEnt(ent.rampa_sim, ent.rampa_nao, ent.rampa_nd);
    const baseArb = baseEnt(
      ent.arb_sem, ent.arb_1_2, ent.arb_3_4, ent.arb_5mais, ent.arb_saltado
    );

    return {
      cd_bairro: cd,
      bairro: dados.basico.get(cd)._nome,
      domicilios,

      // --- saneamento
      pct_esgoto_rede: pct(soma(d2.esgoto_rede_geral, d2.esgoto_fossa_ligada_rede), domicilios),
      pct_esgoto_inadequado: pct(
        soma(d2.esgoto_fossa_rudimentar, d2.esgoto_vala, d2.esgoto_corpo_dagua, d2.esgoto_outra),
        domicilios
      ),
      pct_sem_banheiro: pct(d2.sem_banheiro, domicilios),
      pct_agua_encanada: pct(d2.agua_encanada_dentro, domicilios),
      pct_lixo_coletado: pct(soma(d2.lixo_coletado_porta, d2.lixo_cacamba), domicilios),
      pct_lixo_inadequado: pct(
        soma(d2.lixo_queimado, d2.lixo_enterrado, d2.lixo_terreno_baldio, d2.lixo_outro),
        domicilios
      ),

      // --- educação
      taxa_alfabetizacao: pct(alf.alfabetizados_15mais, pessoas15),
      n_nao_alfabetizados: alf.nao_alfabetizados_15mais,

      // --- cor ou raça
      pct_preta_parda: pct(soma(cr.cor_preta, cr.cor_parda), totalCor),
      pct_branca: pct(cr.cor_branca, totalCor),

      // --- estrutura etária
      pct_criancas_0_9: pct(soma(dem.idade_0_4, dem.idade_5_9), moradores),
      pct_idosos_60mais: pct(soma(dem.idade_60_69, dem.idade_70_mais), moradores),

      // --- entorno urbano (cada um sobre o próprio total pesquisado)
      pct_via_pavimentada: pct(ent.pav_sim, basePav),
      pct_com_calcada: pct(ent.calcada_sim, baseCalcada),
      pct_sem_calcada: pct(ent.calcada_nao, baseCalcada),
      pct_sem_arborizacao: pct(ent.arb_sem, baseArb),
      pct_sem_bueiro: pct(ent.bueiro_nao, baseBueiro),
      pct_sem_iluminacao: pct(ent.ilum_nao, baseIlum),
      pct_sem_rampa: pct(ent.rampa_nao, baseRampa),
      domicilios_entorno: baseCalcada,
    };
  });

  bairros.sort((a, b) => a.bairro.localeCompare(b.bairro, "pt-BR"));

  // Um indicador nulo em TODOS os bairros quase nunca é dado suprimido: é
  // variável lida do arquivo errado ou nome trocado no cálculo. Já aconteceu
  // duas vezes (água ficou nula por ser buscada na Parte 1 e depois por ser
  // lida de `d1` em vez de `d2`), e passou despercebido nas duas.
  const camposIndicador = Object.keys(bairros[0]).filter((k) => k.startsWith("pct_") || k.startsWith("taxa_"));
  const sempreNulos = camposIndicador.filter((k) => bairros.every((b) => b[k] === null));
  if (sempreNulos.length) {
    console.error(`\n[ERRO] indicadores nulos em todos os bairros: ${sempreNulos.join(", ")}`);
    console.error("       confira em qual arquivo a variável está e de onde o cálculo a lê.");
    process.exitCode = 1;
  }

  const dir = path.join(BASES, "CENSO AGREGADOS");
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, "censo_bairros.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        fonte: "IBGE — Censo 2022, Agregados por Bairro",
        url: RAIZ_AGREG,
        coletado_em: new Date().toISOString().slice(0, 10),
        bairros,
      },
      null,
      2
    )
  );

  console.table(
    bairros.map((b) => ({
      bairro: b.bairro,
      dom: b.domicilios,
      "esgoto%": b.pct_esgoto_rede,
      "s/banh%": b.pct_sem_banheiro,
      "alfab%": b.taxa_alfabetizacao,
      "preta+parda%": b.pct_preta_parda,
      "s/árvore%": b.pct_sem_arborizacao,
      "s/calçada%": 100 - (b.pct_com_calcada ?? 100),
    }))
  );
  console.log(`Salvo em ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

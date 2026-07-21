#!/usr/bin/env node
/**
 * Raspa as rotas de coleta seletiva do portal da Prefeitura de São Vicente.
 * Fonte: https://www.saovicente.sp.gov.br/carta-de-servicos/meio-ambiente-e-animais/residuos/coleta-seletiva-rotas
 *
 * Saída: Bases/COLETA SELETIVA/coleta_seletiva_rotas.json
 * Uso: node scripts/scrape-coleta-seletiva.js
 */
const fs = require("fs");
const path = require("path");

const INDEX_URL =
  "https://www.saovicente.sp.gov.br/carta-de-servicos/meio-ambiente-e-animais/residuos/coleta-seletiva-rotas";
const OUT_DIR = path.join(__dirname, "..", "Bases", "COLETA SELETIVA");

const UA =
  "Mozilla/5.0 (compatible; ObservatorioSaoVicente/1.0; projeto de dados abertos)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O portal às vezes devolve uma página "Estamos em manutenção" transitória.
 * Nesse caso vale a pena tentar de novo antes de desistir.
 */
async function get(url, tentativas = 4) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (/Estamos em manuten/i.test(html)) throw new Error("página em manutenção");
      return html;
    } catch (err) {
      ultimoErro = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`${ultimoErro.message} em ${url}`);
}

function stripTags(fragment) {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Isola o miolo do artigo (entre <main> e o rodapé "Informações da Prefeitura"). */
function extractMain(html) {
  const start = html.indexOf("<main");
  const seg = start >= 0 ? html.slice(start) : html;
  const lines = stripTags(seg);
  const end = lines.findIndex((l) => /^Informações da Prefeitura/i.test(l));
  return end > 0 ? lines.slice(0, end) : lines;
}

// Ex.: "Quarta-feira - Manhã", "Sábado - Tarde"
const CABECALHO_DIA =
  /^(segunda|ter[çc]a|quarta|quinta|sexta)(?:\s*-\s*feira)?|^(s[áa]bado|domingo)/i;

/**
 * Cada bloco de agenda tem a forma:
 *   <Dia>-feira - <Turno>  /  Coloque o seu lixo até HHhMM
 *   Ruas          → [lista]
 *   Condomínios   → [lista]
 * e um bairro pode ter mais de um bloco (dias diferentes atendem ruas diferentes).
 */
function parseBairro(lines) {
  const agendas = [];
  let atual = null;
  let secao = null;

  for (const line of lines) {
    const mDia = line.length < 60 && line.match(CABECALHO_DIA);
    if (mDia) {
      const dia = (mDia[1] || mDia[2]).trim();
      const resto = line.slice(mDia[0].length).replace(/^\s*-\s*feira/i, "");
      const turno = (resto.match(/(manh[ãa]|tarde|noite)/i) || [])[1] || null;
      atual = {
        dia: dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase(),
        turno: turno ? turno.charAt(0).toUpperCase() + turno.slice(1).toLowerCase() : null,
        horario_limite: null,
        ruas: [],
        condominios: [],
      };
      agendas.push(atual);
      secao = null;
      continue;
    }

    const mHora = line.match(/at[ée]\s*(\d{1,2})\s*[h:]\s*(\d{2})?/i);
    if (mHora && atual) {
      atual.horario_limite = `${mHora[1].padStart(2, "0")}h${mHora[2] || "00"}`;
      continue;
    }

    if (/^Ruas\b/i.test(line)) { secao = "ruas"; continue; }
    if (/^Condom[íi]nios\b/i.test(line)) {
      secao = "condominios";
      // Ex.: "Condomínios (Inclui Itararé e Vila Mello)"
      const nota = line.match(/\(([^)]+)\)/);
      if (nota && atual) atual.observacao = nota[1].trim();
      continue;
    }

    if (!atual || !secao) continue;
    atual[secao].push(line);
  }

  const ruas = [...new Set(agendas.flatMap((a) => a.ruas))];
  const condominios = [...new Set(agendas.flatMap((a) => a.condominios))];
  return { agendas, ruas, condominios };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Buscando índice de rotas...");
  const indexHtml = await get(INDEX_URL);
  const urls = [
    ...new Set(
      [...indexHtml.matchAll(/href="([^"]*coleta-seletiva-rotas-por-bairro\/[^"]+)"/g)].map(
        (m) => m[1]
      )
    ),
  ];
  console.log(`${urls.length} páginas de bairro encontradas.`);

  const resultado = [];
  for (const url of urls) {
    const slug = url.split("/").pop();
    process.stdout.write(`  ${slug} ... `);
    try {
      const html = await get(url);
      const titulo = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || slug;
      const nome = titulo
        .replace(/^Coleta Seletiva\s*[-–]\s*/i, "")
        .replace(/\s*—.*$/, "")
        .trim();
      const lines = extractMain(html);
      const dados = parseBairro(lines);
      resultado.push({ slug, url, nome, ...dados });
      console.log(
        `${dados.agendas.length} agenda(s), ${dados.ruas.length} ruas, ${dados.condominios.length} condomínios`
      );
    } catch (err) {
      console.log(`ERRO: ${err.message}`);
      resultado.push({ slug, url, erro: err.message });
    }
    await sleep(700); // educado com o servidor da prefeitura
  }

  const outFile = path.join(OUT_DIR, "coleta_seletiva_rotas.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        fonte: INDEX_URL,
        coletado_em: new Date().toISOString().slice(0, 10),
        bairros: resultado,
      },
      null,
      2
    )
  );
  console.log(`\nSalvo em ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

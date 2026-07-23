#!/usr/bin/env node
/**
 * Gera a planilha-resumo do Mapa das Desigualdades a partir das camadas tratadas.
 *
 * Entrada: data/bairros_indicadores.geojson, data/correlacoes_renda.json,
 *          data/manifest.json e as bases de coleta/transporte.
 * Saída  : data/Mapa_das_Desigualdades_Sao_Vicente.xlsx
 *
 * Rode depois de `npm run build`. Uso: node scripts/build-excel.js
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const RAIZ = path.join(__dirname, "..");
const DATA = path.join(RAIZ, "data");
const BASES = path.join(RAIZ, "Bases");
const SAIDA = path.join(DATA, "Mapa_das_Desigualdades_Sao_Vicente.xlsx");

const lerJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const VERDE = "FF007A4A";
const CREME = "FFF9F3F0";
const MARROM = "FF874A33";

/** Cabeçalho na identidade da marca + congela a primeira coluna e a linha 1. */
function estilizar(ws, nCongelaCol = 1) {
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 34;

  ws.views = [{ state: "frozen", xSplit: nCongelaCol, ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columnCount },
  };

  for (let i = 2; i <= ws.rowCount; i++) {
    if (i % 2 === 0) {
      ws.getRow(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREME } };
    }
  }
}

function main() {
  const bairros = lerJSON(path.join(DATA, "bairros_indicadores.geojson")).features.map(
    (f) => f.properties
  );
  const correl = lerJSON(path.join(DATA, "correlacoes_renda.json"));
  const manifest = lerJSON(path.join(DATA, "manifest.json"));
  const coleta = lerJSON(path.join(BASES, "COLETA SELETIVA", "coleta_seletiva_rotas.json"));
  const sou = lerJSON(path.join(BASES, "TRANSPORTE PUBLICO", "sou_linhas_sao_vicente.json"));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Mapa das Desigualdades — São Vicente";
  wb.created = new Date();

  // ---------------------------------------------------------------
  // Aba 1 — Resumo por bairro
  // ---------------------------------------------------------------
  const ws = wb.addWorksheet("Resumo por bairro", {
    properties: { tabColor: { argb: VERDE } },
  });
  ws.columns = [
    { header: "Bairro", key: "bairro", width: 30 },
    { header: "Zona", key: "zona", width: 12 },
    { header: "População", key: "populacao", width: 12, style: { numFmt: "#,##0" } },
    { header: "Área (km²)", key: "area_km2", width: 11, style: { numFmt: "0.00" } },
    { header: "Densidade (hab/km²)", key: "densidade_hab_km2", width: 15, style: { numFmt: "#,##0" } },
    { header: "Renda média (R$/mês)", key: "renda_media_rs", width: 15, style: { numFmt: '"R$" #,##0' } },
    { header: "Renda (salários mínimos)", key: "renda_sm", width: 14, style: { numFmt: "0.00" } },
    { header: "Área em favela (%)", key: "pct_area_favela", width: 13, style: { numFmt: "0.0" } },
    { header: "Nº de comunidades", key: "n_favelas", width: 12 },
    { header: "Unid. de saúde (atenção)", key: "n_saude_atencao", width: 13 },
    { header: "Saúde por 10 mil hab", key: "saude_por_10k", width: 13, style: { numFmt: "0.00" } },
    { header: "Distância até saúde (m)", key: "dist_saude_m", width: 13, style: { numFmt: "#,##0" } },
    { header: "Pontos de ônibus", key: "n_paradas", width: 12 },
    { header: "Linhas de ônibus", key: "n_linhas", width: 12 },
    { header: "Partidas/semana", key: "partidas_semana", width: 13, style: { numFmt: "#,##0" } },
    { header: "Partidas por mil hab", key: "partidas_por_1k", width: 13, style: { numFmt: "0.0" } },
    { header: "Área verde (%)", key: "pct_area_verde", width: 12, style: { numFmt: "0.0" } },
    { header: "m² de verde por hab", key: "m2_verde_hab", width: 13, style: { numFmt: "0.0" } },
    { header: "Equip. de lazer", key: "n_equip_lazer", width: 11 },
    { header: "Coleta seletiva", key: "coleta", width: 12 },
    { header: "Dias da coleta", key: "coleta_dias", width: 22 },
    { header: "Ruas na rota de coleta", key: "coleta_ruas", width: 13 },
    // --- Censo 2022: saneamento, educação, cor/raça, idade e entorno
    { header: "Domicílios", key: "domicilios", width: 11, style: { numFmt: "#,##0" } },
    { header: "Esgoto em rede (%)", key: "pct_esgoto_rede", width: 12, style: { numFmt: "0.0" } },
    { header: "Esgotamento inadequado (%)", key: "pct_esgoto_inadeq", width: 13, style: { numFmt: "0.0" } },
    { header: "Água encanada (%)", key: "pct_agua_encanada", width: 12, style: { numFmt: "0.0" } },
    { header: "Lixo coletado (%)", key: "pct_lixo_coletado", width: 12, style: { numFmt: "0.0" } },
    { header: "Alfabetização 15+ (%)", key: "taxa_alfabetiz", width: 12, style: { numFmt: "0.00" } },
    { header: "População preta ou parda (%)", key: "pct_preta_parda", width: 14, style: { numFmt: "0.0" } },
    { header: "Crianças 0–9 anos (%)", key: "pct_criancas_0_9", width: 12, style: { numFmt: "0.0" } },
    { header: "Idosos 60+ (%)", key: "pct_idosos_60", width: 11, style: { numFmt: "0.0" } },
    { header: "Sem calçada (%)", key: "pct_sem_calcada", width: 12, style: { numFmt: "0.0" } },
    { header: "Sem arborização (%)", key: "pct_sem_arboriz", width: 12, style: { numFmt: "0.0" } },
    { header: "Sem bueiro (%)", key: "pct_sem_bueiro", width: 11, style: { numFmt: "0.0" } },
    { header: "Sem iluminação (%)", key: "pct_sem_ilumin", width: 12, style: { numFmt: "0.0" } },
    { header: "Sem rampa p/ cadeirante (%)", key: "pct_sem_rampa", width: 14, style: { numFmt: "0.0" } },
    // --- Fatores SINTÉTICOS (protótipo — dados fictícios; ver documentação) ---
    { header: "[SINT] IVS", key: "sint_ivs", width: 10, style: { numFmt: "0.000" } },
    { header: "[SINT] Desemprego (%)", key: "sint_desemprego", width: 13, style: { numFmt: "0.0" } },
    { header: "[SINT] Trabalho informal (%)", key: "sint_trab_informal", width: 14, style: { numFmt: "0.0" } },
    { header: "[SINT] Pobreza (%)", key: "sint_pobreza", width: 12, style: { numFmt: "0.0" } },
    { header: "[SINT] Jovens fora da escola (%)", key: "sint_jovens_fora_esc", width: 15, style: { numFmt: "0.0" } },
    { header: "[SINT] Mortalidade infantil (‰)", key: "sint_mort_infantil", width: 15, style: { numFmt: "0.0" } },
    { header: "[SINT] Mães chefes baixa esc. (%)", key: "sint_maes_chefes", width: 16, style: { numFmt: "0.0" } },
    { header: "[SINT] Aglomeração domiciliar (%)", key: "sint_aglomeracao", width: 16, style: { numFmt: "0.0" } },
    { header: "[SINT] Deslocamento > 1h (%)", key: "sint_tempo_desloc", width: 15, style: { numFmt: "0.0" } },
    { header: "[SINT] Sem veículo (%)", key: "sint_sem_veiculo", width: 13, style: { numFmt: "0.0" } },
    { header: "[SINT] Criminalidade (/10mil)", key: "sint_criminalidade", width: 15, style: { numFmt: "0.0" } },
  ];
  bairros.forEach((b) => ws.addRow(b));
  estilizar(ws);

  // Destaca em vermelho os bairros sem coleta seletiva divulgada.
  ws.eachRow((row, i) => {
    if (i === 1) return;
    if (row.getCell("coleta").value === "Não") {
      row.getCell("coleta").font = { color: { argb: "FFC94F2E" }, bold: true };
    }
  });

  // ---------------------------------------------------------------
  // Aba 2 — Fatores associados à renda
  // ---------------------------------------------------------------
  const wsC = wb.addWorksheet("Fatores x renda");
  wsC.columns = [
    { header: "Fator", key: "fator", width: 40 },
    { header: "Correlação com a renda (r)", key: "r", width: 20, style: { numFmt: "0.00" } },
    { header: "Leitura", key: "leitura", width: 62 },
  ];
  correl.resultados.forEach((x) => {
    const forca = Math.abs(x.r) >= 0.5 ? "forte" : Math.abs(x.r) >= 0.3 ? "moderada" : "fraca";
    const sentido =
      x.r > 0 ? "cresce junto com a renda" : "cresce onde a renda é menor";
    wsC.addRow({ ...x, leitura: `Associação ${forca}: ${sentido}.` });
  });
  wsC.addRow({});
  wsC.addRow({ fator: "Método", leitura: correl.metodo });
  wsC.addRow({ fator: "Aviso", leitura: correl.aviso });
  estilizar(wsC);

  // ---------------------------------------------------------------
  // Aba 3 — Coleta seletiva (detalhe por página da prefeitura)
  // ---------------------------------------------------------------
  const wsK = wb.addWorksheet("Coleta seletiva");
  wsK.columns = [
    { header: "Página da prefeitura", key: "pagina", width: 30 },
    { header: "Dia", key: "dia", width: 12 },
    { header: "Turno", key: "turno", width: 10 },
    { header: "Colocar o lixo até", key: "hora", width: 14 },
    { header: "Nº de ruas", key: "ruas", width: 11 },
    { header: "Nº de condomínios", key: "cond", width: 14 },
    { header: "Observação", key: "obs", width: 32 },
  ];
  coleta.bairros.forEach((b) =>
    (b.agendas || []).forEach((a) =>
      wsK.addRow({
        pagina: b.nome,
        dia: a.dia,
        turno: a.turno,
        hora: a.horario_limite,
        ruas: a.ruas.length,
        cond: a.condominios.length,
        obs: a.observacao || "",
      })
    )
  );
  estilizar(wsK);

  // ---------------------------------------------------------------
  // Aba 4 — Linhas de ônibus
  // ---------------------------------------------------------------
  const wsT = wb.addWorksheet("Linhas de ônibus");
  wsT.columns = [
    { header: "Linha", key: "linha", width: 10 },
    { header: "Itinerário", key: "nome", width: 52 },
    { header: "Partidas por semana", key: "partidas", width: 16, style: { numFmt: "#,##0" } },
    { header: "Sentidos", key: "sentidos", width: 10 },
    { header: "Pontos atendidos", key: "paradas", width: 14 },
  ];
  sou.linhas.forEach((l) =>
    wsT.addRow({
      linha: l.linha,
      nome: l.nome,
      partidas: l.partidas_semana,
      sentidos: l.sentidos.length,
      paradas: l.sentidos.reduce((a, s) => a + s.n_paradas, 0),
    })
  );
  estilizar(wsT);

  // ---------------------------------------------------------------
  // Aba 5 — Fontes e dicionário
  // ---------------------------------------------------------------
  const wsF = wb.addWorksheet("Fontes e dicionário");
  wsF.columns = [
    { header: "Camada", key: "camada", width: 24 },
    { header: "Descrição", key: "descricao", width: 54 },
    { header: "Feições", key: "feicoes", width: 9 },
    { header: "Fonte", key: "fonte", width: 34 },
  ];
  const fontePorCamada = {};
  Object.entries(manifest.fontes).forEach(([fonte, camadas]) =>
    camadas.forEach((c) => (fontePorCamada[c] = fonte))
  );
  manifest.camadas.forEach((c) =>
    wsF.addRow({
      camada: c.camada,
      descricao: c.descricao,
      feicoes: c.feicoes,
      fonte: fontePorCamada[c.camada] || "",
    })
  );
  wsF.addRow({});
  wsF.addRow({ camada: "CRS", descricao: manifest.crs });
  wsF.addRow({ camada: "Gerado em", descricao: manifest.gerado_em });
  estilizar(wsF);

  const wsD = wb.addWorksheet("Campos (GeoJSON x DBF)");
  wsD.columns = [
    { header: "Camada", key: "camada", width: 24 },
    { header: "Campo (GeoJSON)", key: "geojson", width: 24 },
    { header: "Campo (Shapefile/DBF)", key: "dbf", width: 24 },
    { header: "Tipo", key: "tipo", width: 12 },
  ];
  manifest.camadas.forEach((c) =>
    c.campos.forEach((f) => wsD.addRow({ camada: c.camada, ...f }))
  );
  estilizar(wsD);

  wb.xlsx.writeFile(SAIDA).then(() => {
    console.log(`Planilha gerada: ${path.relative(RAIZ, SAIDA)}`);
    console.log(
      `  ${wb.worksheets.length} abas: ${wb.worksheets.map((w) => w.name).join(", ")}`
    );
  });
}

main();

/**
 * Registro central das camadas do mapa. Ver README.md para adicionar novas.
 *
 * indicadores → seleção única, pintam o bairro (choropleth)
 * camadas     → múltipla escolha, sobrepõem polígonos/linhas/pontos
 */
const FONTES = {
  ibge: "IBGE — Censo 2022",
  prefeitura: "Prefeitura de São Vicente — Carta de Serviços",
  cnes: "CNES — Ministério da Saúde",
  sou: "SOU Transportes / Bus2you",
  osm: "OpenStreetMap (ODbL 1.0)",
  sintetico: "Sintético (protótipo — dados fictícios)",
};

const LAYERS_CONFIG = {
  indicadores: {
    renda: {
      file: "data/bairros_indicadores.geojson",
      label: "Renda média",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "renda_media_rs",
      scale: { min: 1400, max: 5300, colorFrom: "#f4ede4", colorTo: "#007a4a" },
      legendTitle: "Renda média domiciliar (R$/mês)",
      legendSteps: [
        { value: 1500, label: "R$ 1.500" },
        { value: 2500, label: "R$ 2.500" },
        { value: 3800, label: "R$ 3.800" },
        { value: 5300, label: "R$ 5.300" },
      ],
      popupRows: (p) => [
        ["Renda média", `R$ ${fmt(p.renda_media_rs)}/mês`],
        ["Em salários mínimos", `${fmt(p.renda_sm)} SM`],
        ["População", fmt(p.populacao)],
        ["Setores censitários", p.n_setores],
      ],
    },

    densidade: {
      file: "data/bairros_indicadores.geojson",
      label: "Densidade demográfica",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "densidade_hab_km2",
      scale: { min: 2000, max: 20000, colorFrom: "#fff1e0", colorTo: "#e87722" },
      legendTitle: "Habitantes por km²",
      legendSteps: [
        { value: 2000, label: "≤ 2 mil hab/km²" },
        { value: 8000, label: "~8 mil hab/km²" },
        { value: 14000, label: "~14 mil hab/km²" },
        { value: 20000, label: "≥ 20 mil hab/km²" },
      ],
      popupRows: (p) => [
        ["População", fmt(p.populacao)],
        ["Área", `${p.area_km2} km²`],
        ["Densidade", `${fmt(p.densidade_hab_km2)} hab/km²`],
      ],
    },

    favelas: {
      file: "data/bairros_indicadores.geojson",
      label: "Favelas e comunidades",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "pct_area_favela",
      scale: { min: 0, max: 60, colorFrom: "#f7f0ee", colorTo: "#c94f2e" },
      legendTitle: "% da área do bairro em favela",
      legendSteps: [
        { value: 0, label: "Nenhuma" },
        { value: 15, label: "15% do bairro" },
        { value: 35, label: "35% do bairro" },
        { value: 60, label: "60% ou mais" },
      ],
      popupRows: (p) => [
        ["Área em favela", `${p.pct_area_favela}%`],
        ["Nº de comunidades", p.n_favelas],
        ["Renda média", `R$ ${fmt(p.renda_media_rs)}/mês`],
        ["População", fmt(p.populacao)],
      ],
    },

    saude: {
      file: "data/bairros_indicadores.geojson",
      label: "Acesso à saúde",
      fonte: FONTES.cnes,
      tipo: "gradiente",
      // Distância até o equipamento de atenção mais próximo: quanto maior, pior.
      valueField: "dist_saude_m",
      nameField: "bairro",
      scale: { min: 1600, max: 0, colorFrom: "#eef6fb", colorTo: "#00a3e0" },
      legendTitle: "Distância até a unidade de saúde mais próxima",
      legendSteps: [
        { value: 0, label: "No próprio bairro" },
        { value: 500, label: "~500 m" },
        { value: 1000, label: "~1 km" },
        { value: 1600, label: "1,6 km ou mais" },
      ],
      popupRows: (p) => [
        ["Unidades de atenção no bairro", p.n_saude_atencao],
        ["Distância até a mais próxima", `${fmt(p.dist_saude_m)} m`],
        ["Por 10 mil habitantes", p.saude_por_10k],
        ["Total de estabelecimentos", p.n_saude],
      ],
    },

    transporte: {
      file: "data/bairros_indicadores.geojson",
      label: "Oferta de transporte",
      fonte: FONTES.sou,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "partidas_por_1k",
      scale: { min: 0, max: 120, colorFrom: "#f2eef7", colorTo: "#5b3f8c" },
      legendTitle: "Partidas de ônibus por semana / mil habitantes",
      legendSteps: [
        { value: 0, label: "Sem linha municipal" },
        { value: 30, label: "30 partidas/mil hab" },
        { value: 70, label: "70 partidas/mil hab" },
        { value: 120, label: "120 ou mais" },
      ],
      popupRows: (p) => [
        ["Partidas por semana", fmt(p.partidas_semana)],
        ["Por mil habitantes", p.partidas_por_1k],
        ["Linhas que servem", p.n_linhas],
        ["Pontos de ônibus", `${p.n_paradas} (${fmt(p.paradas_km2)} por km²)`],
      ],
    },

    faixa_etaria: {
      file: "data/bairros_indicadores.geojson",
      label: "Crianças de 0 a 9 anos",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "pct_criancas_0_9",
      scale: { min: 6, max: 19, colorFrom: "#fdf4ec", colorTo: "#d05a1e" },
      legendTitle: "% da população com 0 a 9 anos",
      legendSteps: [
        { value: 6, label: "6%" },
        { value: 10, label: "10%" },
        { value: 14, label: "14%" },
        { value: 19, label: "19% ou mais" },
      ],
      popupRows: (p) => [
        ["Crianças de 0 a 9 anos", `${p.pct_criancas_0_9}%`],
        ["Idosos de 60 anos ou mais", `${p.pct_idosos_60}%`],
        ["População", fmt(p.populacao)],
        ["Renda média", `R$ ${fmt(p.renda_media_rs)}/mês`],
      ],
    },

    cor_raca: {
      file: "data/bairros_indicadores.geojson",
      label: "População preta ou parda",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "pct_preta_parda",
      scale: { min: 25, max: 70, colorFrom: "#f6f1ea", colorTo: "#874a33" },
      legendTitle: "% da população preta ou parda",
      legendSteps: [
        { value: 25, label: "25%" },
        { value: 40, label: "40%" },
        { value: 55, label: "55%" },
        { value: 70, label: "70% ou mais" },
      ],
      popupRows: (p) => [
        ["População preta ou parda", `${p.pct_preta_parda}%`],
        ["População branca", `${p.pct_branca ?? "—"}%`],
        ["Renda média", `R$ ${fmt(p.renda_media_rs)}/mês`],
        ["População", fmt(p.populacao)],
      ],
    },

    saneamento: {
      file: "data/bairros_indicadores.geojson",
      label: "Esgotamento sanitário",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      // Invertido: menos rede = cor mais forte (pior).
      valueField: "pct_esgoto_rede",
      nameField: "bairro",
      scale: { min: 100, max: 60, colorFrom: "#eef7f2", colorTo: "#1a4f7a" },
      legendTitle: "% de domicílios com esgoto ligado à rede",
      legendSteps: [
        { value: 100, label: "100% na rede" },
        { value: 90, label: "90%" },
        { value: 75, label: "75%" },
        { value: 60, label: "60% ou menos" },
      ],
      popupRows: (p) => [
        ["Esgoto em rede", `${p.pct_esgoto_rede}%`],
        ["Esgotamento inadequado", `${p.pct_esgoto_inadeq}%`],
        ["Água encanada dentro do domicílio", `${p.pct_agua_encanada}%`],
        ["Lixo coletado", `${p.pct_lixo_coletado}%`],
        ["Domicílios sem banheiro", `${p.pct_sem_banheiro}%`],
        ["Domicílios", fmt(p.domicilios)],
      ],
    },

    alfabetizacao: {
      file: "data/bairros_indicadores.geojson",
      label: "Alfabetização",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      valueField: "taxa_alfabetiz",
      nameField: "bairro",
      scale: { min: 100, max: 93, colorFrom: "#f3f0f7", colorTo: "#5b3f8c" },
      legendTitle: "Taxa de alfabetização (15 anos ou mais)",
      legendSteps: [
        { value: 99.8, label: "99,8%" },
        { value: 98, label: "98%" },
        { value: 95.5, label: "95,5%" },
        { value: 93, label: "93% ou menos" },
      ],
      popupRows: (p) => [
        ["Taxa de alfabetização", `${p.taxa_alfabetiz}%`],
        ["Pessoas não alfabetizadas (15+)", fmt(p.n_nao_alfabetizados)],
        ["Renda média", `R$ ${fmt(p.renda_media_rs)}/mês`],
      ],
    },

    entorno: {
      file: "data/bairros_indicadores.geojson",
      label: "Arborização do entorno",
      fonte: FONTES.ibge,
      tipo: "gradiente",
      valueField: "pct_sem_arboriz",
      nameField: "bairro",
      scale: { min: 0, max: 85, colorFrom: "#eef7f0", colorTo: "#6b4f1d" },
      legendTitle: "% de domicílios em rua sem arborização",
      legendSteps: [
        { value: 0, label: "Todas arborizadas" },
        { value: 30, label: "30% sem árvores" },
        { value: 60, label: "60% sem árvores" },
        { value: 85, label: "85% ou mais" },
      ],
      popupRows: (p) => [
        ["Sem arborização", `${p.pct_sem_arboriz}%`],
        ["Sem calçada", `${p.pct_sem_calcada}%`],
        ["Sem bueiro", `${p.pct_sem_bueiro}%`],
        ["Sem iluminação pública", `${p.pct_sem_ilumin}%`],
        ["Via pavimentada", `${p.pct_via_pavim}%`],
        ["Sem rampa para cadeirante", `${p.pct_sem_rampa}%`],
        // Resumo por bairro das camadas de área verde e lazer, que sozinhas só
        // mostram os polígonos individuais.
        ["Área verde do bairro", `${p.pct_area_verde}%`],
        ["Área verde por habitante", `${fmt(p.m2_verde_hab)} m²`],
        ["Equipamentos de lazer", `${p.n_equip_lazer} (${fmt(p.lazer_por_10k)} por 10 mil hab)`],
      ],
    },

    // ---- Fatores da literatura de vulnerabilidade social (dados sintéticos) ----
    // Grounded em IVS/IPEA, SVI/CDC e na revisão de 121 índices (BMC 2023).
    ivs: {
      file: "data/bairros_indicadores.geojson",
      label: "Vulnerabilidade social (IVS)",
      fonte: FONTES.sintetico,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "sint_ivs",
      scale: { min: 0, max: 1, colorFrom: "#f2f7f4", colorTo: "#5c1a1a" },
      legendTitle: "Índice de Vulnerabilidade Social (0 = melhor, 1 = pior)",
      legendSteps: [
        { value: 0, label: "Muito baixa" },
        { value: 0.35, label: "Baixa" },
        { value: 0.65, label: "Alta" },
        { value: 1, label: "Muito alta" },
      ],
      popupRows: (p) => [
        ["IVS sintético", p.sint_ivs],
        ["Renda e trabalho — desemprego", `${p.sint_desemprego}%`],
        ["Capital humano — jovens fora da escola", `${p.sint_jovens_fora_esc}%`],
        ["Infra/moradia — aglomeração", `${p.sint_aglomeracao}%`],
        ["Renda média (real)", `R$ ${fmt(p.renda_media_rs)}/mês`],
      ],
    },

    desemprego: {
      file: "data/bairros_indicadores.geojson",
      label: "Desemprego",
      fonte: FONTES.sintetico,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "sint_desemprego",
      scale: { min: 4, max: 22, colorFrom: "#fdf3ee", colorTo: "#a83232" },
      legendTitle: "Taxa de desocupação (% da força de trabalho)",
      legendSteps: [
        { value: 4, label: "4%" },
        { value: 10, label: "10%" },
        { value: 16, label: "16%" },
        { value: 22, label: "22% ou mais" },
      ],
      popupRows: (p) => [
        ["Desemprego", `${p.sint_desemprego}%`],
        ["Trabalho informal", `${p.sint_trab_informal}%`],
        ["Pessoas em situação de pobreza", `${p.sint_pobreza}%`],
      ],
    },

    pobreza: {
      file: "data/bairros_indicadores.geojson",
      label: "Pobreza",
      fonte: FONTES.sintetico,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "sint_pobreza",
      scale: { min: 3, max: 60, colorFrom: "#f4f0f7", colorTo: "#4a1d6b" },
      legendTitle: "% em domicílios com renda per capita < ½ SM",
      legendSteps: [
        { value: 3, label: "3%" },
        { value: 20, label: "20%" },
        { value: 40, label: "40%" },
        { value: 60, label: "60% ou mais" },
      ],
      popupRows: (p) => [
        ["Pobreza", `${p.sint_pobreza}%`],
        ["Aglomeração domiciliar", `${p.sint_aglomeracao}%`],
        ["Domicílios sem veículo", `${p.sint_sem_veiculo}%`],
      ],
    },

    educacao_jovem: {
      file: "data/bairros_indicadores.geojson",
      label: "Jovens fora da escola",
      fonte: FONTES.sintetico,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "sint_jovens_fora_esc",
      scale: { min: 1, max: 12, colorFrom: "#eef4fb", colorTo: "#1a3f7a" },
      legendTitle: "% de 6 a 14 anos fora da escola",
      legendSteps: [
        { value: 1, label: "1%" },
        { value: 4, label: "4%" },
        { value: 8, label: "8%" },
        { value: 12, label: "12% ou mais" },
      ],
      popupRows: (p) => [
        ["Jovens (6–14) fora da escola", `${p.sint_jovens_fora_esc}%`],
        ["Mães chefes de baixa escolaridade", `${p.sint_maes_chefes}%`],
        ["Mortalidade infantil", `${p.sint_mort_infantil} / mil`],
      ],
    },

    seguranca: {
      file: "data/bairros_indicadores.geojson",
      label: "Criminalidade",
      fonte: FONTES.sintetico,
      tipo: "gradiente",
      nameField: "bairro",
      valueField: "sint_criminalidade",
      scale: { min: 10, max: 85, colorFrom: "#fbf1f0", colorTo: "#7a1420" },
      legendTitle: "Crimes violentos por 10 mil habitantes",
      legendSteps: [
        { value: 10, label: "10" },
        { value: 35, label: "35" },
        { value: 60, label: "60" },
        { value: 85, label: "85 ou mais" },
      ],
      popupRows: (p) => [
        ["Crimes violentos / 10 mil hab", p.sint_criminalidade],
        ["Tempo de deslocamento > 1h", `${p.sint_tempo_desloc}%`],
        ["Domicílios sem veículo", `${p.sint_sem_veiculo}%`],
      ],
    },

    coleta: {
      file: "data/bairros_indicadores.geojson",
      label: "Coleta seletiva",
      fonte: FONTES.prefeitura,
      tipo: "categorico",
      nameField: "bairro",
      valueField: "coleta",
      cores: { Sim: "#007a4a", "Não": "#c94f2e" },
      corPadrao: "#e5ded8",
      legendTitle: "Atendido pela coleta seletiva",
      legendSteps: [
        { value: "Sim", label: "Rota divulgada" },
        { value: "Não", label: "Sem rota divulgada" },
      ],
      popupRows: (p) => [
        ["Coleta seletiva", p.coleta],
        ["Dias", p.coleta_dias || "—"],
        ["Coletas por semana", p.coleta_freq || "—"],
        ["Turno", p.coleta_turno || "—"],
        ["Colocar o lixo até", p.coleta_hora || "—"],
        ["Ruas atendidas", p.coleta_ruas || 0],
        ["População", fmt(p.populacao)],
      ],
    },
  },

  camadas: {
    favelas: {
      file: "data/favelas.geojson",
      color: "#c94f2e",
      label: "Favelas e comunidades urbanas",
      fonte: FONTES.ibge,
      geometria: "poligono",
      popup: (p) => [["Área", `${fmt(Math.round(p.area_m2 / 100) / 100)} ha`]],
      titulo: (p) => p.nome || "Comunidade",
    },
    saude: {
      file: "data/saude.geojson",
      color: "#00a3e0",
      label: "Estabelecimentos de saúde",
      fonte: FONTES.cnes,
      geometria: "ponto",
      popup: (p) => [
        ["Tipo", p.tipo],
        ["Rede de atenção", p.atencao],
        ["Endereço", p.endereco],
        ["Atendimento", p.turno],
      ],
      titulo: (p) => p.nome,
    },
    areas_verdes: {
      file: "data/areas_verdes.geojson",
      color: "#007a4a",
      label: "Áreas verdes",
      fonte: FONTES.osm,
      geometria: "poligono",
      popup: (p) => [
        ["Categoria", p.categoria],
        ["Área", `${fmt(Math.round(p.area_m2 / 100) / 100)} ha`],
      ],
      titulo: (p) => p.nome || p.categoria,
    },
    parques_lazer: {
      file: "data/parques_lazer.geojson",
      color: "#2fae7a",
      label: "Parques, praças e lazer",
      fonte: FONTES.osm,
      geometria: "poligono",
      popup: (p) => [
        ["Categoria", p.categoria],
        ["Área", `${fmt(Math.round(p.area_m2 / 100) / 100)} ha`],
      ],
      titulo: (p) => p.nome || p.categoria,
    },
    transporte_rotas: {
      file: "data/transporte_rotas.geojson",
      color: "#5b3f8c",
      label: "Linhas de ônibus",
      fonte: FONTES.sou,
      geometria: "linha",
      popup: (p) => [
        ["Linha", p.linha],
        ["Partidas por semana", fmt(p.partidas_semana)],
        ["Sentidos", p.n_sentidos],
      ],
      titulo: (p) => `${p.linha} — ${p.nome}`,
    },
    transporte_paradas: {
      file: "data/transporte_paradas.geojson",
      color: "#874a33",
      label: "Pontos de ônibus",
      fonte: FONTES.sou,
      geometria: "ponto",
      popup: (p) => [
        ["Linhas", p.linhas || "—"],
        ["Nº de linhas", p.n_linhas],
      ],
      titulo: (p) => p.nome || "Ponto de ônibus",
    },
  },
};

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return Number(v).toLocaleString("pt-BR");
}

/**
 * Métricas usadas nas ferramentas de desigualdade (entre/dentro de bairros e
 * comparação de áreas). `polo` diz qual direção é pior, para colorir e para o
 * texto do "gap". `unidade` formata o valor; `campo` é a propriedade no GeoJSON.
 */
const METRICAS = [
  { campo: "sint_ivs", label: "Vulnerabilidade social (IVS)", unidade: "idx", polo: "maior", grupo: "Síntese", fonte: FONTES.sintetico },
  { campo: "renda_media_rs", label: "Renda média domiciliar", unidade: "R$", polo: "menor", grupo: "Renda e trabalho", fonte: FONTES.ibge },
  { campo: "sint_pobreza", label: "Pobreza", unidade: "%", polo: "maior", grupo: "Renda e trabalho", fonte: FONTES.sintetico },
  { campo: "sint_desemprego", label: "Desemprego", unidade: "%", polo: "maior", grupo: "Renda e trabalho", fonte: FONTES.sintetico },
  { campo: "sint_trab_informal", label: "Trabalho informal", unidade: "%", polo: "maior", grupo: "Renda e trabalho", fonte: FONTES.sintetico },
  { campo: "taxa_alfabetiz", label: "Alfabetização (15+)", unidade: "%", polo: "menor", grupo: "Capital humano", fonte: FONTES.ibge },
  { campo: "sint_jovens_fora_esc", label: "Jovens fora da escola", unidade: "%", polo: "maior", grupo: "Capital humano", fonte: FONTES.sintetico },
  { campo: "sint_mort_infantil", label: "Mortalidade infantil", unidade: "‰", polo: "maior", grupo: "Capital humano", fonte: FONTES.sintetico },
  { campo: "pct_esgoto_rede", label: "Esgoto em rede", unidade: "%", polo: "menor", grupo: "Infraestrutura", fonte: FONTES.ibge },
  { campo: "sint_aglomeracao", label: "Aglomeração domiciliar", unidade: "%", polo: "maior", grupo: "Infraestrutura", fonte: FONTES.sintetico },
  { campo: "sint_tempo_desloc", label: "Deslocamento > 1h", unidade: "%", polo: "maior", grupo: "Mobilidade", fonte: FONTES.sintetico },
  { campo: "sint_sem_veiculo", label: "Domicílios sem veículo", unidade: "%", polo: "maior", grupo: "Mobilidade", fonte: FONTES.sintetico },
  { campo: "pct_preta_parda", label: "População preta ou parda", unidade: "%", polo: "maior", grupo: "Composição", fonte: FONTES.ibge },
  { campo: "sint_criminalidade", label: "Criminalidade", unidade: "/10mil", polo: "maior", grupo: "Segurança", fonte: FONTES.sintetico },
  { campo: "dist_saude_m", label: "Distância até a saúde", unidade: "m", polo: "maior", grupo: "Serviços", fonte: FONTES.cnes },
];

function fmtMetrica(v, unidade) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  if (unidade === "R$") return "R$ " + fmt(Math.round(v));
  if (unidade === "%") return fmt(v) + "%";
  if (unidade === "idx") return Number(v).toFixed(2);
  if (unidade === "‰") return fmt(v) + "‰";
  if (unidade === "/10mil") return fmt(v);
  if (unidade === "m") return fmt(Math.round(v)) + " m";
  return fmt(v);
}

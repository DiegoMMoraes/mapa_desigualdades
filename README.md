# Mapa das Desigualdades — São Vicente

Módulo de mapa interativo para o Observatório de Justiça Climática de São Vicente.
Camadas selecionáveis por bairro para gestores públicos, imprensa e pesquisadores
enxergarem a relação espacial entre vulnerabilidade social e acesso a serviços.

Identidade visual conforme o *Manual de identidade visual — Coop Clima São Vicente*.

**A procedência e o tratamento de cada dado estão em
[DOCUMENTACAO_DADOS.md](DOCUMENTACAO_DADOS.md).**

## Como rodar

Site estático (HTML/CSS/JS + [Leaflet](https://leafletjs.com/)), sem build. Os dados
são carregados via `fetch`, então é preciso servir por HTTP (abrir o `index.html`
por `file://` não funciona).

```bash
npm install
npm start          # http://localhost:8080
```

## Estrutura

```
index.html                       página; o painel é montado a partir da config
css/style.css                    paleta e tipografia do manual de marca
js/layers-config.js              registro central das camadas  ← edite aqui
js/app.js                        mapa: choropleth, overlays, popups, legenda

Bases/                           dados brutos coletados (fonte da verdade)
data/*.geojson                   camadas tratadas (mapa web, APIs)
data/shapefiles/<tema>/          camadas tratadas (QGIS/ArcGIS)
data/manifest.json               índice + dicionário de campos GeoJSON↔DBF
data/correlacoes_renda.json      fatores associados à renda
data/Mapa_das_Desigualdades_Sao_Vicente.xlsx   planilha-resumo (6 abas)

scripts/                         coleta e processamento (ver DOCUMENTACAO_DADOS.md)
```

## Comandos

```bash
npm run coletar:tudo      # recoleta todas as fontes externas (~5 min)
npm run build             # gera camadas, shapefiles, manifesto e planilha
```

Coletas individuais: `coleta:prefeitura`, `transporte:sou`, `fontes:oficiais`,
`censo:agregados`, `verdes:osm`.

## Camadas

Todas em **SIRGAS 2000 (EPSG:4674)**, com `.prj` e `.cpg` (UTF-8).

| Camada | Geometria | Feições | Fonte |
|---|---|---|---|
| `bairros_indicadores` | polígono | 30 | consolidado — todos os indicadores |
| `renda` | polígono | 30 | IBGE Censo 2022 |
| `densidade` | polígono | 30 | IBGE Censo 2022 |
| `favelas` | polígono | 38 | IBGE Censo 2022 (FCU) |
| `saude` | ponto | 330 | CNES / Ministério da Saúde |
| `coleta_seletiva` | polígono | 30 | Prefeitura de São Vicente |
| `transporte_rotas` | linha | 14 | SOU Transportes |
| `transporte_paradas` | ponto | 452 | SOU Transportes |
| `areas_verdes` | polígono | 181 | OpenStreetMap |
| `parques_lazer` | polígono | 155 | OpenStreetMap |

Os indicadores por bairro incluem ainda saneamento, alfabetização, cor/raça,
estrutura etária e qualidade do entorno urbano (calçada, arborização, bueiro,
iluminação), vindos dos **Agregados por Bairro do Censo 2022**.

`bairros_indicadores` é a camada para análise: um registro por bairro com renda,
densidade, % em favela, acesso a saúde, oferta de transporte, coleta seletiva e
área verde.

Cada camada sai em **GeoJSON** (nomes de campo completos) e **Shapefile** (o DBF
trunca nomes em 10 caracteres — `densidade_hab_km2` vira `densidade_`). O
`data/manifest.json` mapeia os dois.

## Ressalvas de leitura

Três pontos que mudam a interpretação e estão detalhados na
[documentação](DOCUMENTACAO_DADOS.md):

- **`coleta = "Não"`** significa *sem rota divulgada no portal da Prefeitura para
  aquele bairro* — não ausência comprovada de serviço.
- **Transporte** cobre só as linhas municipais da SOU; intermunicipais e VLT não
  entram. `partidas_semana` conta integralmente linhas que apenas atravessam o
  bairro.
- **Não há camada de risco de inundação.** As bases entregues eram inutilizáveis e
  São Vicente não consta na BATER/IBGE 2018. Ver seção 10 da documentação.

Além disso, boa parte das bases originais foi descartada por não conter dado
utilizável (polígonos únicos de 9 vértices cobrindo 72–100% do município) —
a tabela completa está na seção 11 da documentação.

## Integração com o Observatório

Destino: <https://guilhermesecundo.github.io/observatorio-home/#observatorio>.
O módulo é autocontido e não assume framework — dá para integrar como `<iframe>`
apontando para o `index.html`, ou copiando `css/`, `js/` e `data/` e reaproveitando
o `#mapa-container` da home. Vale alinhar com a equipe do observatório qual das
duas antes de fechar.

## Identidade visual

- **Institucionais:** verde `#007a4a`, marrom `#874a33`, azul `#00a3e0`, laranja
  `#e87722`. **Apoio:** creme `#f9f3f0` (fundo), tinta `#1a1e2c` (texto).
- **Tipografia:** Londrina Solid (títulos) + Roboto (texto), via Google Fonts.

## Créditos

IBGE (Censo 2022) · CNES/Ministério da Saúde · Prefeitura de São Vicente ·
SOU Transportes · **© colaboradores do OpenStreetMap (ODbL 1.0 — atribuição
obrigatória)**.

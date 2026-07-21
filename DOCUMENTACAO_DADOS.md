# Documentação dos dados — Mapa das Desigualdades de São Vicente

Como cada camada foi obtida, tratada e o que ela permite (ou não permite) afirmar.
Última atualização: julho de 2026.

Todas as saídas estão em **SIRGAS 2000 (EPSG:4674)**, em GeoJSON (`data/`) e
Shapefile (`data/shapefiles/`), mais a planilha
`data/Mapa_das_Desigualdades_Sao_Vicente.xlsx`.

---

## Índice

1. [Base territorial: bairros](#1-base-territorial-bairros)
2. [Renda](#2-renda)
3. [Densidade demográfica](#3-densidade-demográfica)
4. [Favelas e comunidades urbanas](#4-favelas-e-comunidades-urbanas)
5. [Estabelecimentos de saúde](#5-estabelecimentos-de-saúde)
6. [Transporte público](#6-transporte-público)
7. [Coleta seletiva](#7-coleta-seletiva)
8. [Áreas verdes / parques e lazer](#8-áreas-verdes-parques-e-lazer)
9. [Saneamento, educação, cor/raça, idade e entorno urbano](#9-saneamento-educação-corraça-idade-e-entorno-urbano)
10. [Risco de inundação](#10-risco-de-inundação--não-entregue)
11. [Bases descartadas](#11-bases-descartadas-e-por-quê)
12. [Fatores de desigualdade identificados](#12-fatores-de-desigualdade-identificados)
13. [Reprodutibilidade](#13-reprodutibilidade)

---

## 1. Base territorial: bairros

**Fonte:** IBGE, Censo 2022 — malha de setores censitários
(`Bases/RENDA/Renda_2022/*.shp`, 672 setores).

**Tratamento**
1. Agrupamento dos setores pelo campo `NM_BAIRRO`.
2. Dissolução das geometrias de cada grupo com `turf.union` → 30 polígonos.
3. Os setores sem `NM_BAIRRO` correspondem à porção continental (Serra do Mar):
   555 habitantes, 87% de vegetação. Foram nomeados **"Área continental (rural)"**
   e recebem `zona = "continental"`, usado pelo mapa para enquadrar só a mancha
   urbana na abertura — sem isso a mancha continental, enorme e quase desabitada,
   jogava a cidade para o canto da tela.

**Validação:** a união dos 30 bairros fecha em **148,49 km²**, contra os ~148 km²
oficiais do IBGE. Confere.

> As análises por bairro usam os **29 bairros urbanos**; a área continental é
> mantida nos arquivos por completude, mas distorce médias se incluída.

---

## 2. Renda

**Fonte:** IBGE, Censo 2022 (mesmo shapefile dos setores).

**Campo usado:** `field_5` — renda média domiciliar em **R$/mês** por setor
(874 a 8.977; 566 valores distintos em 626 setores).

**Tratamento:** média por bairro **ponderada pela população do setor** (`hab_setor`,
cruzado por `CD_SETOR` com a base de densidade). Um setor de 90 domicílios não pode
pesar o mesmo que um de 900.

### Correção importante em relação à primeira entrega

A primeira versão usava o campo `renda_sal` (classe ordinal 1–7) e rotulava as
faixas como frações de salário mínimo — **isso estava errado**. Verificando contra
os próprios dados:

```
renda_sal == round(field_5 / 1212)      (1212 = salário mínimo de 2022)
```

| Classe | Faixa real em R$ | Em salários mínimos | Rótulo errado anterior |
|---|---|---|---|
| 1 | 874 – 1.815 | 0,7 – 1,5 SM | ~~"Até 1/8 SM"~~ |
| 3 | 3.065 – 4.188 | 2,5 – 3,5 SM | ~~"1/4 a 1/2 SM"~~ |
| 7 | 8.977 | 7,4 SM | ~~"Mais de 5 SM"~~ |

As classes são faixas de **1 salário mínimo**, não frações. O mapa mostrava renda
até 8x menor do que a real. Agora o indicador exibe o valor em R$ e o equivalente
em SM, sem faixas inventadas.

**Amplitude entre bairros:** R$ 1.498 (Vila Nova Mariana) a R$ 5.234 (Boa Vista) —
razão de 3,5x.

---

## 3. Densidade demográfica

**Fonte:** IBGE, Censo 2022 (`Bases/DENSIDADE/Densidade_demográfica_2022/*.shp`,
667 setores).

**Tratamento:** soma de `hab_setor` e de `area_setor` por bairro; densidade =
população total ÷ área total. **Não** é a média das densidades dos setores —
média de razões dá resultado errado quando os setores têm áreas diferentes.

---

## 4. Favelas e comunidades urbanas

**Fonte:** IBGE, Censo 2022 — *Favelas e Comunidades Urbanas*, malha oficial
([poligonos_FCUs_shp.zip](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Favelas_e_comunidades_urbanas_Resultados_do_universo/arquivos_vetoriais/)).

**Tratamento:** filtro por `cd_mun = 3551009`. Filtrar por nome traria "Vila São
Vicente" e similares de outros estados — o arquivo nacional tem 12.348 polígonos.
Resultado: **38 comunidades nomeadas** (Sambaiatuba, Dique do Caixeta, Vila Ponte
Nova, Morro do Asa Delta, Vila Nova Mariana...).

**Indicador por bairro:** `pct_area_favela` = área da interseção ÷ área do bairro.
Os polígonos são dissolvidos antes do cruzamento para não contar área sobreposta
duas vezes.

> É percentual de **área**, não de população — o IBGE não divulga população da FCU
> nesse arquivo. Um bairro com 30% da área em favela não tem necessariamente 30%
> dos moradores nela.

---

## 5. Estabelecimentos de saúde

**Fonte:** CNES / Ministério da Saúde, API de dados abertos
(`apidadosabertos.saude.gov.br/cnes/estabelecimentos`, `codigo_municipio=355100`).

**Tratamento**
1. Paginação de 20 em 20 — a API ignora `limit` acima disso (uma primeira tentativa
   com `limit=100` retornou só 20 registros e parecia ser o total).
2. 429 estabelecimentos no total; **332 com coordenada** (97 sem, descartados do
   mapa mas contabilizados no manifesto).
3. Tipo traduzido pela tabela oficial (`/cnes/tipounidades`), não por códigos
   assumidos de memória.
4. Marcação `atencao = "Sim"` para a rede de atenção — UBS, posto, policlínica,
   pronto atendimento, hospital, CAPS, hospital-dia — separando dos 142 consultórios
   isolados, 19 farmácias e 29 unidades de apoio diagnóstico, que não representam
   acesso à saúde pública.

**Indicadores por bairro:** contagem total, contagem da rede de atenção,
unidades por 10 mil habitantes e **distância do centro do bairro até a unidade de
atenção mais próxima** — esta última captura bairros que não têm nenhuma mas fazem
divisa com uma.

**5 bairros urbanos sem nenhuma unidade de atenção:** Beira Mar, Nova São Vicente,
Vila Nossa Senhora de Fátima, Vila Nova Mariana e Vila Voturuá.

---

## 6. Transporte público

**Fonte:** SOU Transportes — linhas municipais de São Vicente.

**Caminho até os dados.** A página
[soutransportes.com.br/sao-vicente/linhas-e-horarios](https://soutransportes.com.br/sao-vicente/linhas-e-horarios/)
não tem os dados no HTML: embute um `<iframe>` do app `bus2.info/2you/#/3vc0l`, que
é um app Flutter e renderiza em canvas — não há DOM para raspar. Os endpoints foram
extraídos do `main.dart.js`: o app consome a API pública `mobilibus.com/api/*`.

```
project-details?project_hash=3vc0l   →  projectId 757 ("São Vicente, SP", agência SOU)
routes?project_id=757                →  14 linhas
timetable?route_id=…                 →  partidas por sentido + tripIds
trip-details?trip_id=…               →  shape (polyline codificada) + paradas
```

O campo `shape` vem como *encoded polyline* do Google e é decodificado pelo script.

**robots.txt:** `soutransportes.com.br` libera tudo exceto `/wp-admin/`;
`bus2.info` é `Allow: /`. As chamadas são espaçadas (400–600 ms).

**Resultado:** 14 linhas municipais, **452 pontos de ônibus distintos**, 5.005
vértices de traçado e o número de partidas por semana de cada linha.

### Por que não foi usado o wikiroutes

O `.docx` original apontava para `wikiroutes.info`, mas o `robots.txt` daquele site
bloqueia explicitamente o agente (`User-agent: ClaudeBot / Disallow: /`), então ele
não foi acessado.

### Ressalva no indicador de oferta

`partidas_semana` de um bairro soma as partidas semanais de **todas as linhas que
têm ao menos um ponto nele**. Uma linha que apenas atravessa o bairro conta
integralmente. É uma medida de *oferta disponível*, não de viagens que começam ali.

Cobertura: apenas as linhas **municipais** da SOU. As intermunicipais (EMTU/BR
Mobilidade) e o VLT não estão nesta camada. Para a rede completa, o caminho é o
GTFS da EMTU.

---

## 7. Coleta seletiva

**Fonte:** Prefeitura de São Vicente, Carta de Serviços —
[Coleta Seletiva – Rotas](https://www.saovicente.sp.gov.br/carta-de-servicos/meio-ambiente-e-animais/residuos/coleta-seletiva-rotas)
(23 páginas por bairro, raspadas).

**Tratamento.** De cada página se extrai o bloco `<main>` e se identificam os blocos
de agenda: dia da semana, turno, horário-limite ("Coloque o seu lixo até 08h00") e
as listas "Ruas" e "Condomínios". Um bairro pode ter mais de um bloco — Gonzaguinha
tem segunda e quinta, com ruas diferentes em cada.

Dois problemas encontrados e corrigidos:
- O portal devolve intermitentemente uma página "Estamos em manutenção" (2 dos 23
  bairros na primeira execução). O script agora tenta novamente até 4 vezes.
- `"Quinta-feira - Tarde"` era quebrado como dia="Quinta", turno="feira".

**Mapeamento para os bairros do IBGE.** As 23 páginas não usam o mesmo recorte dos
30 bairros do Censo. A tabela `COLETA_PARA_IBGE` (topo de `scripts/build-layers.js`)
faz a tradução e **envolve decisões manuais**:

| Página | Bairro(s) IBGE | Motivo |
|---|---|---|
| Boa Vista e Itararé | Boa Vista + Itararé | página cobre dois bairros |
| Gonzaguinha | Gonzaguinha + Centro | as ruas listadas (Frei Gaspar, João Ramalho) são do Centro |
| Náutica III | Cidade Náutica | Náutica III não é bairro no IBGE |
| Vila Fátima | Vila N. Sra. de Fátima | nome abreviado |
| Tancredo, Vila Cascatinha | — | sem equivalente no IBGE |

> **`coleta = "Não"` significa "sem rota divulgada no portal para esse bairro", e
> não ausência comprovada de serviço.** São 7 bairros urbanos nessa situação,
> somando 67.741 habitantes. Vale conferir com a Secretaria antes de publicar como
> indicador.

---

## 8. Áreas verdes, parques e lazer

**Fonte:** OpenStreetMap via Overpass API (licença **ODbL 1.0** — a atribuição
precisa aparecer em qualquer publicação; o mapa já a exibe no rodapé).

**Tratamento**
1. Consulta na área da relação OSM 297995 (São Vicente/SP) por `leisure`,
   `landuse`, `natural` e `boundary=protected_area`.
2. Relações multipolígono têm os trechos remontados em anéis fechados (o Overpass
   devolve os membros fora de ordem e com sentidos variados).
3. Classificação em duas dimensões independentes: `e_verde` (vegetação) e
   `e_lazer` (uso recreativo). Uma praça é as duas coisas; um manguezal é só verde;
   uma quadra é só lazer. Daí as camadas se sobreporem — 181 verdes e 155 de lazer,
   258 feições distintas.
4. Recorte ao limite municipal; descarte de fragmentos < 50 m².

**Bug corrigido no cruzamento:** as feições do OSM se sobrepõem (manguezal dentro
de APA, quadra dentro de praça). Somar as interseções sem dissolver antes levou
Japuí a **147,6% de área verde**. Agora as geometrias são dissolvidas antes do
cruzamento e nenhum bairro passa de 100%.

---

## 9. Saneamento, educação, cor/raça, idade e entorno urbano

**Fonte:** IBGE, Censo 2022 — *Agregados por Bairro*
([FTP](https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Bairro_csv/)),
mais o módulo de *Características urbanísticas do entorno dos domicílios*.

O IBGE publica esses agregados **já consolidados por bairro**, com o mesmo
`CD_BAIRRO` da malha de setores — o join com a camada de bairros é direto, sem
precisar reagregar setor a setor. São 29 bairros (a área continental não tem
`CD_BAIRRO` e fica com os campos vazios).

**Arquivos usados** (~19 MB no total, baixados e filtrados pelo script):
`basico`, `caracteristicas_domicilio1`, `caracteristicas_domicilio2`,
`alfabetizacao`, `cor_ou_raca`, `demografia` e `entorno_domicílios`.

**Variáveis**, conforme o dicionário oficial:

| Indicador | Variáveis | Cálculo |
|---|---|---|
| Esgoto em rede | V00309 + V00310 | ÷ domicílios (V00001) |
| Esgotamento inadequado | V00312 a V00315 | fossa rudimentar, vala, corpo d'água, outra |
| Água encanada no domicílio | V00199 *(arquivo Parte 2, não Parte 1)* | ÷ domicílios |
| Lixo coletado | V00397 + V00398 | porta a porta + caçamba |
| Sem banheiro | V00316 | ÷ domicílios |
| Alfabetização (15+) | V00900 ÷ (V00900 + V00901) | sabe ler ÷ total 15+ |
| População preta ou parda | (V01318 + V01320) ÷ ΣV01317–V01321 | — |
| Crianças 0–9 / idosos 60+ | V01031 + V01032 / V01040 + V01041 | ÷ moradores (V01006) |
| Entorno: calçada, arborização, bueiro, iluminação, pavimentação, rampa | V05006–V05034 | ÷ total pesquisado de cada quesito (SIM + NÃO + NÃO DECLARADO) |

**Notas de leitura**

- O IBGE usa `X` para dado suprimido por sigilo estatístico; o script converte
  para nulo em vez de zero — tratar como zero inventaria "ausência de serviço"
  onde na verdade não há dado divulgado.
- O bloco de **entorno** é levantado apenas em setores sorteados. Cada quesito
  tem SIM / NÃO / NÃO DECLARADO, e o denominador usado é a soma dos três — ou
  seja, o total efetivamente pesquisado. Usar o total de domicílios do bairro
  subestimava os percentuais (em Itararé, base de 4.064 contra 4.358 domicílios).
- Duas variáveis de água ficaram nulas em todas as versões iniciais: primeiro
  porque V00199 foi procurada no arquivo Parte 1 (que só vai até V00089) e depois
  porque o cálculo continuou lendo do objeto da Parte 1. O script agora **falha
  com erro** se qualquer indicador sair nulo em todos os bairros, já que isso
  quase nunca é sigilo estatístico e quase sempre é variável no arquivo errado.
- Os arquivos de agregados **não têm coluna `CD_MUN`** (só o `basico` tem). O
  filtro do município usa o prefixo do `CD_BAIRRO` (`3551009…`). Uma primeira
  versão filtrava por `CD_MUN` e devolvia todos os valores nulos silenciosamente.
- Codificação dos CSVs: **latin1**, separador `;`.

**Contraste que esses dados revelam** (extremos do município):

| Indicador | Vila Nova Mariana | Boa Vista |
|---|---|---|
| Renda média | R$ 1.498 | R$ 5.234 |
| População preta ou parda | 68,1% | 25,9% |
| Alfabetização (15+) | 93,9% | 99,7% |
| Esgoto em rede | 82,1% | 99,9% |
| Domicílios sem calçada | 29,8% | 0% |
| Domicílios sem arborização | 42,0% | 3,3% |
| Crianças de 0 a 9 anos | 18,3% | 6,3% |

Samarita é o pior caso de saneamento e entorno: **61,2% de esgoto em rede, 84,8%
dos domicílios em ruas sem arborização e 49,4% sem calçada**.

---

## 10. Risco de inundação — não entregue

Não há camada de risco validada nesta entrega, e é melhor dizer isso do que
publicar uma que pareça oficial.

O que foi verificado:

- **`inundação_2.geojson` (entregue)** — polígono único de 10 vértices, 622 km²
  (o município tem 148), cobrindo 77% da cidade, sem atributos. Inutilizável.
- **IBGE / BATER 2018** (*População em Áreas de Risco no Brasil*) — base oficial,
  baixada e inspecionada. Cobre 89 municípios de São Paulo, **incluindo os vizinhos
  Santos, Cubatão, Praia Grande e Itanhaém, mas não São Vicente.** O script
  `fetch-fontes-oficiais.js` detecta isso e avisa, em vez de gravar arquivo vazio.

**Caminhos para obter o dado:** setores de risco da **CPRM/SGB** (Serviço Geológico
do Brasil) ou o **Plano Municipal de Redução de Riscos** da Prefeitura.

Como proxy parcial, note que 4 das 38 comunidades da camada de favelas são diques
(Dique do Caixeta, do Pompeba, do Piçarro e do Fátima), o que já indica ocupação em
área alagável.

---

## 11. Bases descartadas e por quê

Dez arquivos `exportacao_polygon_<timestamp>.geojson` e os quatro `*_2.geojson`
entregues são **um único polígono de 9–10 vértices, sem nenhum atributo**, com área
entre 2 e 4 vezes a do município inteiro. Medindo a cobertura de cada um sobre São
Vicente:

| Arquivo | Cobre do município | Destino |
|---|---|---|
| INSTITUIÇÕES DE ENSINO | 100,0% | descartado |
| PARQUES | 99,9% | substituído por OSM |
| INUNDAÇÕES | 94,7% | descartado |
| RISCO GEOHIDROLOGICO | 94,2% | descartado |
| INSTITUIÇÕES DE SAUDE | 93,0% | substituído por CNES |
| AREAS VERDE | 91,2% | substituído por OSM |
| renda_2.geojson | 79,9% | descartado (renda vem do Censo) |
| inundação_2.geojson | 77,3% | descartado (sem substituto) |
| saude_2.geojson | 73,1% | substituído por CNES |
| Favelas.geojson | 71,6% | substituído por IBGE FCU |

"Parques" cobrindo 99,9% da cidade e "Favelas" cobrindo 71,6% não são dados — são
contornos desenhados à mão. Derivar deles um indicador do tipo "% do bairro com
área verde" produziria números falsos com aparência de estatística oficial, então
foram substituídos por fontes verificáveis ou deixados de fora.

---

## 12. Fatores de desigualdade identificados

Correlação de Pearson entre a renda média do bairro e cada indicador (29 bairros
urbanos). Em `data/correlacoes_renda.json` e na aba *Fatores x renda* da planilha.

| Fator | r | Leitura |
|---|---|---|
| **% população preta ou parda** | **−0,93** | o correlato mais forte de todos |
| **% de crianças de 0 a 9 anos** | **−0,93** | periferia significativamente mais jovem |
| **Taxa de alfabetização (15+)** | **+0,87** | — |
| **% de idosos (60+)** | **+0,87** | bairros ricos mais envelhecidos |
| % com esgotamento inadequado | −0,64 | fossa rudimentar, vala, corpo d'água |
| Partidas de ônibus por mil hab | +0,63 | bairros mais ricos têm mais oferta por habitante |
| % com esgoto em rede | +0,57 | — |
| % do bairro em favela | −0,56 | favela se concentra onde a renda é menor |
| % domicílios sem calçada | −0,50 | — |
| % domicílios sem arborização | −0,49 | sombra urbana é desigual |
| Distância até unidade de saúde | −0,48 | quanto menor a renda, mais longe da saúde |
| % domicílios sem bueiro | −0,44 | drenagem — relevante para alagamento |
| Unidades de saúde por 10 mil hab | +0,37 | — |
| % domicílios sem iluminação pública | −0,30 | — |
| Densidade demográfica | +0,30 | — |
| m² de área verde por habitante | −0,20 | fraca (puxada pelos bairros de morro/mangue) |
| Paradas por km² | +0,13 | fraca |
| Equipamentos de lazer por 10 mil hab | −0,13 | fraca |

**O eixo dominante da desigualdade em São Vicente é racial.** A proporção de
população preta ou parda explica a renda do bairro melhor que qualquer indicador de
infraestrutura: r = −0,93, quase determinístico. Vai de 25,9% em Boa Vista (a maior
renda) a 68,1% em Vila Nova Mariana (a menor).

O segundo achado é **etário**: onde a renda é menor há mais crianças (18,3% contra
6,3%) e menos idosos. Isso tem consequência direta de política pública — creche,
escola e pediatria são mais necessárias exatamente onde há menos equipamentos.

O terceiro é o **transporte**, contraintuitivo: a oferta de ônibus por habitante é
*maior* onde a renda é maior, ainda que a dependência do transporte público seja
tipicamente maior na periferia.

> Correlação não é causalidade, e 29 bairros é uma amostra pequena. Isso prioriza
> investigação; não conclui causa. Vários desses fatores são colineares entre si
> (favela, saneamento e cor/raça andam juntos), então não se somam como causas
> independentes.

### Concentração de privações

- **Vila Nova Mariana** acumula praticamente todas: menor renda (R$ 1.498), 85,5%
  da área em favela, 68,1% de população preta ou parda, menor alfabetização
  (93,9%), 29,8% dos domicílios sem calçada, nenhuma unidade de saúde (990 m até a
  mais próxima), **nenhuma linha municipal de ônibus** e sem coleta seletiva.
- **Samarita**: pior saneamento e entorno do município — 61,2% de esgoto em rede,
  84,8% sem arborização, 49,4% sem calçada — e sem coleta divulgada.
- **Jardim Irmã Dolores**: 24.906 habitantes, 64,4% de esgoto em rede, 36,4% sem
  calçada, sem coleta divulgada.
- **Vila Margarida**: 25.342 habitantes, R$ 1.707, 56,7% em favela.

### Fatores ainda não cobertos

Fora do que já foi incorporado: tempo de deslocamento casa-trabalho, cobertura de
creche e escola (a base de ensino entregue era inutilizável), ilhas de calor e
risco de inundação validado (ver seção 10). Dentro do Censo, ainda dá para explorar
parentesco/arranjo familiar, óbitos e domicílios por tipo de ocupação.

---

## 13. Reprodutibilidade

```bash
npm install

# coleta (só quando quiser atualizar as fontes; resultados ficam em Bases/)
npm run coleta:prefeitura     # 23 páginas da Prefeitura      (~30 s)
npm run transporte:sou        # API SOU/Bus2you               (~1 min)
npm run fontes:oficiais       # IBGE favelas + BATER + CNES   (~3 min)
npm run censo:agregados       # Censo 2022 por bairro (~19 MB)
npm run verdes:osm            # Overpass API                  (~1 min)
npm run coletar:tudo          # todos os anteriores

# processamento
npm run build                 # camadas + shapefiles + manifesto + planilha

npm start                     # http://localhost:8080
```

Cada script grava em `Bases/` com a data da coleta e a URL de origem, de modo que a
proveniência acompanha o arquivo.

### Verificações automáticas embutidas

- Área do município reconstruído conferida contra o IBGE (148,49 vs ~148 km²).
- Shapefiles relidos após a escrita com leitor independente: diferença de área
  0,0000% contra o GeoJSON, acentuação preservada e anéis na orientação da
  especificação ESRI (externos horários, ilhas anti-horárias).
- Percentuais de área verde e favela limitados a 100% por dissolução prévia.

### Licenças

| Fonte | Licença / condição |
|---|---|
| IBGE (renda, densidade, favelas) | dados públicos, citar a fonte |
| CNES / Ministério da Saúde | dados abertos, citar a fonte |
| Prefeitura de São Vicente | informação pública da Carta de Serviços |
| SOU Transportes / Bus2you | informação pública ao passageiro |
| OpenStreetMap | **ODbL 1.0 — atribuição obrigatória** |

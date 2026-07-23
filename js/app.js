(function () {
  const map = L.map("map", { zoomControl: true, minZoom: 11, maxZoom: 18 }).setView(
    [-23.965, -46.4],
    12
  );

  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  // ---------------------------------------------------------------- utilidades
  const cache = {};
  async function loadGeoJSON(file) {
    if (!cache[file]) {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`Falha ao carregar ${file}`);
      cache[file] = await res.json();
    }
    return cache[file];
  }

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const hexToRgb = (hex) => {
    const v = hex.replace("#", "");
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const rgbToHex = (c) =>
    "#" +
    c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
  const lerp = (from, to, t) => {
    const a = hexToRgb(from), b = hexToRgb(to);
    return rgbToHex(a.map((c, i) => c + (b[i] - c) * t));
  };

  function corDoValor(valor, cfg) {
    if (cfg.tipo === "categorico") return cfg.cores[valor] || cfg.corPadrao;
    if (valor === null || valor === undefined || isNaN(valor)) return "#e5ded8";
    const { min, max, colorFrom, colorTo } = cfg.scale;
    const t = Math.max(0, Math.min(1, (valor - min) / (max - min)));
    return lerp(colorFrom, colorTo, t);
  }

  function popupHTML(titulo, linhas, fonte) {
    const corpo = linhas
      .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "—")
      .map(([k, v]) => `<div class="popup-row"><strong>${esc(k)}:</strong> ${esc(v)}</div>`)
      .join("");
    const rodape = fonte ? `<div class="popup-note">Fonte: ${esc(fonte)}</div>` : "";
    return `<div class="popup-title">${esc(titulo)}</div>${corpo}${rodape}`;
  }

  const soUrbanos = (features) => features.filter((f) => f.properties.zona !== "continental");

  function fitUrbano(layer) {
    const b = L.latLngBounds([]);
    layer.eachLayer((l) => {
      if (l.feature?.properties?.zona !== "continental") b.extend(l.getBounds());
    });
    map.fitBounds(b.isValid() ? b : layer.getBounds(), { padding: [16, 16] });
  }

  // ------------------------------------------------------------- estatística
  const stats = {
    media: (v) => v.reduce((a, b) => a + b, 0) / v.length,
    gini(vals) {
      const v = vals.filter((x) => typeof x === "number").slice().sort((a, b) => a - b);
      const n = v.length;
      if (n < 2) return 0;
      const soma = v.reduce((a, b) => a + b, 0);
      if (soma === 0) return 0;
      let acc = 0;
      v.forEach((x, i) => (acc += (i + 1) * x));
      return (2 * acc) / (n * soma) - (n + 1) / n;
    },
    // Coeficiente de variação (desvio-padrão / média), em %.
    cv(vals) {
      const v = vals.filter((x) => typeof x === "number");
      const m = stats.media(v);
      if (!m) return 0;
      const varr = v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
      return (Math.sqrt(varr) / Math.abs(m)) * 100;
    },
    minMax(vals) {
      const v = vals.filter((x) => typeof x === "number");
      return [Math.min(...v), Math.max(...v)];
    },
  };

  const metricaPorCampo = (campo) => METRICAS.find((m) => m.campo === campo);

  // "Maldade" normalizada em [0,1] (1 = pior), respeitando o polo da métrica.
  function badness(valor, metrica, min, max) {
    if (valor === null || valor === undefined || isNaN(valor) || max === min) return null;
    const t = (valor - min) / (max - min);
    return metrica.polo === "maior" ? t : 1 - t;
  }
  const RAMPA = { bom: "#eef4ef", ruim: "#7a1420" };
  const corBadness = (b) => (b === null ? "#e5ded8" : lerp(RAMPA.bom, RAMPA.ruim, b));

  // ------------------------------------------------------- registros de camada
  let camadaIndicador = null;
  const camadasAtivas = {};
  let ajustouZoom = false;
  const gruposModo = { desigualdade: L.layerGroup(), comparar: L.layerGroup() };

  function limparIndicadores() {
    if (camadaIndicador) { map.removeLayer(camadaIndicador); camadaIndicador = null; }
    Object.keys(camadasAtivas).forEach((k) => { map.removeLayer(camadasAtivas[k]); delete camadasAtivas[k]; });
    document.querySelectorAll("input[data-layer]").forEach((i) => (i.checked = false));
    document.querySelectorAll('input[name="indicador"]').forEach((i) => (i.checked = i.value === "none"));
  }

  const legenda = document.getElementById("legend");
  const legendaConteudo = document.getElementById("legend-content");
  function mostrarLegenda(captionHTML, passos, fonte) {
    legendaConteudo.innerHTML =
      `<div class="legend-caption">${captionHTML}</div>` +
      passos.map((p) => `<div class="legend-row"><span class="legend-swatch" style="background:${p.cor}"></span><span>${esc(p.label)}</span></div>`).join("") +
      (fonte ? `<div class="legend-fonte">Fonte: ${esc(fonte)}</div>` : "");
    legenda.hidden = false;
  }

  // =========================================================================
  // MODO 1 — INDICADORES (choropleth + camadas)
  // =========================================================================
  const painelIndicadores = document.getElementById("indicadores");
  const painelCamadas = document.getElementById("camadas");

  painelIndicadores.insertAdjacentHTML(
    "beforeend",
    `<label class="control control--radio"><input type="radio" name="indicador" value="none" /><span>Nenhum</span></label>`
  );
  for (const [chave, cfg] of Object.entries(LAYERS_CONFIG.indicadores)) {
    const amostra =
      cfg.tipo === "categorico"
        ? `linear-gradient(90deg, ${Object.values(cfg.cores).join(" 50%, ")} 50%)`
        : `linear-gradient(90deg, ${cfg.scale.colorFrom}, ${cfg.scale.colorTo})`;
    painelIndicadores.insertAdjacentHTML(
      "beforeend",
      `<label class="control control--radio">
         <input type="radio" name="indicador" value="${chave}" />
         <span class="swatch" style="background:${amostra}"></span>
         <span class="control__texto">${esc(cfg.label)}<small class="control__fonte">${esc(cfg.fonte)}</small></span>
       </label>`
    );
  }
  for (const [chave, cfg] of Object.entries(LAYERS_CONFIG.camadas)) {
    const forma = cfg.geometria === "ponto" ? "border-radius:50%" : "";
    painelCamadas.insertAdjacentHTML(
      "beforeend",
      `<label class="control control--check">
         <input type="checkbox" data-layer="${chave}" />
         <span class="swatch" style="background:${cfg.color};${forma}"></span>
         <span class="control__texto">${esc(cfg.label)}<small class="control__fonte">${esc(cfg.fonte)}</small></span>
       </label>`
    );
  }

  async function setIndicador(chave) {
    if (camadaIndicador) { map.removeLayer(camadaIndicador); camadaIndicador = null; }
    if (chave === "none") { legenda.hidden = true; return; }
    const cfg = LAYERS_CONFIG.indicadores[chave];
    const dados = await loadGeoJSON(cfg.file);
    camadaIndicador = L.geoJSON(dados, {
      style: (f) => ({ fillColor: corDoValor(f.properties[cfg.valueField], cfg), fillOpacity: 0.75, color: "#fff", weight: 1 }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindPopup(popupHTML(p[cfg.nameField] || "Bairro", cfg.popupRows(p), cfg.fonte));
        layer.on("mouseover", () => layer.setStyle({ weight: 2.5, color: "#1a1e2c" }));
        layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#fff" }));
      },
    }).addTo(map);
    camadaIndicador.bringToBack();
    if (!ajustouZoom) { fitUrbano(camadaIndicador); ajustouZoom = true; }
    mostrarLegenda(
      esc(cfg.legendTitle),
      cfg.legendSteps.map((s) => ({ cor: corDoValor(s.value, cfg), label: s.label })),
      cfg.fonte
    );
  }

  async function toggleCamada(chave, ligar) {
    const cfg = LAYERS_CONFIG.camadas[chave];
    if (!ligar) { if (camadasAtivas[chave]) { map.removeLayer(camadasAtivas[chave]); delete camadasAtivas[chave]; } return; }
    const dados = await loadGeoJSON(cfg.file);
    const opcoes = { onEachFeature: (f, layer) => layer.bindPopup(popupHTML(cfg.titulo(f.properties), cfg.popup(f.properties), cfg.fonte)) };
    if (cfg.geometria === "ponto") opcoes.pointToLayer = (f, ll) => L.circleMarker(ll, { radius: 5, fillColor: cfg.color, color: "#fff", weight: 1.5, fillOpacity: 0.9 });
    else if (cfg.geometria === "linha") opcoes.style = { color: cfg.color, weight: 3, opacity: 0.85 };
    else opcoes.style = { fillColor: cfg.color, color: cfg.color, weight: 1, fillOpacity: 0.45 };
    camadasAtivas[chave] = L.geoJSON(dados, opcoes).addTo(map);
  }

  document.querySelectorAll('input[name="indicador"]').forEach((i) => i.addEventListener("change", (e) => setIndicador(e.target.value)));
  document.querySelectorAll("input[data-layer]").forEach((i) => i.addEventListener("change", (e) => toggleCamada(e.target.dataset.layer, e.target.checked)));

  // =========================================================================
  // MODO 2 — DESIGUALDADE (entre bairros / dentro do bairro)
  // =========================================================================
  const selMetrica = document.getElementById("metrica-desig");
  METRICAS.forEach((m) => selMetrica.insertAdjacentHTML("beforeend", `<option value="${m.campo}">${esc(m.label)}</option>`));
  let subDesig = "entre";
  let bairroFoco = null;

  const grupoDesig = gruposModo.desigualdade;

  async function renderDesigualdade() {
    grupoDesig.clearLayers();
    const campo = selMetrica.value;
    const metrica = metricaPorCampo(campo);
    if (subDesig === "entre") await renderEntre(metrica);
    else await renderDentro(metrica);
  }

  async function renderEntre(metrica) {
    document.getElementById("desig-dica").textContent =
      "O mapa compara os bairros entre si nesta métrica. Cores mais escuras = pior situação.";
    const fc = await loadGeoJSON("data/bairros_indicadores.geojson");
    const feats = soUrbanos(fc.features);
    const valores = feats.map((f) => f.properties[metrica.campo]).filter((v) => typeof v === "number");
    const [min, max] = stats.minMax(valores);

    L.geoJSON({ type: "FeatureCollection", features: feats }, {
      style: (f) => ({ fillColor: corBadness(badness(f.properties[metrica.campo], metrica, min, max)), fillOpacity: 0.8, color: "#fff", weight: 1 }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindPopup(popupHTML(p.bairro, [[metrica.label, fmtMetrica(p[metrica.campo], metrica.unidade)]], metrica.fonte));
        layer.on("mouseover", () => layer.setStyle({ weight: 2.5, color: "#1a1e2c" }));
        layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#fff" }));
        layer.on("click", () => destacarRanking(p.bairro));
      },
    }).addTo(grupoDesig);

    mostrarLegenda(
      `${esc(metrica.label)} — comparação entre bairros`,
      [
        { cor: corBadness(0), label: "Melhor situação" },
        { cor: corBadness(0.5), label: "Intermediária" },
        { cor: corBadness(1), label: "Pior situação" },
      ],
      metrica.fonte
    );

    // Painel: dispersão do município + ranking.
    const ordenados = feats
      .map((f) => ({ nome: f.properties.bairro, v: f.properties[metrica.campo] }))
      .filter((x) => typeof x.v === "number")
      .sort((a, b) => (metrica.polo === "maior" ? b.v - a.v : a.v - b.v));
    const razao = metrica.polo === "maior" ? max / (min || 1) : max / (min || 1);

    const barra = (x) => {
      const bd = badness(x.v, metrica, min, max);
      const w = Math.round((bd ?? 0) * 100);
      return `<div class="rank-row" data-bairro="${esc(x.nome)}">
        <span class="rank-nome">${esc(x.nome)}</span>
        <span class="rank-bar"><span style="width:${w}%;background:${corBadness(bd)}"></span></span>
        <span class="rank-val">${esc(fmtMetrica(x.v, metrica.unidade))}</span>
      </div>`;
    };

    document.getElementById("desig-resultado").innerHTML = `
      <h2>Dispersão entre bairros</h2>
      <div class="kpis">
        <div class="kpi"><b>${razao.toFixed(1)}×</b><span>entre o pior e o melhor bairro</span></div>
        <div class="kpi"><b>${stats.gini(valores).toFixed(2)}</b><span>Gini entre bairros</span></div>
        <div class="kpi"><b>${Math.round(stats.cv(valores))}%</b><span>coef. de variação</span></div>
      </div>
      <div class="rank">${ordenados.map(barra).join("")}</div>`;
    document.querySelectorAll("#desig-resultado .rank-row").forEach((row) =>
      row.addEventListener("click", () => {
        const alvo = feats.find((f) => f.properties.bairro === row.dataset.bairro);
        if (alvo) map.fitBounds(L.geoJSON(alvo).getBounds(), { padding: [40, 40] });
        destacarRanking(row.dataset.bairro);
      })
    );
  }

  function destacarRanking(nome) {
    document.querySelectorAll("#desig-resultado .rank-row").forEach((r) =>
      r.classList.toggle("is-sel", r.dataset.bairro === nome)
    );
  }

  async function renderDentro(metrica) {
    const micro = await loadGeoJSON("data/microareas.geojson");
    const bairros = await loadGeoJSON("data/bairros_indicadores.geojson");

    // Dispersão interna de cada bairro nesta métrica (a partir das sub-áreas).
    const porBairro = {};
    micro.features.forEach((f) => {
      const b = f.properties.bairro;
      (porBairro[b] = porBairro[b] || []).push(f.properties[metrica.campo]);
    });
    const dispersao = {};
    Object.entries(porBairro).forEach(([b, vals]) => (dispersao[b] = stats.cv(vals)));
    const cvs = Object.values(dispersao);
    const [cvMin, cvMax] = stats.minMax(cvs);

    if (!bairroFoco) {
      document.getElementById("desig-dica").textContent =
        "O mapa mostra quão desigual é cada bairro por dentro. Clique em um bairro para ver suas sub-áreas.";
      L.geoJSON({ type: "FeatureCollection", features: soUrbanos(bairros.features) }, {
        style: (f) => {
          const cv = dispersao[f.properties.bairro];
          const t = cvMax === cvMin ? 0 : (cv - cvMin) / (cvMax - cvMin);
          return { fillColor: cv === undefined ? "#e5ded8" : lerp(RAMPA.bom, "#1a4f7a", t), fillOpacity: 0.8, color: "#fff", weight: 1 };
        },
        onEachFeature: (f, layer) => {
          const b = f.properties.bairro;
          layer.bindTooltip(`${b}: variação interna ${Math.round(dispersao[b] || 0)}%`, { sticky: true });
          layer.on("mouseover", () => layer.setStyle({ weight: 2.5, color: "#1a1e2c" }));
          layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#fff" }));
          layer.on("click", () => { bairroFoco = b; renderDesigualdade(); });
        },
      }).addTo(grupoDesig);

      mostrarLegenda(
        `Variação interna — ${esc(metrica.label)}`,
        [
          { cor: lerp(RAMPA.bom, "#1a4f7a", 0), label: "Bairro homogêneo" },
          { cor: lerp(RAMPA.bom, "#1a4f7a", 1), label: "Bairro desigual por dentro" },
        ],
        metrica.fonte + " · sub-áreas sintéticas"
      );

      const ordenados = Object.entries(dispersao).sort((a, b) => b[1] - a[1]);
      document.getElementById("desig-resultado").innerHTML = `
        <h2>Desigualdade interna dos bairros</h2>
        <p class="painel__dica">Coeficiente de variação das sub-áreas dentro de cada bairro.</p>
        <div class="rank">${ordenados.map(([b, cv]) => {
          const t = cvMax === cvMin ? 0 : (cv - cvMin) / (cvMax - cvMin);
          return `<div class="rank-row" data-bairro="${esc(b)}"><span class="rank-nome">${esc(b)}</span><span class="rank-bar"><span style="width:${Math.round(t * 100)}%;background:${lerp(RAMPA.bom, "#1a4f7a", t)}"></span></span><span class="rank-val">${Math.round(cv)}%</span></div>`;
        }).join("")}</div>`;
      document.querySelectorAll("#desig-resultado .rank-row").forEach((row) =>
        row.addEventListener("click", () => { bairroFoco = row.dataset.bairro; renderDesigualdade(); })
      );
      return;
    }

    // --- Foco em um bairro: mostra as sub-áreas ---
    const cels = micro.features.filter((f) => f.properties.bairro === bairroFoco);
    const vals = cels.map((f) => f.properties[metrica.campo]).filter((v) => typeof v === "number");
    const [min, max] = stats.minMax(vals);
    document.getElementById("desig-dica").innerHTML =
      `Sub-áreas de <b>${esc(bairroFoco)}</b>. <a href="#" id="voltar-bairros">← voltar a todos os bairros</a>`;

    const camada = L.geoJSON({ type: "FeatureCollection", features: cels }, {
      style: (f) => ({ fillColor: corBadness(badness(f.properties[metrica.campo], metrica, min, max)), fillOpacity: 0.85, color: "#fff", weight: 1 }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindPopup(popupHTML(`${bairroFoco} — sub-área`, [[metrica.label, fmtMetrica(p[metrica.campo], metrica.unidade)]], "Sintético (protótipo)"));
      },
    }).addTo(grupoDesig);
    map.fitBounds(camada.getBounds(), { padding: [30, 30] });

    mostrarLegenda(
      `${esc(metrica.label)} dentro de ${esc(bairroFoco)}`,
      [
        { cor: corBadness(0), label: "Melhor sub-área" },
        { cor: corBadness(1), label: "Pior sub-área" },
      ],
      metrica.fonte + " · sub-áreas sintéticas"
    );

    const razao = min ? max / min : 0;
    document.getElementById("desig-resultado").innerHTML = `
      <h2>Dentro de ${esc(bairroFoco)}</h2>
      <div class="kpis">
        <div class="kpi"><b>${cels.length}</b><span>sub-áreas</span></div>
        <div class="kpi"><b>${razao ? razao.toFixed(1) + "×" : "—"}</b><span>pior ÷ melhor sub-área</span></div>
        <div class="kpi"><b>${Math.round(stats.cv(vals))}%</b><span>variação interna</span></div>
      </div>
      <p class="painel__dica">Melhor: ${fmtMetrica(metrica.polo === "maior" ? min : max, metrica.unidade)} ·
      Pior: ${fmtMetrica(metrica.polo === "maior" ? max : min, metrica.unidade)}</p>`;
    const voltar = document.getElementById("voltar-bairros");
    if (voltar) voltar.addEventListener("click", (e) => { e.preventDefault(); bairroFoco = null; renderDesigualdade(); });
  }

  document.querySelectorAll("#sub-desig button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#sub-desig button").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      subDesig = b.dataset.sub;
      bairroFoco = null;
      renderDesigualdade();
    })
  );
  selMetrica.addEventListener("change", () => renderDesigualdade());

  // =========================================================================
  // MODO 3 — COMPARAR ÁREAS
  // =========================================================================
  const grupoComp = gruposModo.comparar;
  let granul = "bairros";
  let selecao = [null, null]; // [featPropsA, featPropsB]
  let camadaComp = null;

  async function montarCamadaComparacao() {
    grupoComp.clearLayers();
    const arq = granul === "bairros" ? "data/bairros_indicadores.geojson" : "data/microareas.geojson";
    const fc = await loadGeoJSON(arq);
    const feats = granul === "bairros" ? soUrbanos(fc.features) : fc.features;
    const rotulo = (p) => (granul === "bairros" ? p.bairro : `${p.bairro} — sub-área`);

    camadaComp = L.geoJSON({ type: "FeatureCollection", features: feats }, {
      style: () => ({ fillColor: "#cbb8a8", fillOpacity: 0.25, color: "#9c7", weight: 1 }),
      onEachFeature: (f, layer) => {
        layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.5 }));
        layer.on("mouseout", () => estilizarSelecao());
        layer.on("click", () => escolher(f.properties, rotulo(f.properties)));
      },
    }).addTo(grupoComp);
    if (granul === "bairros") fitUrbano(camadaComp);
    estilizarSelecao();

    mostrarLegenda(
      "Comparar duas áreas",
      [
        { cor: "#e8792233", label: "Clique para escolher A e B" },
        { cor: "#007a4a", label: "Área A" },
        { cor: "#e87722", label: "Área B" },
      ],
      "Selecione dois polígonos no mapa"
    );
  }

  function chaveDe(p) {
    return granul === "bairros" ? p.bairro : p.micro_id;
  }
  function estilizarSelecao() {
    if (!camadaComp) return;
    camadaComp.eachLayer((l) => {
      const p = l.feature.properties;
      const k = chaveDe(p);
      if (selecao[0] && chaveDe(selecao[0]) === k) l.setStyle({ color: "#007a4a", weight: 3, fillColor: "#007a4a", fillOpacity: 0.4 });
      else if (selecao[1] && chaveDe(selecao[1]) === k) l.setStyle({ color: "#e87722", weight: 3, fillColor: "#e87722", fillOpacity: 0.4 });
      else l.setStyle({ color: "#9c7", weight: 1, fillColor: "#cbb8a8", fillOpacity: 0.25 });
    });
  }

  function escolher(props, rotulo) {
    if (selecao[0] && chaveDe(selecao[0]) === chaveDe(props)) selecao[0] = null;
    else if (selecao[1] && chaveDe(selecao[1]) === chaveDe(props)) selecao[1] = null;
    else if (!selecao[0]) selecao[0] = props;
    else if (!selecao[1]) selecao[1] = props;
    else selecao = [selecao[1], props]; // desliza: mantém a última e substitui a primeira
    document.getElementById("slot-a").textContent = "A — " + (selecao[0] ? rotuloDe(selecao[0]) : "clique no mapa");
    document.getElementById("slot-b").textContent = "B — " + (selecao[1] ? rotuloDe(selecao[1]) : "clique no mapa");
    estilizarSelecao();
    renderComparacao();
  }
  const rotuloDe = (p) => (granul === "bairros" ? p.bairro : `${p.bairro} #${String(p.micro_id).split("-").pop()}`);

  function renderComparacao() {
    const box = document.getElementById("comp-resultado");
    const [a, b] = selecao;
    if (!a || !b) { box.innerHTML = `<p class="painel__dica">Escolha as duas áreas para ver a comparação.</p>`; return; }

    const linhas = METRICAS.map((m) => {
      const va = a[m.campo], vb = b[m.campo];
      if (typeof va !== "number" || typeof vb !== "number") return "";
      const piorA = m.polo === "maior" ? va > vb : va < vb;
      const iguais = va === vb;
      let gap;
      if (m.unidade === "R$" || m.unidade === "idx") {
        const hi = Math.max(va, vb), lo = Math.min(va, vb);
        gap = lo ? (hi / lo).toFixed(1) + "×" : "—";
      } else {
        gap = Math.abs(va - vb).toFixed(1) + " p.p.";
      }
      return `<tr>
        <td class="cmp-metrica">${esc(m.label)}</td>
        <td class="cmp-a ${!iguais && piorA ? "cmp-pior" : ""}">${esc(fmtMetrica(va, m.unidade))}</td>
        <td class="cmp-b ${!iguais && !piorA ? "cmp-pior" : ""}">${esc(fmtMetrica(vb, m.unidade))}</td>
        <td class="cmp-gap">${esc(gap)}</td>
      </tr>`;
    }).join("");

    const ivsA = a.sint_ivs, ivsB = b.sint_ivs;
    let sintese = "";
    if (typeof ivsA === "number" && typeof ivsB === "number") {
      const piorNome = ivsA > ivsB ? rotuloDe(a) : rotuloDe(b);
      const x = Math.max(ivsA, ivsB) / (Math.min(ivsA, ivsB) || 0.001);
      sintese = `<p class="cmp-sintese"><b>${esc(piorNome)}</b> é a área mais vulnerável — IVS ${x.toFixed(1)}× o da outra.</p>`;
    }

    box.innerHTML = `
      <h2>A × B</h2>
      ${sintese}
      <table class="cmp-tabela">
        <thead><tr><th>Métrica</th><th class="cmp-a">A</th><th class="cmp-b">B</th><th>Diferença</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <p class="painel__dica">Célula destacada = pior valor. Vários fatores são sintéticos (protótipo).</p>`;
  }

  document.querySelectorAll("#sub-comp button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#sub-comp button").forEach((x) => x.classList.remove("is-active"));
      btn.classList.add("is-active");
      granul = btn.dataset.granul;
      selecao = [null, null];
      document.getElementById("slot-a").textContent = "A — clique no mapa";
      document.getElementById("slot-b").textContent = "B — clique no mapa";
      montarCamadaComparacao();
      renderComparacao();
    })
  );
  document.getElementById("comp-limpar").addEventListener("click", () => {
    selecao = [null, null];
    document.getElementById("slot-a").textContent = "A — clique no mapa";
    document.getElementById("slot-b").textContent = "B — clique no mapa";
    estilizarSelecao();
    renderComparacao();
  });

  // =========================================================================
  // GERENCIADOR DE MODOS
  // =========================================================================
  async function setModo(modo) {
    // limpa tudo do mapa
    limparIndicadores();
    grupoDesig.clearLayers(); grupoComp.clearLayers();
    map.removeLayer(grupoDesig); map.removeLayer(grupoComp);
    legenda.hidden = true;

    document.querySelectorAll(".modo").forEach((b) => b.classList.toggle("is-active", b.dataset.modo === modo));
    document.querySelectorAll(".painel-modo").forEach((p) => (p.hidden = p.dataset.painel !== modo));

    if (modo === "indicadores") {
      document.querySelector('input[name="indicador"][value="renda"]').checked = true;
      setIndicador("renda");
    } else if (modo === "desigualdade") {
      grupoDesig.addTo(map);
      bairroFoco = null;
      renderDesigualdade();
    } else if (modo === "comparar") {
      grupoComp.addTo(map);
      selecao = [null, null];
      document.getElementById("slot-a").textContent = "A — clique no mapa";
      document.getElementById("slot-b").textContent = "B — clique no mapa";
      await montarCamadaComparacao();
      renderComparacao();
    }
  }
  document.querySelectorAll(".modo").forEach((b) => b.addEventListener("click", () => setModo(b.dataset.modo)));

  document.getElementById("toggle-panel").addEventListener("click", () => document.getElementById("panel").classList.toggle("is-open"));

  // ---------------------------------------------------------------- modal
  function abrirModal(id) {
    const m = document.getElementById(`modal-${id}`);
    if (m) m.hidden = false;
  }
  function fecharModais() {
    document.querySelectorAll(".modal").forEach((m) => (m.hidden = true));
  }
  document.querySelectorAll("[data-modal]").forEach((b) =>
    b.addEventListener("click", () => abrirModal(b.dataset.modal))
  );
  document.querySelectorAll("[data-fecha-modal]").forEach((b) =>
    b.addEventListener("click", fecharModais)
  );
  document.addEventListener("keydown", (e) => e.key === "Escape" && fecharModais());

  // início
  document.querySelector('input[name="indicador"][value="renda"]').checked = true;
  setIndicador("renda");
})();

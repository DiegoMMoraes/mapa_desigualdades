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

  const cache = {};
  async function loadGeoJSON(file) {
    if (!cache[file]) {
      const res = await fetch(file);
      if (!res.ok) throw new Error(`Falha ao carregar ${file}`);
      cache[file] = await res.json();
    }
    return cache[file];
  }

  // ---------- cores ----------
  const hexToRgb = (hex) => {
    const v = hex.replace("#", "");
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  };
  const rgbToHex = (c) =>
    "#" +
    c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

  function corDoValor(valor, cfg) {
    if (cfg.tipo === "categorico") return cfg.cores[valor] || cfg.corPadrao;
    if (valor === null || valor === undefined || isNaN(valor)) return "#e5ded8";
    const { min, max, colorFrom, colorTo } = cfg.scale;
    // min > max é intencional em indicadores onde "menor é melhor" (distância).
    const t = Math.max(0, Math.min(1, (valor - min) / (max - min)));
    const a = hexToRgb(colorFrom);
    const b = hexToRgb(colorTo);
    return rgbToHex(a.map((c, i) => c + (b[i] - c) * t));
  }

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function popupHTML(titulo, linhas, fonte) {
    const corpo = linhas
      .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "—")
      .map(([k, v]) => `<div class="popup-row"><strong>${esc(k)}:</strong> ${esc(v)}</div>`)
      .join("");
    const rodape = fonte ? `<div class="popup-note">Fonte: ${esc(fonte)}</div>` : "";
    return `<div class="popup-title">${esc(titulo)}</div>${corpo}${rodape}`;
  }

  // ---------- monta o painel a partir da config ----------
  const painelIndicadores = document.getElementById("indicadores");
  const painelCamadas = document.getElementById("camadas");

  painelIndicadores.insertAdjacentHTML(
    "beforeend",
    `<label class="control control--radio">
       <input type="radio" name="indicador" value="none" />
       <span>Nenhum</span>
     </label>`
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
         <span class="control__texto">${esc(cfg.label)}
           <small class="control__fonte">${esc(cfg.fonte)}</small>
         </span>
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
         <span class="control__texto">${esc(cfg.label)}
           <small class="control__fonte">${esc(cfg.fonte)}</small>
         </span>
       </label>`
    );
  }

  // ---------- indicador (choropleth, seleção única) ----------
  let camadaIndicador = null;
  let ajustouZoom = false;

  async function setIndicador(chave) {
    if (camadaIndicador) {
      map.removeLayer(camadaIndicador);
      camadaIndicador = null;
    }
    const legenda = document.getElementById("legend");
    const conteudo = document.getElementById("legend-content");

    if (chave === "none") {
      legenda.hidden = true;
      return;
    }

    const cfg = LAYERS_CONFIG.indicadores[chave];
    const dados = await loadGeoJSON(cfg.file);

    camadaIndicador = L.geoJSON(dados, {
      style: (f) => ({
        fillColor: corDoValor(f.properties[cfg.valueField], cfg),
        fillOpacity: 0.75,
        color: "#ffffff",
        weight: 1,
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindPopup(popupHTML(p[cfg.nameField] || "Bairro", cfg.popupRows(p), cfg.fonte));
        layer.on("mouseover", () => layer.setStyle({ weight: 2.5, color: "#1a1e2c" }));
        layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "#ffffff" }));
      },
    }).addTo(map);

    camadaIndicador.bringToBack();
    if (!ajustouZoom) {
      // Enquadra só a mancha urbana: a área continental (Serra do Mar) é enorme
      // e quase desabitada, e sozinha faria a cidade sumir no canto do mapa.
      const urbanos = L.latLngBounds([]);
      camadaIndicador.eachLayer((l) => {
        if (l.feature?.properties?.zona !== "continental") urbanos.extend(l.getBounds());
      });
      map.fitBounds(urbanos.isValid() ? urbanos : camadaIndicador.getBounds(), {
        padding: [16, 16],
      });
      ajustouZoom = true;
    }

    conteudo.innerHTML =
      `<div class="legend-caption">${esc(cfg.legendTitle)}</div>` +
      cfg.legendSteps
        .map(
          (s) =>
            `<div class="legend-row"><span class="legend-swatch" style="background:${corDoValor(
              s.value,
              cfg
            )}"></span><span>${esc(s.label)}</span></div>`
        )
        .join("") +
      `<div class="legend-fonte">Fonte: ${esc(cfg.fonte)}</div>`;
    legenda.hidden = false;
  }

  // ---------- camadas (overlay, múltipla escolha) ----------
  const camadasAtivas = {};

  async function toggleCamada(chave, ligar) {
    const cfg = LAYERS_CONFIG.camadas[chave];
    if (!ligar) {
      if (camadasAtivas[chave]) {
        map.removeLayer(camadasAtivas[chave]);
        delete camadasAtivas[chave];
      }
      return;
    }

    const dados = await loadGeoJSON(cfg.file);
    const opcoes = {
      onEachFeature: (f, layer) =>
        layer.bindPopup(popupHTML(cfg.titulo(f.properties), cfg.popup(f.properties), cfg.fonte)),
    };

    if (cfg.geometria === "ponto") {
      opcoes.pointToLayer = (f, latlng) =>
        L.circleMarker(latlng, {
          radius: 5,
          fillColor: cfg.color,
          color: "#ffffff",
          weight: 1.5,
          fillOpacity: 0.9,
        });
    } else if (cfg.geometria === "linha") {
      opcoes.style = { color: cfg.color, weight: 3, opacity: 0.85 };
    } else {
      opcoes.style = { fillColor: cfg.color, color: cfg.color, weight: 1, fillOpacity: 0.45 };
    }

    camadasAtivas[chave] = L.geoJSON(dados, opcoes).addTo(map);
  }

  document
    .querySelectorAll('input[name="indicador"]')
    .forEach((i) => i.addEventListener("change", (e) => setIndicador(e.target.value)));
  document
    .querySelectorAll("input[data-layer]")
    .forEach((i) =>
      i.addEventListener("change", (e) => toggleCamada(e.target.dataset.layer, e.target.checked))
    );

  document.getElementById("toggle-panel").addEventListener("click", () => {
    document.getElementById("panel").classList.toggle("is-open");
  });

  // Abre já mostrando a renda, para o mapa não aparecer vazio.
  document.querySelector('input[name="indicador"][value="renda"]').checked = true;
  setIndicador("renda");
})();

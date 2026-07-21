/**
 * Escritor de Shapefile (SHP + SHX + DBF + PRJ + CPG) sem dependências externas.
 *
 * Escrito à mão porque as libs disponíveis no npm ou fixam o CRS em WGS84, ou não
 * lidam com MultiPolygon/PolyLine, ou quebram a acentuação no DBF — e as bases do
 * projeto são SIRGAS 2000 (EPSG:4674) e cheias de nomes acentuados.
 *
 * Referência: ESRI Shapefile Technical Description (julho/1998).
 */
const fs = require("fs");
const path = require("path");

const SHAPE_TYPE = { NULL: 0, POINT: 1, POLYLINE: 3, POLYGON: 5 };

// SIRGAS 2000 geográfico — mesmo CRS dos shapefiles originais do IBGE.
const PRJ_SIRGAS2000 =
  'GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",' +
  'SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],' +
  'UNIT["degree",0.0174532925199433]]';

/** Área com sinal (shoelace). Positiva = sentido anti-horário. */
function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return s / 2;
}

function closeRing(ring) {
  const r = ring.slice();
  const a = r[0];
  const b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
}

/**
 * O shapefile exige anel externo em sentido HORÁRIO e ilhas em ANTI-HORÁRIO —
 * exatamente o inverso da convenção do GeoJSON (RFC 7946).
 */
function orientRing(ring, wantClockwise) {
  const r = closeRing(ring);
  const isClockwise = signedArea(r) < 0;
  return isClockwise === wantClockwise ? r : r.slice().reverse();
}

/** Normaliza qualquer geometria para uma lista de "partes" (anéis ou linhas). */
function geometryToParts(geometry, shapeType) {
  const g = geometry;
  if (!g) return [];

  if (shapeType === SHAPE_TYPE.POLYGON) {
    const polys =
      g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    const parts = [];
    for (const poly of polys) {
      poly.forEach((ring, i) => {
        if (ring.length < 4) return; // anel degenerado
        parts.push(orientRing(ring, i === 0)); // externo horário, ilhas anti-horário
      });
    }
    return parts;
  }

  if (shapeType === SHAPE_TYPE.POLYLINE) {
    const lines =
      g.type === "LineString"
        ? [g.coordinates]
        : g.type === "MultiLineString"
        ? g.coordinates
        : [];
    return lines.filter((l) => l.length >= 2);
  }

  return [];
}

function bboxOfParts(parts) {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  for (const part of parts) {
    for (const [x, y] of part) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return [xmin, ymin, xmax, ymax];
}

function writeShpHeader(buf, fileLengthWords, shapeType, bbox) {
  buf.writeInt32BE(9994, 0); // file code
  buf.writeInt32BE(fileLengthWords, 24);
  buf.writeInt32LE(1000, 28); // version
  buf.writeInt32LE(shapeType, 32);
  buf.writeDoubleLE(bbox[0], 36);
  buf.writeDoubleLE(bbox[1], 44);
  buf.writeDoubleLE(bbox[2], 52);
  buf.writeDoubleLE(bbox[3], 60);
  // Z e M ficam zerados (shapefile 2D)
}

/** Infere o tipo DBF de cada campo a partir dos valores presentes. */
function inferFields(records, fieldSpecs) {
  const names = fieldSpecs || Object.keys(records[0] || {});
  const usados = new Set();

  return names.map((name) => {
    // Nome de campo no DBF tem no máximo 10 bytes ASCII.
    let dbfName = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_]/g, "_")
      .slice(0, 10);
    let i = 1;
    while (usados.has(dbfName)) {
      dbfName = dbfName.slice(0, 9) + i++;
    }
    usados.add(dbfName);

    const valores = records.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
    const todosNumeros = valores.length > 0 && valores.every((v) => typeof v === "number");

    if (todosNumeros) {
      const temDecimal = valores.some((v) => !Number.isInteger(v));
      const inteiros = Math.max(
        ...valores.map((v) => Math.trunc(Math.abs(v)).toString().length),
        1
      );
      const decimais = temDecimal ? 4 : 0;
      const len = Math.min(inteiros + decimais + (temDecimal ? 1 : 0) + 1, 19);
      return { name, dbfName, type: "N", length: len, decimals: decimais };
    }

    const maxLen = Math.max(
      ...valores.map((v) => Buffer.byteLength(String(v), "utf8")),
      1
    );
    return { name, dbfName, type: "C", length: Math.min(maxLen, 254), decimals: 0 };
  });
}

function buildDbf(records, fields) {
  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + fields.reduce((a, f) => a + f.length, 0);
  const buf = Buffer.alloc(headerLength + records.length * recordLength + 1);

  const now = new Date();
  buf.writeUInt8(0x03, 0);
  buf.writeUInt8(now.getFullYear() - 1900, 1);
  buf.writeUInt8(now.getMonth() + 1, 2);
  buf.writeUInt8(now.getDate(), 3);
  buf.writeInt32LE(records.length, 4);
  buf.writeInt16LE(headerLength, 8);
  buf.writeInt16LE(recordLength, 10);

  fields.forEach((f, i) => {
    const off = 32 + i * 32;
    buf.write(f.dbfName, off, 10, "ascii");
    buf.write(f.type, off + 11, 1, "ascii");
    buf.writeUInt8(f.length, off + 16);
    buf.writeUInt8(f.decimals, off + 17);
  });
  buf.writeUInt8(0x0d, 32 + fields.length * 32); // terminador do cabeçalho

  let off = headerLength;
  for (const rec of records) {
    buf.write(" ", off++, 1, "ascii"); // flag "não deletado"
    for (const f of fields) {
      const raw = rec[f.name];
      let texto;
      if (raw === null || raw === undefined) {
        texto = "".padStart(f.length, " ");
      } else if (f.type === "N") {
        texto = Number(raw).toFixed(f.decimals).slice(0, f.length).padStart(f.length, " ");
      } else {
        // Corta respeitando bytes UTF-8 para não gerar caractere partido.
        let s = String(raw).replace(/\s+/g, " ").trim();
        while (Buffer.byteLength(s, "utf8") > f.length) s = s.slice(0, -1);
        const pad = f.length - Buffer.byteLength(s, "utf8");
        texto = s + " ".repeat(pad);
      }
      buf.write(texto, off, f.length, "utf8");
      off += f.length;
    }
  }
  buf.writeUInt8(0x1a, off); // EOF

  return buf;
}

/**
 * Grava um conjunto .shp/.shx/.dbf/.prj/.cpg.
 *
 * @param {string} outPath  caminho sem extensão (ex.: "data/shapefiles/renda")
 * @param {object} featureCollection  GeoJSON FeatureCollection
 * @param {"POINT"|"POLYLINE"|"POLYGON"} tipo
 * @param {string[]} [campos]  ordem/seleção de campos do DBF
 */
function writeShapefile(outPath, featureCollection, tipo, campos) {
  const shapeType = SHAPE_TYPE[tipo];
  if (!shapeType) throw new Error(`Tipo não suportado: ${tipo}`);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Descarta feições sem geometria utilizável (senão o DBF sai fora de sincronia).
  const feats = featureCollection.features.filter((f) => {
    if (!f.geometry) return false;
    if (shapeType === SHAPE_TYPE.POINT) return f.geometry.type === "Point";
    return geometryToParts(f.geometry, shapeType).length > 0;
  });

  const shpRecords = [];
  const shxRecords = [];
  let offsetWords = 50; // o cabeçalho ocupa 100 bytes = 50 words
  let total = [Infinity, Infinity, -Infinity, -Infinity];

  feats.forEach((f, idx) => {
    let content;
    let bbox;

    if (shapeType === SHAPE_TYPE.POINT) {
      const [x, y] = f.geometry.coordinates;
      content = Buffer.alloc(20);
      content.writeInt32LE(SHAPE_TYPE.POINT, 0);
      content.writeDoubleLE(x, 4);
      content.writeDoubleLE(y, 12);
      bbox = [x, y, x, y];
    } else {
      const parts = geometryToParts(f.geometry, shapeType);
      const numPoints = parts.reduce((a, p) => a + p.length, 0);
      bbox = bboxOfParts(parts);

      content = Buffer.alloc(44 + 4 * parts.length + 16 * numPoints);
      content.writeInt32LE(shapeType, 0);
      content.writeDoubleLE(bbox[0], 4);
      content.writeDoubleLE(bbox[1], 12);
      content.writeDoubleLE(bbox[2], 20);
      content.writeDoubleLE(bbox[3], 28);
      content.writeInt32LE(parts.length, 36);
      content.writeInt32LE(numPoints, 40);

      let acumulado = 0;
      parts.forEach((p, i) => {
        content.writeInt32LE(acumulado, 44 + i * 4);
        acumulado += p.length;
      });

      let po = 44 + parts.length * 4;
      for (const part of parts) {
        for (const [x, y] of part) {
          content.writeDoubleLE(x, po);
          content.writeDoubleLE(y, po + 8);
          po += 16;
        }
      }
    }

    total = [
      Math.min(total[0], bbox[0]),
      Math.min(total[1], bbox[1]),
      Math.max(total[2], bbox[2]),
      Math.max(total[3], bbox[3]),
    ];

    const header = Buffer.alloc(8);
    header.writeInt32BE(idx + 1, 0); // número do registro (base 1)
    header.writeInt32BE(content.length / 2, 4); // tamanho em words
    shpRecords.push(header, content);

    const shx = Buffer.alloc(8);
    shx.writeInt32BE(offsetWords, 0);
    shx.writeInt32BE(content.length / 2, 4);
    shxRecords.push(shx);

    offsetWords += 4 + content.length / 2;
  });

  if (feats.length === 0) total = [0, 0, 0, 0];

  const shpHeader = Buffer.alloc(100);
  writeShpHeader(shpHeader, offsetWords, shapeType, total);
  fs.writeFileSync(outPath + ".shp", Buffer.concat([shpHeader, ...shpRecords]));

  const shxHeader = Buffer.alloc(100);
  writeShpHeader(shxHeader, 50 + 4 * feats.length, shapeType, total);
  fs.writeFileSync(outPath + ".shx", Buffer.concat([shxHeader, ...shxRecords]));

  const props = feats.map((f) => f.properties || {});
  const fields = inferFields(props, campos);
  fs.writeFileSync(outPath + ".dbf", buildDbf(props, fields));

  fs.writeFileSync(outPath + ".prj", PRJ_SIRGAS2000);
  fs.writeFileSync(outPath + ".cpg", "UTF-8");

  return { feicoes: feats.length, campos: fields.map((f) => f.dbfName) };
}

module.exports = { writeShapefile, PRJ_SIRGAS2000 };

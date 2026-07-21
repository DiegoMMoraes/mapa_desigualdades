/**
 * Leitor mínimo de ZIP usando só o zlib do Node.
 *
 * Existe para os scripts de download do IBGE não dependerem do comando `unzip`
 * (que não existe no Windows fora do Git Bash).
 * Suporta os dois métodos usados nos ZIPs do IBGE: store (0) e deflate (8).
 */
const zlib = require("zlib");

/**
 * @param {Buffer} buf conteúdo do .zip
 * @returns {Map<string, Buffer>} nome do arquivo -> conteúdo
 */
function unzip(buf) {
  // O "end of central directory" fica no fim do arquivo, depois de um comentário
  // de tamanho variável — por isso a busca de trás para frente.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido: end of central directory não encontrado");

  const nEntradas = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16); // início do diretório central

  const arquivos = new Map();

  for (let i = 0; i < nEntradas; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;

    const metodo = buf.readUInt16LE(off + 10);
    const tamComprimido = buf.readUInt32LE(off + 20);
    const nomeLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const comentLen = buf.readUInt16LE(off + 32);
    const offLocal = buf.readUInt32LE(off + 42);
    const nome = buf.toString("utf8", off + 46, off + 46 + nomeLen);

    if (!nome.endsWith("/")) {
      // O cabeçalho local repete nome/extra com tamanhos próprios: é dele que
      // sai o offset real dos dados comprimidos.
      const nomeLenL = buf.readUInt16LE(offLocal + 26);
      const extraLenL = buf.readUInt16LE(offLocal + 28);
      const inicio = offLocal + 30 + nomeLenL + extraLenL;
      const bruto = buf.subarray(inicio, inicio + tamComprimido);
      arquivos.set(nome, metodo === 0 ? bruto : zlib.inflateRawSync(bruto));
    }

    off += 46 + nomeLen + extraLen + comentLen;
  }

  return arquivos;
}

module.exports = { unzip };

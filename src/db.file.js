// Motor de armazenamento em arquivo binario unico (append-only).
//
// Por que binario: cada ideia carrega um embedding de 384 floats. Em JSON isso
// vira texto (~5 KB por ideia) e obriga o parser a converter 384 numeros um a um.
// Em binario sao 1536 bytes exatos e a leitura e so apontar um Float32Array pra
// cima dos bytes. Na pratica: ~4x menor e ~3x mais rapido de ler.
//
// Como funciona: no boot le o arquivo inteiro pra memoria (Map por id + matriz de
// embeddings). Toda consulta passa a ser acesso a RAM, sem engine de query e sem
// conexao. Na escrita, acrescenta um registro no fim do arquivo (O(1)) em vez de
// reescrever tudo. Deleção grava uma "tumba". Quando junta lixo demais, compacta
// reescrevendo limpo de forma atomica (temporario + fsync + rename).
//
// Formato do arquivo:
//   Cabecalho (16 bytes): magic "2BRAINDB" | versao u16 | dims u16 | reservado u32
//   Registro: tipo u8 | tamMeta u32 | tamEmb u32 | meta(JSON utf8) | embedding(cru)
//     tipo 1 = upsert (ideia), tipo 2 = tumba (deletada)
//
// Se o processo cair no meio de uma escrita, o ultimo registro fica truncado; a
// leitura para nele e ignora o resto, sem corromper o que ja estava salvo.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const ARQUIVO = process.env.DB_PATH || path.join(DATA_DIR, "2brain.bin");
const JSON_LEGADO = path.join(DATA_DIR, "ideias.json");

const MAGIC = Buffer.from("2BRAINDB", "utf8"); // 8 bytes
const VERSAO = 1;
const TAM_CABECALHO = 16;
const TAM_REG_HEADER = 9; // tipo(1) + tamMeta(4) + tamEmb(4)
const UPSERT = 1;
const TUMBA = 2;

// Compacta quando o lixo (registros substituidos/apagados) passa desta fracao.
const LIMITE_LIXO = 0.35;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- estado em memoria ----------
let ideias = new Map();   // id -> objeto da ideia (com embedding Float32Array)
let tumbas = new Map();   // id -> ISO da remocao (preservado p/ o merge nao ressuscitar)
let registrosNoArquivo = 0;
let matrizCache = null;
let carregado = false;

function invalidarMatriz() { matrizCache = null; }

// ---------- serializacao ----------
function embParaBuffer(emb) {
  if (!emb) return Buffer.alloc(0);
  const f32 = emb instanceof Float32Array ? emb : Float32Array.from(emb);
  return Buffer.from(f32.buffer.slice(f32.byteOffset, f32.byteOffset + f32.byteLength));
}

function bufferParaEmb(buf) {
  if (!buf || buf.length === 0) return null;
  // slice() gera um ArrayBuffer novo alinhado em 0: sem isso, um byteOffset que
  // nao seja multiplo de 4 estoura ao criar o Float32Array.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function montarRegistro(tipo, meta, embedding) {
  const mb = Buffer.from(JSON.stringify(meta), "utf8");
  const eb = embParaBuffer(embedding);
  const h = Buffer.alloc(TAM_REG_HEADER);
  h.writeUInt8(tipo, 0);
  h.writeUInt32LE(mb.length, 1);
  h.writeUInt32LE(eb.length, 5);
  return Buffer.concat([h, mb, eb]);
}

function montarCabecalho(dims = 0) {
  const h = Buffer.alloc(TAM_CABECALHO);
  MAGIC.copy(h, 0);
  h.writeUInt16LE(VERSAO, 8);
  h.writeUInt16LE(dims, 10);
  return h;
}

/**
 * Le um buffer no formato do arquivo e devolve o estado.
 * Tolerante a truncamento: para no primeiro registro incompleto.
 */
export function lerBuffer(buf) {
  if (!buf || buf.length < TAM_CABECALHO) {
    throw new Error("Arquivo pequeno demais ou vazio.");
  }
  if (!buf.subarray(0, 8).equals(MAGIC)) {
    throw new Error("Arquivo nao parece um backup do 2brain (assinatura invalida).");
  }
  const versao = buf.readUInt16LE(8);
  if (versao > VERSAO) {
    throw new Error(`Arquivo na versao ${versao}, mas este app le ate a ${VERSAO}.`);
  }

  const mapa = new Map();
  const mortos = new Map();
  let off = TAM_CABECALHO;
  let total = 0;

  while (off + TAM_REG_HEADER <= buf.length) {
    const tipo = buf.readUInt8(off);
    const tamMeta = buf.readUInt32LE(off + 1);
    const tamEmb = buf.readUInt32LE(off + 5);
    const fim = off + TAM_REG_HEADER + tamMeta + tamEmb;
    if (fim > buf.length) break; // registro truncado: ignora daqui pra frente

    const inicioMeta = off + TAM_REG_HEADER;
    let meta;
    try {
      meta = JSON.parse(buf.subarray(inicioMeta, inicioMeta + tamMeta).toString("utf8"));
    } catch {
      break; // meta corrompido: para com seguranca
    }

    if (tipo === UPSERT) {
      const emb = tamEmb > 0
        ? bufferParaEmb(buf.subarray(inicioMeta + tamMeta, fim))
        : null;
      mapa.set(meta.id, { ...meta, embedding: emb });
      mortos.delete(meta.id);
    } else if (tipo === TUMBA) {
      mapa.delete(meta.id);
      mortos.set(meta.id, meta.apagado_em || new Date().toISOString());
    }
    total++;
    off = fim;
  }

  return { ideias: mapa, tumbas: mortos, registros: total, versao };
}

// ---------- carga / gravacao ----------
function carregar() {
  if (carregado) return;
  carregado = true;
  if (!fs.existsSync(ARQUIVO)) {
    fs.writeFileSync(ARQUIVO, montarCabecalho());
    console.log(`[db] arquivo binario novo criado em ${ARQUIVO}`);
    return;
  }
  try {
    const buf = fs.readFileSync(ARQUIVO);
    const estado = lerBuffer(buf);
    ideias = estado.ideias;
    tumbas = estado.tumbas;
    registrosNoArquivo = estado.registros;
    console.log(`[db] arquivo binario: ${ideias.size} ideia(s) em memoria (${estado.registros} registro(s) lidos).`);
  } catch (err) {
    console.error(`[db] falha ao ler ${ARQUIVO}: ${err.message}`);
    throw err;
  }
}

// Fila de escrita: garante que dois appends nunca se embaralhem.
let fila = Promise.resolve();
function enfileirar(fn) {
  const proxima = fila.then(fn, fn);
  fila = proxima.catch(() => {});
  return proxima;
}

function anexar(buffer) {
  fs.appendFileSync(ARQUIVO, buffer);
  registrosNoArquivo++;
}

function lixoDemais() {
  const vivos = ideias.size + tumbas.size;
  if (registrosNoArquivo < 50) return false;
  return vivos > 0 && (registrosNoArquivo - vivos) / registrosNoArquivo > LIMITE_LIXO;
}

/** Reescreve o arquivo limpo, de forma atomica (temporario + fsync + rename). */
export function compactar() {
  carregar();
  const dims = primeiraDims();
  const partes = [montarCabecalho(dims)];
  for (const ideia of ideias.values()) {
    const { embedding, ...meta } = ideia;
    partes.push(montarRegistro(UPSERT, meta, embedding));
  }
  for (const [id, quando] of tumbas.entries()) {
    partes.push(montarRegistro(TUMBA, { id, apagado_em: quando }, null));
  }
  const buf = Buffer.concat(partes);
  const tmp = `${ARQUIVO}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, ARQUIVO);
  registrosNoArquivo = ideias.size + tumbas.size;
  return { registros: registrosNoArquivo, bytes: buf.length };
}

function primeiraDims() {
  for (const it of ideias.values()) if (it.embedding) return it.embedding.length;
  return 0;
}

function compactarSePreciso() {
  if (lixoDemais()) compactar();
}

// ---------- matriz de embeddings (busca por similaridade) ----------
function getMatriz() {
  if (matrizCache) return matrizCache;
  const comEmb = [];
  for (const it of ideias.values()) if (it.embedding) comEmb.push(it);
  if (comEmb.length === 0) {
    matrizCache = { ids: [], mat: new Float32Array(0), dims: 0 };
    return matrizCache;
  }
  const dims = comEmb[0].embedding.length;
  const mat = new Float32Array(comEmb.length * dims);
  const ids = new Array(comEmb.length);
  for (let r = 0; r < comEmb.length; r++) {
    ids[r] = comEmb[r].id;
    mat.set(comEmb[r].embedding, r * dims);
  }
  matrizCache = { ids, mat, dims };
  return matrizCache;
}

// ---------- interface publica (a mesma que o SQLite/Postgres expunham) ----------

function ordenarPorCriacao(lista) {
  return lista.sort((a, b) => String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
}

export async function listarTodas() {
  carregar();
  return ordenarPorCriacao([...ideias.values()].map(clonar));
}

export async function buscarPorId(id) {
  carregar();
  const it = ideias.get(id);
  return it ? clonar(it) : null;
}

function clonar(it) {
  return { ...it, tags: [...(it.tags ?? [])], relacionados: [...(it.relacionados ?? [])] };
}

function normalizar(ideia) {
  const agora = new Date().toISOString();
  return {
    id: ideia.id,
    texto_original: ideia.texto_original,
    resumo: ideia.resumo ?? null,
    area: ideia.area ?? null,
    tags: ideia.tags ?? [],
    tipo: ideia.tipo ?? "ideia",
    data_evento: ideia.data_evento ?? null,
    relacionados: ideia.relacionados ?? [],
    criado_em: ideia.criado_em ?? agora,
    // carimbado aqui dentro: e o que permite o merge decidir qual versao vence.
    atualizado_em: agora,
    embedding: ideia.embedding ?? null,
  };
}

export async function salvar(ideia) {
  carregar();
  return enfileirar(() => {
    const completo = normalizar(ideia);
    const { embedding, ...meta } = completo;
    anexar(montarRegistro(UPSERT, meta, embedding));
    ideias.set(completo.id, completo);
    tumbas.delete(completo.id);
    invalidarMatriz();
    compactarSePreciso();
    return clonar(completo);
  });
}

export async function atualizar(id, atualizarFn) {
  carregar();
  return enfileirar(() => {
    const atual = ideias.get(id);
    if (!atual) return null;
    const novo = normalizar(atualizarFn(clonar(atual)));
    const { embedding, ...meta } = novo;
    anexar(montarRegistro(UPSERT, meta, embedding));
    ideias.set(id, novo);
    invalidarMatriz();
    compactarSePreciso();
    return clonar(novo);
  });
}

export async function remover(id) {
  carregar();
  return enfileirar(() => {
    if (!ideias.has(id)) return false;
    const quando = new Date().toISOString();
    anexar(montarRegistro(TUMBA, { id, apagado_em: quando }, null));
    ideias.delete(id);
    tumbas.set(id, quando);
    invalidarMatriz();
    compactarSePreciso();
    return true;
  });
}

/**
 * Top-K candidatas por similaridade (dot de vetores normalizados = cosseno).
 * Favorece recall: retorna as K mais parecidas acima de um piso baixo.
 */
export async function topKSimilares(embedding, { k = 10, piso = 0.3, excluirId = null } = {}) {
  carregar();
  const { ids, mat, dims } = getMatriz();
  if (dims === 0 || !embedding) return [];
  const q = embedding instanceof Float32Array ? embedding : Float32Array.from(embedding);
  const scores = [];
  for (let r = 0; r < ids.length; r++) {
    if (ids[r] === excluirId) continue;
    let dot = 0;
    const base = r * dims;
    for (let i = 0; i < dims; i++) dot += q[i] * mat[base + i];
    if (dot >= piso) scores.push({ id: ids[r], score: dot });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

/** Importa dados antigos uma unica vez (embeddings sao descartados: modelo mudou). */
export async function importarLegadoSeVazio() {
  carregar();
  if (ideias.size > 0) return { importadas: 0, motivo: "arquivo ja populado" };
  if (!fs.existsSync(JSON_LEGADO)) return { importadas: 0, motivo: "sem json legado" };

  const antigas = JSON.parse(fs.readFileSync(JSON_LEGADO, "utf-8") || "[]");
  for (const it of antigas) {
    await salvar({ ...it, relacionados: [], embedding: null });
  }
  return { importadas: antigas.length, motivo: "importado do ideias.json" };
}

// ---------- backup / restore ----------

/** Compacta e devolve o arquivo em memoria, pronto pra download. */
export function exportarBackup() {
  carregar();
  compactar(); // garante consistencia e menor tamanho
  return fs.readFileSync(ARQUIVO);
}

function quandoLocal(id) {
  const it = ideias.get(id);
  if (it) return { tipo: "ideia", em: it.atualizado_em || it.criado_em || "", dado: it };
  if (tumbas.has(id)) return { tipo: "tumba", em: tumbas.get(id), dado: null };
  return null;
}

function quandoDe(estado, id) {
  const it = estado.ideias.get(id);
  if (it) return { tipo: "ideia", em: it.atualizado_em || it.criado_em || "", dado: it };
  if (estado.tumbas.has(id)) return { tipo: "tumba", em: estado.tumbas.get(id), dado: null };
  return null;
}

// relacionados sao objetos { id, motivo, score }: dedupe pelo id, nao por referencia.
function unir(a, b) {
  const porId = new Map();
  for (const r of [...(a || []), ...(b || [])]) {
    if (!r) continue;
    const id = typeof r === "string" ? r : r.id;
    if (!id) continue;
    if (!porId.has(id)) porId.set(id, r);
  }
  return [...porId.values()];
}

/**
 * Restaura a partir de um buffer.
 * modo "substituir" (padrao): troca tudo pelo backup.
 * modo "mesclar": junta os dois lados; em conflito vence quem foi mexido por ultimo.
 *   - so no backup -> entra
 *   - so no local  -> fica
 *   - nos dois     -> vence atualizado_em mais novo
 *   - apagado de um lado e editado do outro -> vence o evento mais recente
 *   - relacionados viram a uniao; se a versao vencedora estiver sem embedding
 *     e a perdedora tiver, aproveita o embedding.
 * simular=true calcula o relatorio e NAO grava nada.
 */
export function restaurarBackup(buffer, { modo = "substituir", simular = false } = {}) {
  carregar();
  const backup = lerBuffer(buffer); // valida magic/versao antes de qualquer coisa

  if (modo === "substituir") {
    const relatorio = {
      modo, simulado: simular,
      backup: { ideias: backup.ideias.size, tumbas: backup.tumbas.size },
      antes: { ideias: ideias.size },
      depois: { ideias: backup.ideias.size },
      substituidas: ideias.size,
    };
    if (!simular) {
      ideias = backup.ideias;
      tumbas = backup.tumbas;
      invalidarMatriz();
      compactar();
    }
    return relatorio;
  }

  if (modo !== "mesclar") throw new Error(`Modo invalido: ${modo}. Use "substituir" ou "mesclar".`);

  const todosIds = new Set([
    ...ideias.keys(), ...tumbas.keys(),
    ...backup.ideias.keys(), ...backup.tumbas.keys(),
  ]);

  const resultado = new Map();
  const mortosFinal = new Map();
  const rel = { entraram: 0, atualizadas: 0, mantidas: 0, removidas: 0, conflitos: [] };

  for (const id of todosIds) {
    const L = quandoLocal(id);
    const B = quandoDe(backup, id);

    // so de um lado
    if (L && !B) {
      if (L.tipo === "ideia") { resultado.set(id, L.dado); rel.mantidas++; }
      else mortosFinal.set(id, L.em);
      continue;
    }
    if (B && !L) {
      if (B.tipo === "ideia") { resultado.set(id, B.dado); rel.entraram++; }
      else mortosFinal.set(id, B.em);
      continue;
    }
    if (!L && !B) continue;

    // nos dois: vence o evento mais recente
    const backupVence = String(B.em) > String(L.em);
    const vencedor = backupVence ? B : L;
    const perdedor = backupVence ? L : B;

    if (L.tipo === "ideia" && B.tipo === "ideia") {
      const base = { ...vencedor.dado };
      base.relacionados = unir(L.dado.relacionados, B.dado.relacionados);
      if (!base.embedding && perdedor.dado?.embedding) base.embedding = perdedor.dado.embedding;
      resultado.set(id, base);
      if (backupVence) rel.atualizadas++; else rel.mantidas++;
      if (String(L.em) !== String(B.em)) {
        rel.conflitos.push({ id, localEm: L.em, backupEm: B.em, venceu: backupVence ? "backup" : "local" });
      }
    } else if (vencedor.tipo === "tumba") {
      mortosFinal.set(id, vencedor.em);
      if (backupVence) rel.removidas++;
      rel.conflitos.push({ id, localEm: L.em, backupEm: B.em, venceu: backupVence ? "backup" : "local", nota: "removida (tumba mais recente)" });
    } else {
      // vencedor e a ideia, perdedor e a tumba: ressuscita porque foi editada depois
      resultado.set(id, vencedor.dado);
      if (backupVence) rel.entraram++; else rel.mantidas++;
      rel.conflitos.push({ id, localEm: L.em, backupEm: B.em, venceu: backupVence ? "backup" : "local", nota: "mantida (edicao mais recente que a remocao)" });
    }
  }

  const relatorio = {
    modo, simulado: simular,
    backup: { ideias: backup.ideias.size, tumbas: backup.tumbas.size },
    antes: { ideias: ideias.size },
    depois: { ideias: resultado.size },
    ...rel,
  };

  if (!simular) {
    ideias = resultado;
    tumbas = mortosFinal;
    invalidarMatriz();
    compactar();
  }
  return relatorio;
}

export function estatisticas() {
  carregar();
  let bytes = 0;
  try { bytes = fs.statSync(ARQUIVO).size; } catch {}
  return {
    arquivo: ARQUIVO,
    ideias: ideias.size,
    removidas: tumbas.size,
    registrosNoArquivo,
    bytes,
    dims: primeiraDims(),
  };
}
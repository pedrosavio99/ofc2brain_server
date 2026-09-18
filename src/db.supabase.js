// Motor de armazenamento: Supabase (Postgres + pgvector).
// Substitui o db.file.js (arquivo binario em RAM), que nao servia pra
// serverless (disco efemero, estado em memoria). Mesma interface publica.

import { createClient } from "@supabase/supabase-js";

if (typeof globalThis.WebSocket === "undefined") {
  const { default: WS } = await import("ws");
  globalThis.WebSocket = WS;
}

const URL = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SECRET_KEY ||        // novo formato: sb_secret_... (recomendado)
  process.env.SUPABASE_SERVICE_ROLE_KEY ||  // legado (JWT), deprecado ate fim de 2026
  process.env.SUPABASE_KEY; // chave de servidor: a API roda no backend, sem RLS de usuario

if (!URL || !KEY) {
  console.warn(
    "[db] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes. As rotas de dados vao falhar ate configurar."
  );
}

// Cliente reaproveitado entre invocacoes quentes (escopo de modulo).
const sb = createClient(URL || "http://invalido", KEY || "invalido", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABELA = "ideias";

// ---------- helpers ----------

// pgvector aceita o formato texto "[a,b,c]" no insert/update.
function vetorParaLiteral(emb) {
  if (!emb) return null;
  const arr = emb instanceof Float32Array ? Array.from(emb) : emb;
  return "[" + arr.map((n) => Number(n)).join(",") + "]";
}

// no read, o embedding volta como string "[...]" (ou ja como array).
function literalParaVetor(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function linhaParaIdeia(row) {
  if (!row) return null;
  return {
    id: row.id,
    texto_original: row.texto_original,
    resumo: row.resumo ?? null,
    area: row.area ?? null,
    tags: row.tags ?? [],
    tipo: row.tipo ?? "ideia",
    data_evento: row.data_evento ?? null,
    relacionados: row.relacionados ?? [],
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    embedding: literalParaVetor(row.embedding),
  };
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
    atualizado_em: agora,
    embedding: ideia.embedding ?? null,
  };
}

function paraRow(ideia) {
  const { embedding, ...resto } = ideia;
  return { ...resto, embedding: vetorParaLiteral(embedding) };
}

// ---------- interface publica (igual ao motor antigo) ----------

// Colunas da ideia sem o vetor. O embedding sao 768 floats, cerca de 8 KB por
// nota em texto, e a maior parte do app nunca olha pra ele: a listagem joga
// fora com semExpoerEmbedding antes de responder. Trazer so isto e a diferenca
// entre 8 MB e 0,5 MB numa base de mil notas.
const COLUNAS_LEVES =
  "id,texto_original,resumo,area,tags,tipo,data_evento,relacionados,criado_em,atualizado_em";

// O PostgREST tem teto de linhas por resposta (o padrao costuma ser 1000) e
// nao avisa quando corta: a lista simplesmente volta incompleta. Aqui a gente
// pagina ate acabar. O desempate por id e obrigatorio: sem ele, duas notas com
// o mesmo criado_em podem cair na mesma pagina duas vezes, ou em nenhuma.
const PAGINA = 1000;

async function buscarPaginado(colunas, aplicarFiltros) {
  const linhas = [];
  for (let pagina = 0; ; pagina++) {
    let consulta = sb.from(TABELA).select(colunas);
    if (aplicarFiltros) consulta = aplicarFiltros(consulta);
    const { data, error } = await consulta
      .order("criado_em", { ascending: true })
      .order("id", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) throw new Error(`buscarPaginado: ${error.message}`);
    const lote = data || [];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return linhas;
}

// Mantida como estava: traz a linha inteira, INCLUSIVE o embedding. O relink e
// o exportarBackup dependem do vetor; trocar isto por listarResumidas apagaria
// o grafo no relink e geraria backup sem vetor. So a paginacao foi acrescentada.
export async function listarTodas() {
  return (await buscarPaginado("*")).map(linhaParaIdeia);
}

// Mesma coisa, sem o vetor. Use onde o embedding nao e lido.
// O campo embedding volta como null nos objetos.
export async function listarResumidas() {
  return (await buscarPaginado(COLUNAS_LEVES)).map(linhaParaIdeia);
}

/**
 * Notas criadas dentro de um intervalo. Usado pelo filtro de data da conversa.
 *
 * criado_em e timestamptz, entao o intervalo desce pro Postgres de verdade e
 * usa indice, diferente de data_evento (text) ali embaixo.
 *
 * Intervalo meio aberto: [desde, ate). Assim "hoje" e desde 00:00 de hoje ate
 * 00:00 de amanha, sem a nota da meia-noite em ponto cair nos dois dias.
 *
 * @param {string} desde ISO
 * @param {string} ate   ISO, exclusivo
 */
export async function listarPorPeriodo(desde, ate) {
  const linhas = await buscarPaginado(COLUNAS_LEVES, (q) =>
    q.gte("criado_em", desde).lt("criado_em", ate));
  return linhas.map(linhaParaIdeia);
}

// Eventos: o filtro por tipo desce pro Postgres, que e onde ele deveria estar.
// A janela de dias NAO desce junto de proposito: data_evento e text no schema,
// e comparar data como texto depende do formato gravado. Quem decide a janela
// continua sendo o ideasService, exatamente como hoje.
export async function listarEventos() {
  const linhas = await buscarPaginado(COLUNAS_LEVES, (q) =>
    q.eq("tipo", "lembrete_evento").not("data_evento", "is", null));
  return linhas.map(linhaParaIdeia);
}

export async function buscarPorId(id) {
  const { data, error } = await sb.from(TABELA).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`buscarPorId: ${error.message}`);
  return linhaParaIdeia(data);
}

export async function salvar(ideia) {
  const completo = normalizar(ideia);
  const { data, error } = await sb
    .from(TABELA)
    .upsert(paraRow(completo), { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw new Error(`salvar: ${error.message}`);
  return linhaParaIdeia(data);
}

export async function atualizar(id, atualizarFn) {
  const atual = await buscarPorId(id);
  if (!atual) return null;
  const novo = normalizar(atualizarFn({ ...atual }));
  novo.id = id;
  novo.criado_em = atual.criado_em; // preserva a criacao original
  const { data, error } = await sb
    .from(TABELA)
    .upsert(paraRow(novo), { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw new Error(`atualizar: ${error.message}`);
  return linhaParaIdeia(data);
}

export async function remover(id) {
  const { data, error } = await sb.from(TABELA).delete().eq("id", id).select("id");
  if (error) throw new Error(`remover: ${error.message}`);
  return (data || []).length > 0;
}

export async function topKSimilares(embedding, { k = 10, piso = 0.3, excluirId = null } = {}) {
  const literal = vetorParaLiteral(embedding);
  if (!literal) return [];
  const { data, error } = await sb.rpc("match_ideias", {
    query_embedding: literal,
    match_count: k,
    piso,
    excluir: excluirId,
  });
  if (error) throw new Error(`topKSimilares: ${error.message}`);
  // ja vem ordenado por score desc; shape { id, score }
  return (data || []).map((r) => ({ id: r.id, score: Number(r.score) }));
}

// Migracao de JSON legado nao se aplica aqui: use o seed (scripts/seed-supabase.mjs).
export async function importarLegadoSeVazio() {
  return { importadas: 0, motivo: "supabase: use o seed" };
}

export async function estatisticas() {
  const { count, error } = await sb
    .from(TABELA)
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`estatisticas: ${error.message}`);
  return { motor: "supabase", ideias: count ?? 0, tumbas: 0 };
}

// ---------- backup: agora e export/import JSON (o .bin nao existe mais) ----------

export async function exportarBackup() {
  const todas = await listarTodas();
  const payload = { versao: 2, motor: "supabase", exportado_em: new Date().toISOString(), ideias: todas };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export async function restaurarBackup(buffer, { modo = "mesclar" } = {}) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    throw new Error("backup invalido: esperado JSON do 2brain v2");
  }
  const ideias = Array.isArray(payload) ? payload : payload.ideias || [];
  if (modo === "substituir") {
    const { error } = await sb.from(TABELA).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(`restore(limpar): ${error.message}`);
  }
  let importadas = 0;
  for (const it of ideias) {
    await salvar(it);
    importadas++;
  }
  return { importadas, modo };
}

// Compactacao era coisa do arquivo append-only. No Postgres nao ha lixo assim.
export async function compactar() {
  return { motor: "supabase", compactar: "no-op" };
}

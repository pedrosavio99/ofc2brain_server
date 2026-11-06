/**
 * Banco do modulo LINKS CURTOS: Supabase (tabela links_curtos).
 * Cliente proprio do modulo, no padrao de treino e refeicao: o core nao
 * exporta o `sb` e nao e mexido.
 */
import { createClient } from "@supabase/supabase-js";

if (typeof globalThis.WebSocket === "undefined") {
  const { default: WS } = await import("ws");
  globalThis.WebSocket = WS;
}

const URL = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const sb = createClient(URL || "http://invalido", KEY || "invalido", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABELA = "links_curtos";
const COLUNAS = "id, titulo, url_longa, url_curta, servico, alias, curto_em, criado_em";
const ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ErroHttp extends Error {
  constructor(status, mensagem, dica = "") {
    super(mensagem);
    this.status = status;
    this.dica = dica;
  }
}

export function validarId(id) {
  if (!ID_UUID.test(String(id || ""))) throw new ErroHttp(400, "Id inválido.");
  return String(id);
}

/** Traduz o erro do Supabase. O caso comum e esquecer de rodar o SQL. */
function falhar(error, acao) {
  const faltaTabela = error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message || "");
  if (faltaTabela) {
    throw new ErroHttp(503, "A tabela dos links curtos ainda não existe no Supabase.", "Rode supabase/links.sql no SQL Editor do Supabase.");
  }
  console.error(`[links] ${acao}: ${error.message}`);
  throw new ErroHttp(500, "Não consegui acessar os links no banco.");
}

export async function listar() {
  const { data, error } = await sb.from(TABELA).select(COLUNAS).order("criado_em", { ascending: false }).limit(500);
  if (error) falhar(error, "listar");
  return data || [];
}

export async function buscarPorId(id) {
  const { data, error } = await sb.from(TABELA).select(COLUNAS).eq("id", validarId(id)).maybeSingle();
  if (error) falhar(error, "buscar");
  if (!data) throw new ErroHttp(404, "Link não encontrado.");
  return data;
}

/** Adiciona varios de uma vez, pulando o que ja esta na lista. */
export async function adicionar(urls, titulo = "") {
  const existentes = new Set((await listar()).map((l) => l.url_longa));
  const novas = [...new Set(urls)].filter((u) => !existentes.has(u));
  if (!novas.length) return { criados: [], repetidos: urls.length };

  const linhas = novas.map((u) => ({ url_longa: u, titulo: novas.length === 1 ? titulo : "" }));
  const { data, error } = await sb.from(TABELA).insert(linhas).select(COLUNAS);
  if (error) falhar(error, "adicionar");
  return { criados: data || [], repetidos: urls.length - novas.length };
}

/** Atualiza so os campos enviados. */
export async function atualizar(id, campos) {
  const { data, error } = await sb
    .from(TABELA)
    .update({ ...campos, atualizado_em: new Date().toISOString() })
    .eq("id", validarId(id))
    .select(COLUNAS)
    .maybeSingle();
  if (error) falhar(error, "atualizar");
  if (!data) throw new ErroHttp(404, "Link não encontrado.");
  return data;
}

export async function excluir(id) {
  const { error } = await sb.from(TABELA).delete().eq("id", validarId(id));
  if (error) falhar(error, "excluir");
}

/**
 * Acesso ao banco do modulo CONVERSA.
 *
 * Cliente proprio de proposito: o db.supabase.js do core nao exporta o `sb`,
 * e expor so pra atender modulo seria mexer no core pra viabilizar plugue.
 * As tabelas daqui (conversas, conversa_turnos, alma) sao do modulo; `ideias`
 * continua sendo assunto exclusivo do core.
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

/* Erro com status, pra rota traduzir em HTTP sem ficar adivinhando. */
export class ErroHttp extends Error {
  constructor(status, mensagem, dica = "") {
    super(mensagem);
    this.status = status;
    this.dica = dica;
  }
}

export async function criarConversa(titulo = null) {
  const { data, error } = await sb
    .from("conversas")
    .insert({ titulo: titulo ? String(titulo).slice(0, 200) : null })
    .select("id, titulo, criado_em")
    .single();
  if (error) throw new Error(`criarConversa: ${error.message}`);
  return data;
}

export async function conversaExiste(id) {
  const { data, error } = await sb.from("conversas").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`conversaExiste: ${error.message}`);
  return Boolean(data);
}

export async function proximaOrdem(conversaId) {
  const { data, error } = await sb.rpc("proxima_ordem", { p_conversa: conversaId });
  if (error) throw new Error(`proximaOrdem: ${error.message}`);
  return Number(data) || 1;
}

/**
 * Insere um turno. Devolve { turno, duplicado }.
 * Duplicado nao e erro: e o retry do cliente batendo na trava de ordem unica.
 */
export async function inserirTurno({ conversaId, ordem, papel, texto, mensagens = [], notasUsadas = [], meta = {} }) {
  const { data, error } = await sb
    .from("conversa_turnos")
    .insert({
      conversa_id: conversaId,
      ordem,
      papel,
      texto: String(texto || ""),
      mensagens,
      notas_usadas: notasUsadas,
      meta,
    })
    .select("*")
    .single();
  if (error) {
    // 23505 = unique_violation. Quem ja esta la vale mais que um 500.
    if (error.code === "23505") {
      const existente = await buscarTurno(conversaId, ordem);
      if (existente) return { turno: existente, duplicado: true };
    }
    throw new Error(`inserirTurno: ${error.message}`);
  }
  return { turno: data, duplicado: false };
}

export async function buscarTurno(conversaId, ordem) {
  const { data, error } = await sb
    .from("conversa_turnos")
    .select("*")
    .eq("conversa_id", conversaId)
    .eq("ordem", ordem)
    .maybeSingle();
  if (error) throw new Error(`buscarTurno: ${error.message}`);
  return data || null;
}

/** Ultimos N turnos em ordem cronologica (o select desce, a gente inverte). */
export async function ultimosTurnos(conversaId, n = 8) {
  const { data, error } = await sb
    .from("conversa_turnos")
    .select("ordem, papel, texto, criado_em")
    .eq("conversa_id", conversaId)
    .order("ordem", { ascending: false })
    .limit(Math.max(1, Math.min(Number(n) || 8, 40)));
  if (error) throw new Error(`ultimosTurnos: ${error.message}`);
  return (data || []).reverse();
}

export async function contarTurnosTotal() {
  const { count, error } = await sb
    .from("conversa_turnos")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`contarTurnosTotal: ${error.message}`);
  return count ?? 0;
}

/**
 * Os turnos ainda nao destilados, de TODAS as conversas.
 * Por recencia e nao por offset: o cru vence em 90 dias, entao offset em cima
 * de uma tabela que encolhe pularia turno sem ninguem perceber.
 */
export async function turnosNaoDestilados(quantos) {
  const n = Math.max(1, Math.min(Number(quantos) || 20, 60));
  const { data, error } = await sb
    .from("conversa_turnos")
    .select("papel, texto, criado_em")
    .order("criado_em", { ascending: false })
    .limit(n);
  if (error) throw new Error(`turnosNaoDestilados: ${error.message}`);
  return (data || []).reverse();
}

/* ------------------------------------------------------------------
   Lista, favorito, arquivo e exclusao de conversas.
   ------------------------------------------------------------------ */

/** Favoritas primeiro, depois as mexidas mais recentemente. */
export async function listarConversas({ arquivadas = false, limite = 60 } = {}) {
  const { data, error } = await sb
    .from("conversas")
    .select("id, titulo, favorita, arquivada, criado_em, atualizado_em")
    .eq("arquivada", Boolean(arquivadas))
    .order("favorita", { ascending: false })
    .order("atualizado_em", { ascending: false })
    .limit(Math.max(1, Math.min(Number(limite) || 60, 200)));
  if (error) throw new Error(`listarConversas: ${error.message}`);
  return data || [];
}

export async function atualizarConversa(id, campos) {
  const patch = {};
  if (typeof campos.titulo === "string") patch.titulo = campos.titulo.trim().slice(0, 200) || null;
  if (typeof campos.favorita === "boolean") patch.favorita = campos.favorita;
  if (typeof campos.arquivada === "boolean") patch.arquivada = campos.arquivada;
  if (!Object.keys(patch).length) throw new ErroHttp(400, "Nada pra mudar.");
  const { data, error } = await sb
    .from("conversas").update(patch).eq("id", id)
    .select("id, titulo, favorita, arquivada, atualizado_em").maybeSingle();
  if (error) throw new Error(`atualizarConversa: ${error.message}`);
  if (!data) throw new ErroHttp(404, "Conversa nao encontrada.");
  return data;
}

/* Os turnos saem junto pelo ON DELETE CASCADE do schema. Nao apagamos turno
   aqui na mao de proposito: duas fontes de verdade pra mesma regra e o jeito
   mais rapido de uma delas ficar pra tras. */
export async function excluirConversa(id) {
  const { data, error } = await sb.from("conversas").delete().eq("id", id).select("id");
  if (error) throw new Error(`excluirConversa: ${error.message}`);
  if (!(data || []).length) throw new ErroHttp(404, "Conversa nao encontrada.");
  return { ok: true, id };
}

/* Titulo a partir da primeira frase da pessoa. Sem LLM de proposito: gastar
   chamada pra nomear conversa seria queimar cota no lugar errado. */
export function tituloDoTexto(texto) {
  const limpo = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  const corte = limpo.split(/(?<=[.!?])\s/)[0] || limpo;
  return (corte.length > 60 ? corte.slice(0, 57) + "..." : corte);
}

/** So nomeia se ainda nao tem titulo: renomear na mao nao pode ser desfeito sozinho. */
export async function nomearSeVazia(id, texto) {
  const { data } = await sb.from("conversas").select("titulo").eq("id", id).maybeSingle();
  if (!data || data.titulo) return null;
  const titulo = tituloDoTexto(texto);
  if (!titulo) return null;
  await sb.from("conversas").update({ titulo }).eq("id", id);
  return titulo;
}

/* ------------------------------------------------------------------
   Tracos da alma. Um por linha, com contagem de repeticao.
   ------------------------------------------------------------------ */

export async function listarTracos({ incluirInativos = false } = {}) {
  let q = sb.from("alma_tracos")
    .select("id, traco, categoria, exemplo, vezes, ativo, fixado, primeira_vez, ultima_vez");
  if (!incluirInativos) q = q.eq("ativo", true);
  const { data, error } = await q
    .order("vezes", { ascending: false })
    .order("ultima_vez", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listarTracos: ${error.message}`);
  return data || [];
}

/** Usa a RPC: a deduplicacao por texto vive no banco, num indice unico. */
export async function registrarTraco({ traco, categoria = null, exemplo = null }) {
  const { data, error } = await sb.rpc("registrar_traco", {
    p_traco: traco, p_categoria: categoria, p_exemplo: exemplo,
  });
  if (error) throw new Error(`registrarTraco: ${error.message}`);
  return data || null;
}

export async function atualizarTraco(id, campos) {
  const patch = {};
  if (typeof campos.ativo === "boolean") patch.ativo = campos.ativo;
  if (typeof campos.fixado === "boolean") patch.fixado = campos.fixado;
  if (typeof campos.traco === "string" && campos.traco.trim()) patch.traco = campos.traco.trim();
  if (!Object.keys(patch).length) throw new ErroHttp(400, "Nada pra mudar.");
  const { data, error } = await sb.from("alma_tracos").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(`atualizarTraco: ${error.message}`);
  if (!data) throw new ErroHttp(404, "Traco nao encontrado.");
  return data;
}

export async function excluirTraco(id) {
  const { data, error } = await sb.from("alma_tracos").delete().eq("id", id).select("id");
  if (error) throw new Error(`excluirTraco: ${error.message}`);
  if (!(data || []).length) throw new ErroHttp(404, "Traco nao encontrado.");
  return { ok: true, id };
}

/* ------------------------------------------------------------------
   Panorama da base. Agregado no Postgres, nao no Node: o insight puxa
   todas as notas pra somar em JS, e por turno de conversa isso seria
   baixar a base inteira toda vez.
   ------------------------------------------------------------------ */

let panoramaCache = { em: 0, dados: null };
const PANORAMA_TTL_MS = 5 * 60 * 1000;

/** Cache de 5 min: a base muda devagar e isso nao pode custar uma ida por turno. */
export async function panoramaBase() {
  if (panoramaCache.dados && Date.now() - panoramaCache.em < PANORAMA_TTL_MS) {
    return panoramaCache.dados;
  }
  const { data, error } = await sb.rpc("panorama_base");
  if (error) throw new Error(`panoramaBase: ${error.message}`);
  panoramaCache = { em: Date.now(), dados: data || null };
  return panoramaCache.dados;
}

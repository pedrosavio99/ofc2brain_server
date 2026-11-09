/**
 * Persistencia do radar vivo (Supabase). Sao 3 tabelas, em supabase/trendradar-v2.sql.
 *
 * Se as tabelas ainda nao existem, NADA quebra: o radar funciona em memoria
 * (vale enquanto o processo vive) e avisa UMA vez como corrigir. Em serverless
 * a memoria some a cada cold start, entao o aviso e importante: sem o SQL o
 * radar nao acumula historico.
 */
import { createClient } from "@supabase/supabase-js";

if (typeof globalThis.WebSocket === "undefined") {
  const { default: WS } = await import("ws");
  globalThis.WebSocket = WS;
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const sb = createClient(URL || "http://invalido", KEY || "invalido", { auth: { persistSession: false, autoRefreshToken: false } });

const DICA = "Rode supabase/trendradar-v2.sql no SQL Editor do Supabase.";
const DICA_ESQUEMA = "O banco está na versão antiga do radar. Rode de novo supabase/trendradar-v2.sql no SQL Editor (é seguro repetir).";
const estado = { ausente: false, esquemaAntigo: false, avisou: false };

/** Coluna nova que o banco ainda nao tem (SQL antigo). PostgREST: PGRST204. */
export function colunaAusente(e) {
  const msg = String((e && (e.message || e.details)) || "");
  return (e && e.code === "PGRST204") || /Could not find the '.+' column|column .+ of relation .+ does not exist/i.test(msg);
}

/** Erro de "tabela nao existe" do PostgREST/Postgres. */
export function tabelaAusente(e) {
  const msg = String((e && (e.message || e.details)) || "");
  return (e && (e.code === "42P01" || e.code === "PGRST205")) || /relation .* does not exist|Could not find the table/i.test(msg);
}

function falhou(e, onde) {
  if (colunaAusente(e)) {
    estado.esquemaAntigo = true;
    if (!estado.avisou) { estado.avisou = true; console.warn(`[radar] ${DICA_ESQUEMA}`); }
    return;
  }
  if (tabelaAusente(e)) {
    estado.ausente = true;
    if (!estado.avisou) { estado.avisou = true; console.warn(`[radar] tabelas do radar vivo nao existem. ${DICA}`); }
    return;
  }
  console.warn(`[radar] ${onde}: ${e && e.message}`);
}

export const radarBancoOk = () => !estado.ausente && !estado.esquemaAntigo;
export const dicaDoBanco = () => (estado.ausente ? DICA : estado.esquemaAntigo ? DICA_ESQUEMA : "");
export const motivoDoBanco = () => (estado.ausente ? "ausente" : estado.esquemaAntigo ? "esquema" : "");

/* Memoria de reserva (so enquanto o processo vive). */
const mem = { pulso: new Map(), descobertas: new Map(), coletas: [] };

/* ---------------------------------------------------------------- pulso */

export async function gravarPulso(linhas) {
  if (!linhas.length) return;
  for (const l of linhas) mem.pulso.set(`${l.item_id}|${l.dia}`, l);
  if (estado.ausente) return;
  const { error } = await sb.from("radar_pulso").upsert(linhas, { onConflict: "item_id,dia" });
  if (error) falhou(error, "gravarPulso");
}

/** Linhas dos ultimos `dias` dias agrupadas por item. */
export async function pulsosRecentes(dias = 30) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
  let linhas = null;
  if (!estado.ausente) {
    const { data, error } = await sb.from("radar_pulso").select("*").gte("dia", desde).limit(5000);
    if (error) falhou(error, "pulsosRecentes"); else linhas = data || [];
  }
  if (!linhas) linhas = [...mem.pulso.values()].filter((l) => l.dia >= desde);
  const porItem = new Map();
  for (const l of linhas) { if (!porItem.has(l.item_id)) porItem.set(l.item_id, []); porItem.get(l.item_id).push(l); }
  return porItem;
}

/* ---------------------------------------------------------- descobertas */

export async function chavesConhecidas() {
  const chaves = new Set([...mem.descobertas.keys()]);
  if (!estado.ausente) {
    const { data, error } = await sb.from("radar_descobertas").select("chave").limit(2000);
    if (error) falhou(error, "chavesConhecidas"); else (data || []).forEach((r) => chaves.add(r.chave));
  }
  return chaves;
}

export async function gravarDescobertas(lista) {
  if (!lista.length) return 0;
  const agora = new Date().toISOString();
  const linhas = lista.map((d) => ({ ...d, status: "nova", criado_em: agora, atualizado_em: agora }));
  for (const l of linhas) mem.descobertas.set(l.chave, { id: "mem-" + l.chave, ...l });
  if (estado.ausente) return linhas.length;
  // ignoreDuplicates: assunto que voce ja salvou/descartou nao volta como "nova"
  const { error } = await sb.from("radar_descobertas").upsert(linhas, { onConflict: "chave", ignoreDuplicates: true });
  if (error) falhou(error, "gravarDescobertas");
  return linhas.length;
}

export async function listarDescobertas({ status = null, limite = 30 } = {}) {
  if (!estado.ausente) {
    let q = sb.from("radar_descobertas").select("*").order("criado_em", { ascending: false }).limit(limite);
    if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
    const { data, error } = await q;
    if (!error) {
      if (data && data[0] && !("origem" in data[0])) estado.esquemaAntigo = true; // SQL antigo: faltam colunas
      return data || [];
    }
    falhou(error, "listarDescobertas");
  }
  const todas = [...mem.descobertas.values()].sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  return todas.filter((d) => !status || (Array.isArray(status) ? status.includes(d.status) : d.status === status)).slice(0, limite);
}

export async function atualizarDescoberta(id, campos) {
  const patch = { ...campos, atualizado_em: new Date().toISOString() };
  for (const [k, v] of mem.descobertas) if (v.id === id) mem.descobertas.set(k, { ...v, ...patch });
  if (estado.ausente) return;
  const { error } = await sb.from("radar_descobertas").update(patch).eq("id", id);
  if (error) { falhou(error, "atualizarDescoberta"); if (colunaAusente(error)) throw new Error(DICA_ESQUEMA); }
}

export async function buscarDescoberta(id) {
  for (const v of mem.descobertas.values()) if (v.id === id) return v;
  if (estado.ausente) return null;
  const { data, error } = await sb.from("radar_descobertas").select("*").eq("id", id).maybeSingle();
  if (error) { falhou(error, "buscarDescoberta"); return null; }
  return data;
}

/* ---------------------------------------------------------------- alvos */

/**
 * Grava um alvo que NAO veio da descoberta automatica (pesquisa sua ou CSV).
 * Se o assunto ja existe (mesma chave), atualiza em vez de duplicar. Devolve a linha.
 */
export async function gravarAlvo(linha) {
  const agora = new Date().toISOString();
  const nova = { ...linha, atualizado_em: agora };
  const existente = mem.descobertas.get(nova.chave);
  const base = { id: existente ? existente.id : "mem-" + nova.chave, criado_em: existente ? existente.criado_em : agora, ...existente, ...nova };
  mem.descobertas.set(nova.chave, base);
  if (estado.ausente) return base;
  const { data, error } = await sb.from("radar_descobertas")
    .upsert({ ...nova, criado_em: undefined }, { onConflict: "chave" }).select().maybeSingle();
  if (error) { falhou(error, "gravarAlvo"); if (colunaAusente(error)) throw new Error(DICA_ESQUEMA); return base; }
  if (data) mem.descobertas.set(nova.chave, data);
  return data || base;
}

/* --------------------------------------------------------------- coletas */

export async function registrarColeta({ iniciadoEm, duracaoMs, itens, novas, erros }) {
  const linha = { iniciado_em: new Date(iniciadoEm).toISOString(), duracao_ms: duracaoMs, itens, novas, erros };
  mem.coletas.unshift(linha); mem.coletas.length = Math.min(mem.coletas.length, 20);
  if (estado.ausente) return;
  const { error } = await sb.from("radar_coletas").insert(linha);
  if (error) falhou(error, "registrarColeta");
  // faxina: pulso com mais de 120 dias nao serve pra nada
  const corte = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  await sb.from("radar_pulso").delete().lt("dia", corte).then(() => {}, () => {});
}

/** Data da ultima coleta (ms) ou 0. */
export async function ultimaColeta() {
  if (!estado.ausente) {
    const { data, error } = await sb.from("radar_coletas").select("iniciado_em").order("iniciado_em", { ascending: false }).limit(1);
    if (!error && data && data[0]) return Date.parse(data[0].iniciado_em);
    if (error) falhou(error, "ultimaColeta");
  }
  return mem.coletas[0] ? Date.parse(mem.coletas[0].iniciado_em) : 0;
}

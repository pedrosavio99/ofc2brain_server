/**
 * Banco do modulo REFEICAO: Supabase (Postgres).
 *
 * MESMA interface do banco em cache que ficou pra tras: rotas, tela e IA nao
 * mudaram uma linha. Cliente proprio do modulo, padrao do treino: o core nao
 * exporta o `sb` e nao e mexido.
 *
 * As tabelas comecam com refeicao_ e nao tem vetor. Ciclo de 14 dias e a
 * unidade de tudo, como no treino: a refeicao vive JANELA_DIAS e depois vira
 * uma linha de resumo em refeicao_ciclos (fecharCiclosVencidos).
 *
 * No banco ficam so as colunas; rotulo, ordem e totais sao remontados na
 * leitura a partir de TIPOS e das colunas desnormalizadas. Assim a tabela nao
 * guarda texto derivado que poderia divergir do codigo.
 */
import { createClient } from "@supabase/supabase-js";
import { TIPOS } from "./nutricao.mjs";

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

/** O ciclo. Mudar aqui muda a janela das rotas e a poda. */
export const JANELA_DIAS = 14;

export class ErroHttp extends Error {
  constructor(status, mensagem, dica = "") {
    super(mensagem);
    this.status = status;
    this.dica = dica;
  }
}

/* ------------------------------------------------------------ tempo */

const FUSO_MIN = Number(process.env.FUSO_MINUTOS ?? -180); // America/Sao_Paulo

/** Data local YYYY-MM-DD. Sem fuso, 21h ja seria amanha. */
export function hojeLocal(agora = new Date()) {
  return new Date(agora.getTime() + FUSO_MIN * 60000).toISOString().slice(0, 10);
}

/** Hora local 0-23, pra IA chutar o tipo quando o texto nao diz. */
export function horaLocal(agora = new Date()) {
  return new Date(agora.getTime() + FUSO_MIN * 60000).getUTCHours();
}

/** Uma data N dias atras, no mesmo fuso. Puro. */
export function diasAtras(n, agora = new Date()) {
  return hojeLocal(new Date(agora.getTime() - n * 86400000));
}

export function dataValida(d) {
  const s = String(d || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = new Date(s + "T00:00:00Z");
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== s ? null : s;
}

/* ------------------------------------------------------------ saude */

const TETO_HEALTH = Number(process.env.TETO_HEALTH_MS) || 6000;

/**
 * Toca a tabela de verdade e diz POR QUE nao foi, quando nao vai. Nunca lanca.
 * A tela le `avisos`, entao o motivo vai la dentro tambem.
 */
export async function checarBanco() {
  if (!URL || !KEY) {
    return pronto(false, "sem_config", "SUPABASE_URL ou a chave secreta nao estao no ambiente.");
  }
  try {
    const consulta = sb.from("refeicao_refeicoes").select("id", { count: "exact", head: true });
    const { count, error } = await Promise.race([
      consulta,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${TETO_HEALTH / 1000}s`)), TETO_HEALTH)),
    ]);
    if (!error) return { ...pronto(true, "ok", ""), refeicoes: count ?? 0 };
    const msg = [error.message, error.details, error.hint, error.code]
      .filter(Boolean).map(String).join(" | ") || "o banco recusou a consulta sem dizer o motivo";
    if (error.code === "42P01" || /does not exist|schema cache/i.test(msg)) {
      return pronto(false, "sem_tabelas", "As tabelas do modulo nao existem. Rode supabase/refeicao.sql no seu projeto.");
    }
    if (/JWT|api key|Invalid|401|403/i.test(msg)) {
      return pronto(false, "sem_permissao", "O Supabase recusou a chave. Confira SUPABASE_SECRET_KEY.");
    }
    return pronto(false, "erro", msg);
  } catch (e) {
    return pronto(false, "inacessivel", String(e && e.message ? e.message : e));
  }
}

function pronto(ok, estado, detalhe) {
  return { ok, tipo: "supabase", estado, detalhe, avisos: detalhe ? [detalhe] : [] };
}

/* ---------------------------------------------------- linha <-> refeicao */

/** O que montarRefeicao devolve -> as colunas da tabela. Puro. */
function paraLinha(r) {
  const t = r.totais || {};
  return {
    tipo: r.tipo,
    tamanho: r.tamanho || "media",
    texto: r.texto || "",
    itens: r.itens || [],
    kcal: Math.round(Number(t.kcal) || 0),
    proteina: Number(t.proteina) || 0,
    carbo: Number(t.carbo) || 0,
    gordura: Number(t.gordura) || 0,
  };
}

/** Colunas -> o formato que rotas e tela sempre receberam. Puro. */
function paraRefeicao(l) {
  const t = TIPOS[l.tipo] || { rotulo: l.tipo, ordem: 7 };
  return {
    id: l.id,
    data: l.data,
    tipo: l.tipo,
    rotulo: t.rotulo,
    ordem: t.ordem,
    tamanho: l.tamanho,
    texto: l.texto,
    itens: l.itens || [],
    totais: {
      kcal: Number(l.kcal) || 0,
      proteina: Number(l.proteina) || 0,
      carbo: Number(l.carbo) || 0,
      gordura: Number(l.gordura) || 0,
    },
    criada_em: l.criada_em,
    atualizada_em: l.atualizada_em,
  };
}

/* ------------------------------------------------------------ operacoes */

export async function salvarRefeicoes(data, lista) {
  const linhas = lista.map((r) => ({ ...paraLinha(r), data }));
  const { data: salvas, error } = await sb.from("refeicao_refeicoes")
    .insert(linhas).select("*");
  if (error) throw new ErroHttp(500, `salvarRefeicoes: ${error.message}`);
  return (salvas || []).map(paraRefeicao);
}

export async function listarDoDia(data) {
  const { data: linhas, error } = await sb.from("refeicao_refeicoes")
    .select("*").eq("data", data).order("criada_em", { ascending: true });
  if (error) throw new ErroHttp(500, `listarDoDia: ${error.message}`);
  // a ordem do dia (cafe antes do almoco) vem de TIPOS, que nao esta no banco
  return (linhas || []).map(paraRefeicao)
    .sort((a, b) => a.ordem - b.ordem || String(a.criada_em).localeCompare(String(b.criada_em)));
}

export async function listarPeriodo(de, ate) {
  const { data: linhas, error } = await sb.from("refeicao_refeicoes")
    .select("*").gte("data", de).lte("data", ate);
  if (error) throw new ErroHttp(500, `listarPeriodo: ${error.message}`);
  return (linhas || []).map(paraRefeicao);
}

export async function buscarRefeicao(id) {
  const { data: linha, error } = await sb.from("refeicao_refeicoes")
    .select("*").eq("id", String(id)).maybeSingle();
  if (error) throw new ErroHttp(500, `buscarRefeicao: ${error.message}`);
  return linha ? paraRefeicao(linha) : null;
}

export async function atualizarRefeicao(id, campos) {
  const linha = { ...paraLinha(campos), atualizada_em: new Date().toISOString() };
  const { data: salva, error } = await sb.from("refeicao_refeicoes")
    .update(linha).eq("id", String(id)).select("*").maybeSingle();
  if (error) throw new ErroHttp(500, `atualizarRefeicao: ${error.message}`);
  return salva ? paraRefeicao(salva) : null;
}

export async function removerRefeicao(id) {
  const { data: apagadas, error } = await sb.from("refeicao_refeicoes")
    .delete().eq("id", String(id)).select("id");
  if (error) throw new ErroHttp(500, `removerRefeicao: ${error.message}`);
  return Boolean(apagadas && apagadas.length);
}

/* --------------------------------------------------------------- ciclos */

export async function listarCiclos(limite = 26) {
  const { data, error } = await sb.from("refeicao_ciclos")
    .select("*").order("inicio", { ascending: false }).limit(limite);
  if (error) throw new ErroHttp(500, `listarCiclos: ${error.message}`);
  return data || [];
}

/** As que ja sairam da janela e portanto viram resumo. Linhas cruas. */
export async function refeicoesVencidas(agora = new Date()) {
  const { data, error } = await sb.from("refeicao_refeicoes")
    .select("*").lt("data", diasAtras(JANELA_DIAS - 1, agora));
  if (error) throw new ErroHttp(500, `refeicoesVencidas: ${error.message}`);
  return data || [];
}

/**
 * Fecha os ciclos vencidos: grava o resumo e PODA as refeicoes.
 *
 * Mesma disciplina do treino. Ordem importa: grava primeiro, apaga depois; se
 * apagasse antes e a gravacao falhasse, o periodo sumia sem rastro.
 * Idempotente: o indice unico em inicio faz o ignoreDuplicates engolir um
 * ciclo ja gravado, entao rodar duas vezes nao duplica nada.
 *
 * @param {Function} agrupar (refeicoesVencidas, JANELA_DIAS) => ciclos
 * @returns {Promise<{ciclos:number, refeicoes:number}>}
 */
export async function fecharCiclosVencidos(agrupar, agora = new Date()) {
  const vencidas = await refeicoesVencidas(agora);
  if (!vencidas.length) return { ciclos: 0, refeicoes: 0 };

  const ciclos = agrupar(vencidas, JANELA_DIAS);
  if (!ciclos.length) return { ciclos: 0, refeicoes: 0 };

  const { error: erroCiclo } = await sb.from("refeicao_ciclos")
    .upsert(ciclos, { onConflict: "inicio", ignoreDuplicates: true });
  if (erroCiclo) throw new ErroHttp(500, `fecharCiclos: ${erroCiclo.message}`);

  const corte = diasAtras(JANELA_DIAS - 1, agora);
  const { error: erroPoda } = await sb.from("refeicao_refeicoes").delete().lt("data", corte);
  if (erroPoda) throw new ErroHttp(500, `podar: ${erroPoda.message}`);

  return { ciclos: ciclos.length, refeicoes: vencidas.length };
}

/**
 * Acesso ao banco do modulo TREINO.
 *
 * Cliente proprio, mesmo padrao do modulo conversa: o db.supabase.js do core
 * nao exporta o `sb`, e expor so pra atender plugue seria mexer no core.
 * As tabelas daqui comecam com treino_ e nao tem vetor nenhum. Este modulo
 * NAO le a tabela `ideias`: ele e independente de verdade.
 *
 * Ciclo de 14 dias e a unidade de tudo. JANELA fica num lugar so pra nao
 * existirem dois lugares discordando sobre o que e "as ultimas duas semanas".
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

/** O ciclo. Mudar aqui muda a janela da IA, o lembrete de peso e a poda. */
export const JANELA_DIAS = 14;

export class ErroHttp extends Error {
  constructor(status, mensagem, dica = "") {
    super(mensagem);
    this.status = status;
    this.dica = dica;
  }
}

const TETO_HEALTH = Number(process.env.TETO_HEALTH_MS) || 6000;

/**
 * Toca o banco e diz POR QUE nao foi, quando nao vai. Mesma licao do modulo
 * conversa: health que responde ok sem encostar no banco manda a tela culpar
 * o lugar errado. Nunca lanca.
 */
export async function checarBanco() {
  if (!URL || !KEY) {
    return { ok: false, estado: "sem_config", detalhe: "SUPABASE_URL ou a chave secreta nao estao no ambiente." };
  }
  try {
    const consulta = sb.from("treino_perfil").select("id", { count: "exact", head: true });
    const { error } = await Promise.race([
      consulta,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${TETO_HEALTH / 1000}s`)), TETO_HEALTH)),
    ]);
    if (!error) return { ok: true, estado: "ok", detalhe: "" };
    const msg = [error.message, error.details, error.hint, error.code]
      .filter(Boolean).map(String).join(" | ") || "o banco recusou a consulta sem dizer o motivo";
    if (error.code === "42P01" || /does not exist|schema cache/i.test(msg)) {
      return { ok: false, estado: "sem_tabelas", detalhe: "As tabelas do modulo nao existem. Rode supabase/treino.sql no seu projeto." };
    }
    if (/JWT|api key|Invalid|401|403/i.test(msg)) {
      return { ok: false, estado: "sem_permissao", detalhe: "O Supabase recusou a chave. Confira SUPABASE_SECRET_KEY." };
    }
    return { ok: false, estado: "erro", detalhe: msg };
  } catch (e) {
    return { ok: false, estado: "inacessivel", detalhe: String(e && e.message ? e.message : e) };
  }
}

/* ---------------------------------------------------------------- perfil */

/** Sempre devolve um perfil, mesmo que vazio: a tela nunca lida com null. */
export async function lerPerfil() {
  const { data, error } = await sb.from("treino_perfil").select("*").eq("id", "unico").maybeSingle();
  if (error) throw new ErroHttp(500, `lerPerfil: ${error.message}`);
  return data || { id: "unico", nascimento: null, altura_cm: null, sexo: null,
    peso_kg: null, peso_em: null, restricoes: "", nivel: "iniciante" };
}

/**
 * Grava o perfil. Se o peso mudou, registra a pesagem E reinicia o relogio dos
 * 14 dias. As duas coisas juntas de proposito: peso gravado sem atualizar
 * peso_em faria o lembrete pedir de novo no dia seguinte.
 */
export async function salvarPerfil(campos) {
  const atual = await lerPerfil();
  const novoPeso = campos.peso_kg != null && Number(campos.peso_kg) > 0
    && Number(campos.peso_kg) !== Number(atual.peso_kg);

  const linha = {
    id: "unico",
    nascimento: campos.nascimento ?? atual.nascimento,
    altura_cm: campos.altura_cm != null ? Number(campos.altura_cm) : atual.altura_cm,
    sexo: campos.sexo ?? atual.sexo,
    peso_kg: campos.peso_kg != null ? Number(campos.peso_kg) : atual.peso_kg,
    peso_em: novoPeso ? new Date().toISOString() : atual.peso_em,
    restricoes: campos.restricoes ?? atual.restricoes,
    nivel: campos.nivel ?? atual.nivel,
    atualizado_em: new Date().toISOString(),
  };

  const { data, error } = await sb.from("treino_perfil").upsert(linha, { onConflict: "id" }).select("*").single();
  if (error) throw new ErroHttp(500, `salvarPerfil: ${error.message}`);
  if (novoPeso) await registrarPesagem(linha.peso_kg);
  return data;
}

export async function registrarPesagem(peso) {
  const { error } = await sb.from("treino_pesagens").insert({ peso_kg: Number(peso) });
  if (error) throw new ErroHttp(500, `registrarPesagem: ${error.message}`);
}

export async function listarPesagens(limite = 30) {
  const { data, error } = await sb.from("treino_pesagens")
    .select("peso_kg, criado_em").order("criado_em", { ascending: false }).limit(limite);
  if (error) throw new ErroHttp(500, `listarPesagens: ${error.message}`);
  return (data || []).reverse();
}

/**
 * Faltam quantos dias pro proximo pedido de peso.
 * Negativo ou zero = esta na hora. null = nunca pesou.
 * Puro o bastante pra testar: recebe o perfil e a hora.
 */
export function diasAtePesagem(perfil, agora = new Date()) {
  if (!perfil || !perfil.peso_em) return null;
  const passados = Math.floor((agora.getTime() - new Date(perfil.peso_em).getTime()) / 86400000);
  return JANELA_DIAS - passados;
}

/* -------------------------------------------------------------- sessoes */

const FUSO_MIN = Number(process.env.FUSO_MINUTOS ?? -180); // America/Sao_Paulo

/**
 * A data de HOJE no fuso local, em YYYY-MM-DD.
 *
 * A coluna `data` tem default current_date, que no servidor e UTC. Treino as
 * 21h no Brasil cairia no dia seguinte, e ai "treinei hoje" e o "ontem" da
 * ficha sairiam errados. Por isso a data vai sempre explicita.
 */
export function hojeLocal(agora = new Date()) {
  return new Date(agora.getTime() + FUSO_MIN * 60000).toISOString().slice(0, 10);
}

/** Uma data N dias atras, no mesmo fuso. Puro. */
export function diasAtras(n, agora = new Date()) {
  return hojeLocal(new Date(agora.getTime() - n * 86400000));
}

/** As sessoes da janela. Mais novas primeiro. */
export async function listarSessoes(dias = JANELA_DIAS, agora = new Date()) {
  const { data, error } = await sb.from("treino_sessoes")
    .select("*")
    .gte("data", diasAtras(dias - 1, agora))
    .order("data", { ascending: false })
    .order("criado_em", { ascending: false });
  if (error) throw new ErroHttp(500, `listarSessoes: ${error.message}`);
  return data || [];
}

export async function buscarSessao(id) {
  const { data, error } = await sb.from("treino_sessoes").select("*").eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(500, `buscarSessao: ${error.message}`);
  return data;
}

/**
 * Tudo que aconteceu hoje, mais novo primeiro, ja sem as fichas regeradas.
 * Ficha e atividade avulsa convivem no mesmo dia.
 */
export async function sessoesDeHoje(agora = new Date()) {
  const { data, error } = await sb.from("treino_sessoes")
    .select("*").eq("data", hojeLocal(agora))
    .order("criado_em", { ascending: false }).limit(20);
  if (error) throw new ErroHttp(500, `sessoesDeHoje: ${error.message}`);
  const lista = data || [];
  const regeradas = new Set(lista.map((s) => s.regerada_de).filter(Boolean));
  return lista.filter((s) => !regeradas.has(s.id));
}

/**
 * A FICHA de hoje, que e o que a tela de treino governa.
 *
 * Filtra por origem 'ficha' de proposito. Antes isto devolvia simplesmente a
 * sessao mais recente do dia, e ai duas coisas quebravam quando voce lancava
 * uma atividade avulsa: a tela passava a mostrar so a avulsa, escondendo a
 * ficha, e gerar a ficha do dia devolvia 409 dizendo que o treino ja tinha
 * acabado, porque a avulsa nasce concluida.
 */
export async function sessaoDeHoje(agora = new Date()) {
  const lista = await sessoesDeHoje(agora);
  return lista.find((s) => s.origem === "ficha") || null;
}

export async function criarSessao(campos, agora = new Date()) {
  const linha = {
    data: hojeLocal(agora),
    ficha: campos.ficha || [],
    motivo: campos.motivo || "",
    origem: campos.origem || "ficha",
    regerada_de: campos.regerada_de || null,
  };
  const { data, error } = await sb.from("treino_sessoes").insert(linha).select("*").single();
  if (error) throw new ErroHttp(500, `criarSessao: ${error.message}`);
  return data;
}

export async function atualizarSessao(id, campos) {
  const { data, error } = await sb.from("treino_sessoes")
    .update(campos).eq("id", id).select("*").maybeSingle();
  if (error) throw new ErroHttp(500, `atualizarSessao: ${error.message}`);
  return data;
}

/* --------------------------------------------------------------- ciclos */

export async function listarCiclos(limite = 26) {
  const { data, error } = await sb.from("treino_ciclos")
    .select("*").order("inicio", { ascending: false }).limit(limite);
  if (error) throw new ErroHttp(500, `listarCiclos: ${error.message}`);
  return data || [];
}

/** As que ja sairam da janela e portanto viram resumo. */
export async function sessoesVencidas(agora = new Date()) {
  const { data, error } = await sb.from("treino_sessoes")
    .select("*").lt("data", diasAtras(JANELA_DIAS - 1, agora));
  if (error) throw new ErroHttp(500, `sessoesVencidas: ${error.message}`);
  return data || [];
}

/**
 * Fecha os ciclos vencidos: grava o resumo e PODA as sessoes.
 *
 * Ordem importa: grava primeiro, apaga depois. Se apagasse antes e a gravacao
 * falhasse, o periodo sumia sem deixar rastro, e isso e irreversivel.
 *
 * Idempotente: o indice unico em inicio faz o ignoreDuplicates engolir um
 * ciclo ja gravado, entao rodar duas vezes nao duplica nem estraga nada.
 *
 * @returns {Promise<{ciclos:number, sessoes:number}>}
 */
export async function fecharCiclosVencidos(agrupar, agora = new Date()) {
  const vencidas = await sessoesVencidas(agora);
  if (!vencidas.length) return { ciclos: 0, sessoes: 0 };

  const ciclos = agrupar(vencidas, JANELA_DIAS);
  if (!ciclos.length) return { ciclos: 0, sessoes: 0 };

  const perfil = await lerPerfil();
  const linhas = ciclos.map((c) => ({
    inicio: c.inicio, fim: c.fim,
    treinos: c.treinos, minutos: c.minutos, calorias: c.calorias,
    esforco_medio: c.esforco_medio,
    // o peso do fechamento: sem ele, a linha do tempo de peso perde referencia
    peso_kg: perfil.peso_kg,
  }));

  const { error: erroCiclo } = await sb.from("treino_ciclos")
    .upsert(linhas, { onConflict: "inicio", ignoreDuplicates: true });
  if (erroCiclo) throw new ErroHttp(500, `fecharCiclos: ${erroCiclo.message}`);

  const corte = diasAtras(JANELA_DIAS - 1, agora);
  const { error: erroPoda } = await sb.from("treino_sessoes").delete().lt("data", corte);
  if (erroPoda) throw new ErroHttp(500, `podar: ${erroPoda.message}`);

  return { ciclos: linhas.length, sessoes: vencidas.length };
}

/* --------------------------------------------------------- equipamentos */

/** Por padrao so os ativos: inativo existe pra explicar treino antigo. */
export async function listarEquipamentos({ incluirInativos = false } = {}) {
  let q = sb.from("treino_equipamentos").select("*").order("nome", { ascending: true });
  if (!incluirInativos) q = q.eq("ativo", 1);
  const { data, error } = await q;
  if (error) throw new ErroHttp(500, `listarEquipamentos: ${error.message}`);
  return data || [];
}

export async function buscarEquipamento(id) {
  const { data, error } = await sb.from("treino_equipamentos").select("*").eq("id", id).maybeSingle();
  if (error) throw new ErroHttp(500, `buscarEquipamento: ${error.message}`);
  return data;
}

/** Cria quando nao vem id, atualiza quando vem. */
export async function salvarEquipamento(campos) {
  const linha = {
    nome: campos.nome,
    tipo: campos.tipo,
    resumo: campos.resumo || "",
    como_usar: campos.como_usar || "",
    grupos: Array.isArray(campos.grupos) ? campos.grupos : [],
    met: campos.met,
    gerado_por_ia: campos.gerado_por_ia ? 1 : 0,
    atualizado_em: new Date().toISOString(),
  };
  if (campos.id) linha.id = campos.id;

  const { data, error } = await sb.from("treino_equipamentos")
    .upsert(linha, { onConflict: "id" }).select("*").single();
  if (error) throw new ErroHttp(500, `salvarEquipamento: ${error.message}`);
  return data;
}

/**
 * Exclusao LOGICA por padrao.
 *
 * A ficha guarda equipamento_id dentro do JSON e nao ha chave estrangeira.
 * Apagar de verdade deixaria os treinos das ultimas duas semanas apontando pro
 * nada. Inativo some das listas e continua explicando o passado.
 */
export async function desativarEquipamento(id, apagarDeVez = false) {
  if (apagarDeVez) {
    const { error } = await sb.from("treino_equipamentos").delete().eq("id", id);
    if (error) throw new ErroHttp(500, `desativarEquipamento: ${error.message}`);
    return { apagado: true };
  }
  const { data, error } = await sb.from("treino_equipamentos")
    .update({ ativo: 0, atualizado_em: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw new ErroHttp(500, `desativarEquipamento: ${error.message}`);
  return { apagado: false, equipamento: data };
}

export async function reativarEquipamento(id) {
  const { data, error } = await sb.from("treino_equipamentos")
    .update({ ativo: 1, atualizado_em: new Date().toISOString() }).eq("id", id).select("*").maybeSingle();
  if (error) throw new ErroHttp(500, `reativarEquipamento: ${error.message}`);
  return data;
}

/** O perfil esta completo o bastante pra calcular caloria? Puro. */
export function perfilPronto(p) {
  return !!(p && Number(p.peso_kg) > 0);
}

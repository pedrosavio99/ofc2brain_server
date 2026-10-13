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
  const informouPeso = campos.peso_kg != null && Number(campos.peso_kg) > 0;
  const pesoMudou = informouPeso && Number(campos.peso_kg) !== Number(atual.peso_kg);
  const deveRegistrarPesagem = informouPeso && (campos.forcar_pesagem || pesoMudou || !atual.peso_em);

  const linha = {
    id: "unico",
    nascimento: campos.nascimento ?? atual.nascimento,
    altura_cm: campos.altura_cm != null ? Number(campos.altura_cm) : atual.altura_cm,
    sexo: campos.sexo ?? atual.sexo,
    peso_kg: informouPeso ? Number(campos.peso_kg) : atual.peso_kg,
    peso_em: deveRegistrarPesagem ? new Date().toISOString() : atual.peso_em,
    restricoes: campos.restricoes ?? atual.restricoes,
    nivel: campos.nivel ?? atual.nivel,
    atualizado_em: new Date().toISOString(),
  };

  const { data, error } = await sb.from("treino_perfil").upsert(linha, { onConflict: "id" }).select("*").single();
  if (error) throw new ErroHttp(500, `salvarPerfil: ${error.message}`);
  if (deveRegistrarPesagem) await registrarPesagem(linha.peso_kg);
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

/** Soma N dias a uma data YYYY-MM-DD em UTC puro, evitando bugs de fuso ou horario de verao. */
export function adicionarDias(dataISO, n) {
  const d = new Date(dataISO + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Diferenca em dias inteiros entre duas datas YYYY-MM-DD. */
export function diferencaDias(dataInicioISO, dataFimISO) {
  const d1 = new Date(dataInicioISO + "T12:00:00Z").getTime();
  const d2 = new Date(dataFimISO + "T12:00:00Z").getTime();
  return Math.round((d2 - d1) / 86400000);
}

/**
 * Data de ancoragem inicial dos ciclos de 14 dias.
 * Todos os ciclos sao janelas contiguas de 14 dias a partir daqui:
 * Ciclo 0: [ancora, ancora + 13d]
 * Ciclo 1: [ancora + 14d, ancora + 27d]
 * etc.
 */
export async function obterDataAncora(agora = new Date()) {
  const { data: primeiroCiclo } = await sb.from("treino_ciclos")
    .select("inicio").order("inicio", { ascending: true }).limit(1).maybeSingle();
  if (primeiroCiclo && primeiroCiclo.inicio) return primeiroCiclo.inicio;

  const { data: primeiraSessao } = await sb.from("treino_sessoes")
    .select("data").order("data", { ascending: true }).limit(1).maybeSingle();
  if (primeiraSessao && primeiraSessao.data) return primeiraSessao.data;

  const perfil = await lerPerfil();
  if (perfil && perfil.criado_em) {
    return new Date(perfil.criado_em).toISOString().slice(0, 10);
  }

  return hojeLocal(agora);
}

export async function listarCiclos(limite = 26) {
  const { data, error } = await sb.from("treino_ciclos")
    .select("*").order("inicio", { ascending: false }).limit(limite);
  if (error) throw new ErroHttp(500, `listarCiclos: ${error.message}`);
  return data || [];
}

/**
 * Panorama do ciclo ATUAL de 14 dias (em andamento).
 */
export async function obterCicloAtual(agora = new Date()) {
  const hoje = hojeLocal(agora);
  const ancora = await obterDataAncora(agora);
  const diff = diferencaDias(ancora, hoje);
  const k = Math.max(0, Math.floor(diff / JANELA_DIAS));
  const inicio = adicionarDias(ancora, k * JANELA_DIAS);
  const fim = adicionarDias(inicio, JANELA_DIAS - 1);
  const diaNoCiclo = Math.min(JANELA_DIAS, Math.max(1, diferencaDias(inicio, hoje) + 1));
  const diasRestantes = Math.max(0, JANELA_DIAS - diaNoCiclo);

  const { data: sessoes, error } = await sb.from("treino_sessoes")
    .select("*")
    .gte("data", inicio)
    .lte("data", fim);
  if (error) throw new ErroHttp(500, `obterCicloAtual: ${error.message}`);

  const concluidas = (sessoes || []).filter((s) => s.concluida);
  const esforcos = concluidas.map((s) => ({ leve: 1, moderado: 2, pesado: 3 }[String(s.esforco || "").toLowerCase()]))
    .filter(Boolean);

  return {
    numero: k + 1,
    inicio,
    fim,
    hoje,
    dia_atual: diaNoCiclo,
    dias_totais: JANELA_DIAS,
    dias_restantes: diasRestantes,
    treinos: concluidas.length,
    minutos: concluidas.reduce((t, s) => t + (Number(s.duracao_min) || 0), 0),
    calorias: concluidas.reduce((t, s) => t + (Number(s.calorias) || 0), 0),
    esforco_medio: esforcos.length
      ? Math.round((esforcos.reduce((a, b) => a + b, 0) / esforcos.length) * 100) / 100
      : null,
  };
}

/**
 * Analisa os intervalos de 14 em 14 dias e finaliza automaticamente os ciclos cujo
 * periodo ja expirou (fim < hoje).
 * Consolida o resumo em treino_ciclos e poda as sessoes antigas finalizadas.
 */
export async function fecharCiclosVencidos(arg1, arg2) {
  const agora = arg1 instanceof Date ? arg1 : arg2 instanceof Date ? arg2 : new Date();
  const hoje = hojeLocal(agora);
  const ancora = await obterDataAncora(agora);
  const diff = diferencaDias(ancora, hoje);
  const kAtual = Math.max(0, Math.floor(diff / JANELA_DIAS));

  let ciclosFechados = 0;
  let sessoesPodadas = 0;

  // Itera por todos os ciclos passados de 14 dias que ja terminaram (i = 0 ate kAtual - 1)
  for (let i = 0; i < kAtual; i++) {
    const inicio = adicionarDias(ancora, i * JANELA_DIAS);
    const fim = adicionarDias(inicio, JANELA_DIAS - 1);

    if (fim < hoje) {
      const { data: cicloExistente } = await sb.from("treino_ciclos")
        .select("*").eq("inicio", inicio).maybeSingle();

      const { data: sessoesPeriodo } = await sb.from("treino_sessoes")
        .select("*").gte("data", inicio).lte("data", fim);

      const temSessoes = sessoesPeriodo && sessoesPeriodo.length > 0;

      if (!cicloExistente || temSessoes) {
        const concluidas = (sessoesPeriodo || []).filter((s) => s.concluida);
        const esforcos = concluidas.map((s) => ({ leve: 1, moderado: 2, pesado: 3 }[String(s.esforco || "").toLowerCase()]))
          .filter(Boolean);

        const treinosCalc = concluidas.length + (cicloExistente ? (cicloExistente.treinos || 0) : 0);
        const minutosCalc = concluidas.reduce((t, s) => t + (Number(s.duracao_min) || 0), 0) +
          (cicloExistente ? (cicloExistente.minutos || 0) : 0);
        const caloriasCalc = concluidas.reduce((t, s) => t + (Number(s.calorias) || 0), 0) +
          (cicloExistente ? (cicloExistente.calorias || 0) : 0);

        let esforcoMedio = null;
        if (esforcos.length) {
          esforcoMedio = Math.round((esforcos.reduce((a, b) => a + b, 0) / esforcos.length) * 100) / 100;
        } else if (cicloExistente && cicloExistente.esforco_medio) {
          esforcoMedio = cicloExistente.esforco_medio;
        }

        const perfil = await lerPerfil();
        const linha = {
          inicio,
          fim,
          treinos: treinosCalc,
          minutos: minutosCalc,
          calorias: caloriasCalc,
          esforco_medio: esforcoMedio,
          peso_kg: cicloExistente && cicloExistente.peso_kg ? cicloExistente.peso_kg : perfil.peso_kg,
        };

        const { error: errUpsert } = await sb.from("treino_ciclos")
          .upsert(linha, { onConflict: "inicio" });
        if (errUpsert) throw new ErroHttp(500, `fecharCiclosVencidos: ${errUpsert.message}`);

        ciclosFechados++;
      }

      if (temSessoes) {
        const { error: errPoda } = await sb.from("treino_sessoes")
          .delete().gte("data", inicio).lte("data", fim);
        if (!errPoda) sessoesPodadas += sessoesPeriodo.length;
      }
    }
  }

  // Limpa ciclos sobrepostos ou desalinhados da grade de 14 dias
  const { data: todosCiclos } = await sb.from("treino_ciclos").select("id, inicio");
  if (todosCiclos && todosCiclos.length) {
    const invalidos = todosCiclos.filter((c) => {
      const d = diferencaDias(ancora, c.inicio);
      return d < 0 || d % JANELA_DIAS !== 0;
    }).map((c) => c.id);
    if (invalidos.length) {
      await sb.from("treino_ciclos").delete().in("id", invalidos);
    }
  }

  return { ciclos: ciclosFechados, sessoes: sessoesPodadas };
}

/** Fechamento antecipado manual do ciclo atual se solicitado pelo usuario. */
export async function forcarFecharCicloAtual(agora = new Date()) {
  const hoje = hojeLocal(agora);
  const cicloAtual = await obterCicloAtual(agora);
  const perfil = await lerPerfil();

  const linha = {
    inicio: cicloAtual.inicio,
    fim: hoje,
    treinos: cicloAtual.treinos,
    minutos: cicloAtual.minutos,
    calorias: cicloAtual.calorias,
    esforco_medio: cicloAtual.esforco_medio,
    peso_kg: perfil.peso_kg,
  };

  const { error: errUpsert } = await sb.from("treino_ciclos")
    .upsert(linha, { onConflict: "inicio" });
  if (errUpsert) throw new ErroHttp(500, `forcarFecharCiclo: ${errUpsert.message}`);

  await sb.from("treino_sessoes").delete().gte("data", cicloAtual.inicio).lte("data", hoje);

  return { ok: true, ciclo_fechado: linha };
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

/**
 * As FERRAMENTAS do segundo cerebro: uma funcao por fonte de dado.
 *
 * Substitui o ecossistema.mjs, que despejava treino de HOJE, refeicao de HOJE
 * e o radar em TODO prompt, quisesse a pessoa ou nao. Tres problemas:
 *   - so enxergava hoje: "como estou indo na semana?" era impossivel;
 *   - entrava em toda mensagem, e contexto que nao serve a pergunta atrapalha
 *     (Liu et al. 2023, "Lost in the Middle");
 *   - a meta calorica nunca chegava: o codigo chamava calcularMeta(obj, perfil)
 *     e a funcao recebe { basal, treinoDia, objetivo }.
 *
 * Agora o planejador escolhe quais ferramentas valem pro turno e cada uma
 * recebe uma janela de tempo. A especificacao (nome, argumentos) mora em
 * ferramentas-spec.mjs e e a mesma que o endpoint MCP expoe.
 *
 * Contrato de cada ferramenta: (args, ctx) -> { texto, itens, vazio, meta?, ids? }
 *   ctx = { plano, texto, conversaId, agora, embed }
 * Nunca lanca pra fora: executarFerramenta captura e devolve o erro como dado.
 */
import * as db from "../../../src/db.js";
import * as bancoTreino from "../../treino/servidor/banco.mjs";
import * as bancoRefeicao from "../../refeicao/servidor/banco.mjs";
import * as metasRefeicao from "../../refeicao/servidor/metas.mjs";
import { metasDeHoje } from "../../metas/servidor/registro.mjs";
import * as clickup from "../../trabalho/servidor/clickup.mjs";
import { resumoDoRadar } from "../../trendradar/servidor/coleta.mjs";
import { gerarEmbeddings } from "../../../src/embeddings.js";
import * as banco from "./banco.mjs";
import { buscarNotas, montarTsQuery } from "./busca.mjs";
import { buscarMemorias } from "./memoria.mjs";
import { formatarNota, corta } from "./recuperacao.mjs";
import { ESPEC, NOMES_FERRAMENTAS, sanearArgs } from "./ferramentas-spec.mjs";

const TETO_FERRAMENTA_MS = Number(process.env.TETO_FERRAMENTA_MS) || 8000;
const MAX_NOTAS_PERIODO = 14;
const DIA_MS = 86400000;

const vazio = (texto) => ({ texto, itens: 0, vazio: true });

/* ---------------------------------------------------------- embeddings */

/**
 * Embeddings com cache DO TURNO. buscar_notas e buscar_memoria rodam em
 * paralelo e usam as mesmas consultas: sem isto seriam duas requisicoes ao
 * Gemini pro mesmo texto. A segunda ferramenta encontra a promessa da primeira.
 */
export function criarEmbed() {
  const cache = new Map();
  return (textos) => {
    const lista = textos.map((t) => String(t || "").trim());
    const faltam = [...new Set(lista.filter((t) => t && !cache.has(t)))];
    if (faltam.length) {
      const lote = gerarEmbeddings(faltam);
      lote.catch(() => {}); // o erro e tratado por quem espera cada texto
      faltam.forEach((t, i) => {
        const p = lote.then((vs) => vs[i]);
        p.catch(() => {}); // sem isto, texto que ninguem aguarda vira unhandledRejection
        cache.set(t, p);
      });
    }
    return Promise.all(lista.map((t) => (t ? cache.get(t) : null)));
  };
}

/* ------------------------------------------------------------- helpers */

const dataCurta = (iso) => String(iso || "").slice(0, 10);

function janelaPorDias(dias, agora) {
  const n = Math.max(1, Number(dias) || 7);
  return {
    desde: new Date(agora.getTime() - n * DIA_MS).toISOString(),
    ate: new Date(agora.getTime() + 60000).toISOString(),
    rotulo: `últimos ${n} dias`,
  };
}

/* ----------------------------------------------------------- ferramentas */

async function buscar_notas(args, ctx) {
  const consultas = args.consultas && args.consultas.length ? args.consultas : (ctx.plano && ctx.plano.consultas) || [];
  const pergunta = (ctx.plano && ctx.plano.pergunta) || ctx.texto || consultas[0] || "";
  const r = await buscarNotas({ consultas, pergunta, embed: ctx.embed });
  const todas = [...r.fortes, ...r.fracas];
  if (!todas.length) return { ...vazio("Busquei nas notas guardadas e não achei nada sobre isso."), meta: { fortes: 0, total: r.total, areas: [] } };

  const partes = [];
  if (r.fortes.length) {
    partes.push(`Notas que falam disso (${r.fortes.length}):\n` +
      // as 5 melhores entram com o texto; o resto so com o resumo, pra caber
      r.fortes.map((n, i) => formatarNota(n, i, { agora: ctx.agora, max: i < 5 ? 700 : 0 })).join("\n"));
  }
  if (r.fracas.length) {
    partes.push(`Notas que só tangenciam (use com cuidado, só se ajudar) (${r.fracas.length}):\n` +
      r.fracas.map((n, i) => formatarNota(n, i, { agora: ctx.agora, max: 0 })).join("\n"));
  }
  return {
    texto: partes.join("\n\n"),
    itens: r.fortes.length,
    vazio: false,
    ids: todas.map((n) => n.id),
    meta: {
      fortes: r.fortes.length, total: r.total, rerank: r.rerank, hibrido: r.hibrido,
      areas: [...new Set(r.fortes.map((n) => n.area).filter(Boolean))],
      resumos: r.fortes.slice(0, 5).map((n) => ({ resumo: n.resumo, area: n.area, criado_em: dataCurta(n.criado_em) })),
    },
  };
}

async function notas_por_periodo(args, ctx) {
  const janela = (ctx.plano && ctx.plano.janela) || janelaPorDias(args.dias, ctx.agora);
  const doPeriodo = await db.listarPorPeriodo(janela.desde, janela.ate);
  doPeriodo.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  if (!doPeriodo.length) {
    return { ...vazio(`Não há nota guardada em ${janela.rotulo}. (Isso não quer dizer que a base esteja vazia: só que nada foi anotado nessa data.)`), meta: { fortes: 0, total: 0, areas: [] } };
  }
  const usadas = doPeriodo.slice(0, MAX_NOTAS_PERIODO);
  const aviso = doPeriodo.length > usadas.length ? `\n(São ${doPeriodo.length} no período; estas são as ${usadas.length} mais recentes. Diga que tem mais se a pessoa perguntar.)` : "";
  return {
    texto: `Notas de ${janela.rotulo} (${usadas.length}), TODAS deste período:\n` +
      usadas.map((n, i) => formatarNota(n, i, { agora: ctx.agora, max: 500 })).join("\n") + aviso,
    itens: usadas.length, vazio: false, ids: usadas.map((n) => n.id),
    meta: { fortes: usadas.length, total: doPeriodo.length, areas: [...new Set(usadas.map((n) => n.area).filter(Boolean))],
      resumos: usadas.slice(0, 5).map((n) => ({ resumo: n.resumo, area: n.area, criado_em: dataCurta(n.criado_em) })) },
  };
}

async function buscar_memoria(args, ctx) {
  const consultas = args.consultas && args.consultas.length ? args.consultas : (ctx.plano && ctx.plano.consultas && ctx.plano.consultas.length ? ctx.plano.consultas : [(ctx.plano && ctx.plano.pergunta) || ctx.texto]);
  const achadas = await buscarMemorias({ consultas, embed: ctx.embed });
  const novas = achadas.filter((m) => !(ctx.idsBase && ctx.idsBase.has(m.id)));
  if (!novas.length) return vazio("Nenhuma memória adicional ligada a este assunto.");
  return {
    texto: novas.map((m) => `- ${m.fato} (${m.categoria}, desde ${dataCurta(m.criado_em)})`).join("\n"),
    itens: novas.length, vazio: false, memorias: novas,
  };
}

async function buscar_conversas(args, ctx) {
  const q = montarTsQuery(args.termos && args.termos.length ? args.termos : [(ctx.plano && ctx.plano.pergunta) || ctx.texto]);
  if (!q) return vazio("Sem termos pra buscar em conversas antigas.");
  let linhas;
  try {
    linhas = await banco.chamarRpc("buscar_turnos_fts", { q_lex: q, excluir_conversa: ctx.conversaId || null, k: 8 });
  } catch (e) {
    if (e.faltaFuncao) return vazio("Busca em conversas antigas indisponível (falta rodar supabase/conversa-v2.sql).");
    throw e;
  }
  if (!linhas || !linhas.length) return vazio("Não achei conversa antiga com esses termos. (Conversas só ficam guardadas por 90 dias.)");
  return {
    texto: linhas.map((t) => `[${dataCurta(t.criado_em)} · ${t.papel === "pessoa" ? "a pessoa disse" : "eu respondi"}] ${corta(String(t.texto).replace(/\s+/g, " "), 280)}`).join("\n"),
    itens: linhas.length, vazio: false,
  };
}

async function ver_treinos(args, ctx) {
  const dias = args.dias || 14;
  const [sessoes, ciclo, ciclos, perfil] = await Promise.all([
    // sessoes velhas sao podadas aos 14 dias; alem disso so existe o resumo do ciclo
    bancoTreino.listarSessoes(Math.min(dias, 14), ctx.agora).catch(() => []),
    bancoTreino.obterCicloAtual(ctx.agora).catch(() => null),
    bancoTreino.listarCiclos(dias > 14 ? Math.ceil(dias / 14) + 1 : 2).catch(() => []),
    bancoTreino.lerPerfil().catch(() => null),
  ]);
  const linhas = [];
  const ordenadas = [...sessoes].sort((a, b) => String(a.data).localeCompare(String(b.data)));
  for (const s of ordenadas.slice(-20)) {
    const concluida = Boolean(s.concluida);
    const ficha = Array.isArray(s.ficha) ? s.ficha : [];
    const feitos = new Set(Array.isArray(s.feitos) ? s.feitos : []);
    const exercicios = ficha.map((e) => `${e.nome || e.exercicio}${feitos.has(e.id) ? " ✓" : ""}`).join(", ");
    const tipo = s.origem === "manual" ? "atividade avulsa" : s.origem === "extra" ? "ficha extra" : "ficha";
    const stats = [s.duracao_min ? `${s.duracao_min} min` : null, s.calorias ? `${s.calorias} kcal` : null, s.esforco ? `esforço ${s.esforco}` : null].filter(Boolean).join(", ");
    linhas.push(`- ${dataCurta(s.data)} · ${tipo} ${concluida ? "concluída" : "não concluída"}${stats ? ` · ${stats}` : ""}${exercicios ? ` · ${corta(exercicios, 220)}` : ""}${s.observacao ? ` · obs: "${corta(s.observacao, 120)}"` : ""}`);
  }
  const partes = [];
  const concluidas = sessoes.filter((s) => s.concluida);
  if (sessoes.length) {
    const kcal = concluidas.reduce((t, s) => t + (Number(s.calorias) || 0), 0);
    const min = concluidas.reduce((t, s) => t + (Number(s.duracao_min) || 0), 0);
    partes.push(`Treinos nos últimos ${Math.min(dias, 14)} dias: ${concluidas.length} concluído(s) de ${sessoes.length} sessão(ões), ${min} min, ${kcal} kcal.\n${linhas.join("\n")}`);
  }
  if (ciclo) {
    partes.push(`Ciclo atual (14 dias): ciclo ${ciclo.numero}, dia ${ciclo.dia_atual} de ${ciclo.dias_totais}, ${ciclo.dias_restantes === 0 ? "último dia" : `faltam ${ciclo.dias_restantes} dia(s)`}. ` +
      `Acumulou ${ciclo.treinos} treino(s), ${ciclo.minutos} min, ${ciclo.calorias} kcal${ciclo.esforco_medio ? `, esforço médio ${ciclo.esforco_medio}/3` : ""}.`);
  }
  if (ciclos.length) {
    partes.push("Ciclos anteriores:\n" + ciclos.slice(0, 4).map((c) =>
      `- ${dataCurta(c.inicio)} a ${dataCurta(c.fim)}: ${c.treinos} treino(s), ${c.minutos} min, ${c.calorias} kcal${c.peso_kg ? `, peso ${c.peso_kg} kg` : ""}`).join("\n"));
  }
  if (perfil && perfil.restricoes) partes.push(`Restrições registradas: ${perfil.restricoes}`);
  if (!sessoes.length && !(ciclo && ciclo.treinos)) return vazio(`Nenhum treino registrado nos últimos ${Math.min(dias, 14)} dias.`);
  return { texto: partes.join("\n\n"), itens: sessoes.length, vazio: false };
}

/** A meta calorica, calculada do jeito que a funcao espera (o ecossistema antigo errava a chamada). */
async function metaDeKcal(agora) {
  try {
    const [perfil, obj] = await Promise.all([metasRefeicao.perfilDoTreino(), metasRefeicao.lerObjetivo()]);
    if (!perfil) return null;
    const basal = metasRefeicao.basalDiario({
      sexo: perfil.sexo, pesoKg: perfil.peso_kg, alturaCm: perfil.altura_cm, idade: metasRefeicao.idadeDe(perfil.nascimento, agora),
    });
    const treinoDia = await metasRefeicao.treinoPorDia(bancoRefeicao.diasAtras(14, agora));
    const m = metasRefeicao.calcularMeta({ basal, treinoDia, objetivo: obj.objetivo });
    return m && m.teto ? m : null;
  } catch { return null; }
}

async function ver_refeicoes(args, ctx) {
  const dias = args.dias || 3;
  const hoje = bancoRefeicao.hojeLocal(ctx.agora);
  const de = bancoRefeicao.diasAtras(dias - 1, ctx.agora);
  const [lista, meta] = await Promise.all([bancoRefeicao.listarPeriodo(de, hoje), metaDeKcal(ctx.agora)]);
  if (!lista.length) return vazio(dias === 1 ? "Nenhuma refeição registrada hoje até agora." : `Nenhuma refeição registrada nos últimos ${dias} dias.`);

  const porDia = new Map();
  for (const r of lista) {
    if (!porDia.has(r.data)) porDia.set(r.data, []);
    porDia.get(r.data).push(r);
  }
  const datas = [...porDia.keys()].sort();
  const linhas = datas.map((d) => {
    const rs = porDia.get(d).sort((a, b) => a.ordem - b.ordem);
    const t = rs.reduce((a, r) => ({
      kcal: a.kcal + r.totais.kcal, p: a.p + r.totais.proteina, c: a.c + r.totais.carbo, g: a.g + r.totais.gordura,
    }), { kcal: 0, p: 0, c: 0, g: 0 });
    const itens = rs.map((r) => {
      const nomes = (r.itens || []).map((it) => it.nome || it.item || (typeof it === "string" ? it : "")).filter(Boolean).join(", ");
      return `${r.rotulo || r.tipo}: ${corta(nomes || r.texto || "registrado", 90)}`;
    }).join(" | ");
    return `- ${d}${d === hoje ? " (hoje, ainda em andamento)" : ""}: ${Math.round(t.kcal)} kcal (P ${Math.round(t.p)}g · C ${Math.round(t.c)}g · G ${Math.round(t.g)}g) — ${itens}`;
  });
  const completos = datas.filter((d) => d !== hoje);
  const media = completos.length
    ? Math.round(completos.reduce((s, d) => s + porDia.get(d).reduce((a, r) => a + r.totais.kcal, 0), 0) / completos.length)
    : null;
  const cab = meta ? `Meta calórica diária: ~${meta.teto} kcal (objetivo: ${meta.objetivo}, gasto estimado ${meta.gasto} kcal).` : "Meta calórica não calculada (falta sexo, peso ou altura no perfil do treino).";
  return {
    texto: `${cab}\n${linhas.join("\n")}${media && completos.length > 1 ? `\nMédia dos dias completos: ${media} kcal/dia.` : ""}`,
    itens: lista.length, vazio: false,
  };
}

async function ver_peso(args) {
  const [pesagens, perfil] = await Promise.all([bancoTreino.listarPesagens(args.limite || 12).catch(() => []), bancoTreino.lerPerfil().catch(() => null)]);
  if (!pesagens.length && !(perfil && perfil.peso_kg)) return vazio("Nenhum peso registrado.");
  const partes = [];
  if (perfil) {
    const p = [perfil.peso_kg ? `peso atual ${perfil.peso_kg} kg${perfil.peso_em ? ` (de ${dataCurta(perfil.peso_em)})` : ""}` : null,
      perfil.altura_cm ? `altura ${perfil.altura_cm} cm` : null, perfil.nivel ? `nível ${perfil.nivel}` : null].filter(Boolean);
    if (p.length) partes.push(`Perfil: ${p.join(", ")}.`);
  }
  if (pesagens.length >= 2) {
    const a = pesagens[0], b = pesagens[pesagens.length - 1];
    const delta = Math.round((Number(b.peso_kg) - Number(a.peso_kg)) * 10) / 10;
    const dias = Math.max(1, Math.round((new Date(b.criado_em) - new Date(a.criado_em)) / DIA_MS));
    partes.push(`Histórico (${pesagens.length} pesagens): ${pesagens.map((x) => `${dataCurta(x.criado_em)} ${x.peso_kg}kg`).join(", ")}.\nVariação: ${delta > 0 ? "+" : ""}${delta} kg em ${dias} dias.`);
  } else if (pesagens.length === 1) {
    partes.push(`Única pesagem: ${pesagens[0].peso_kg} kg em ${dataCurta(pesagens[0].criado_em)}.`);
  }
  return { texto: partes.join("\n"), itens: pesagens.length, vazio: false };
}

async function ver_metas() {
  const r = await metasDeHoje();
  if (!r.metas.length) return vazio("Nenhuma meta configurada.");
  return {
    texto: `Metas de hoje (${r.feitas} de ${r.total} feitas):\n` + r.metas.map((m) => `- ${m.rotulo}: ${m.estado}${m.detalhe ? ` — ${corta(m.detalhe, 120)}` : ""}`).join("\n"),
    itens: r.total, vazio: false,
  };
}

async function ver_tarefas(args) {
  let tasks;
  try {
    tasks = await clickup.buscarTasks({ fechadas: false });
  } catch (e) {
    return vazio(`ClickUp indisponível agora (${corta(e.message, 80)}).`);
  }
  const foco = args.foco || "todas";
  let lista = clickup.ordenarPorPrazo(tasks);
  if (foco === "hoje") lista = lista.filter((t) => t.prazo === "hoje");
  else if (foco === "vencidas") lista = lista.filter((t) => t.prazo === "vencida");
  else if (foco === "semana") lista = lista.filter((t) => t.prazo === "hoje" || t.prazo === "semana");
  if (!lista.length) return vazio(foco === "todas" ? "Nenhuma tarefa aberta atribuída." : `Nenhuma tarefa ${foco}.`);
  const c = clickup.contarPrazos(tasks);
  return {
    texto: `Tarefas abertas: ${tasks.length} (${c.vencida} vencida(s), ${c.hoje} pra hoje, ${c.semana} na semana).\n` +
      lista.slice(0, 15).map((t) => `- [${t.prazo}] ${t.name} — ${t.status}${t.list ? ` (${t.list})` : ""}${t.priority ? ` · prioridade ${t.priority}` : ""}`).join("\n"),
    itens: lista.length, vazio: false,
  };
}

async function ver_lembretes(args, ctx) {
  const todas = await db.listarEventos();
  const ini = ctx.agora.getTime() - 2 * DIA_MS;
  const fim = ctx.agora.getTime() + (args.dias || 30) * DIA_MS;
  const eventos = todas
    .filter((n) => { const t = new Date(n.data_evento).getTime(); return Number.isFinite(t) && t >= ini && t <= fim; })
    .sort((a, b) => new Date(a.data_evento) - new Date(b.data_evento));
  if (!eventos.length) return vazio(`Nenhum lembrete ou evento marcado nos próximos ${args.dias || 30} dias.`);
  return {
    texto: eventos.slice(0, 15).map((n) => {
      const dias = Math.round((new Date(n.data_evento).getTime() - ctx.agora.getTime()) / DIA_MS);
      const quando = dias < 0 ? `há ${-dias} dia(s)` : dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;
      return `- ${dataCurta(n.data_evento)} (${quando}): ${n.resumo || corta(n.texto_original, 100)}`;
    }).join("\n"),
    itens: eventos.length, vazio: false,
  };
}

async function ver_radar() {
  const t = await resumoDoRadar();
  return t ? { texto: t, itens: 1, vazio: false } : vazio("TrendRadar sem oportunidades mapeadas.");
}

/* ------------------------------------------------------------ registro */

const IMPL = {
  buscar_notas, notas_por_periodo, buscar_memoria, buscar_conversas,
  ver_treinos, ver_refeicoes, ver_peso, ver_metas, ver_tarefas, ver_lembretes, ver_radar,
};

/** nome -> { espec, executar }. E o que o servidor MCP consome. */
export const FERRAMENTAS = Object.fromEntries(
  NOMES_FERRAMENTAS.map((nome) => [nome, { espec: ESPEC[nome], executar: IMPL[nome] }])
);

const comTempo = (promessa, ms, nome) => Promise.race([
  promessa,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${nome} sem resposta em ${ms / 1000}s`)), ms)),
]);

/**
 * Executa UMA ferramenta. Nunca lanca: falha vira resultado com `erro`, pra uma
 * fonte fora do ar nao derrubar o turno (o modelo recebe "nao consegui ler X").
 */
export async function executarFerramenta(nome, argsBrutos, ctx) {
  const inicio = Date.now();
  const base = { nome, fonte: ESPEC[nome] ? ESPEC[nome].fonte : nome };
  if (!IMPL[nome]) return { ...base, ...vazio(`Ferramenta desconhecida: ${nome}`), erro: "desconhecida", ms: 0 };
  try {
    const r = await comTempo(IMPL[nome](sanearArgs(nome, argsBrutos), ctx), TETO_FERRAMENTA_MS, nome);
    return { ...base, ...r, ms: Date.now() - inicio };
  } catch (e) {
    console.warn(`[conversa] ferramenta ${nome} falhou: ${e.message}`);
    return { ...base, ...vazio(`Não consegui ler esta fonte agora (${corta(e.message, 80)}).`), erro: e.message, ms: Date.now() - inicio };
  }
}

/**
 * Executa o plano inteiro EM PARALELO. O tempo total e o da ferramenta mais
 * lenta, nao a soma.
 * @returns {Promise<object[]>} resultados na mesma ordem do plano
 */
export async function executarPlano(plano, { conversaId = null, agora = new Date(), idsBase = new Set() } = {}) {
  const ctx = { plano, texto: plano.pergunta, conversaId, agora, embed: criarEmbed(), idsBase };
  return Promise.all(plano.ferramentas.map((f) => executarFerramenta(f.nome, f.args, ctx)));
}


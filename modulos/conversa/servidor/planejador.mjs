/**
 * O PLANEJADOR do modulo CONVERSA. Uma chamada de modelo pequeno por turno que
 * decide, ANTES de buscar qualquer coisa:
 *
 *   1. o MODO (amigo, ouvinte, psicologo, tecnico...) e o tamanho da resposta
 *   2. a PERGUNTA reescrita sem pronome solto, usando a conversa ("e ontem?"
 *      vira "como foi meu treino ontem?")
 *   3. QUAIS fontes consultar (notas, memoria, treino, refeicoes, tarefas...)
 *   4. se a mensagem tem fato duravel pra memorizar
 *
 * Substitui o escolherTom, que decidia so o registro e deixava a busca cega.
 * Custo: a mesma chamada Groq que o tom ja fazia, entao o numero de chamadas
 * por turno nao muda.
 *
 * Regra de ouro herdada do tom: esta camada NUNCA derruba o turno. Falhou ou
 * demorou, a heuristica decide e a conversa segue. E duas decisoes nunca vao
 * pro modelo: risco de vida (regra fixa em modos.mjs) e janela de data
 * (tempo.mjs), porque modelo pequeno erra conta de calendario.
 */
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { janelaDoTexto } from "./tempo.mjs";
import { MODOS, MODO_PADRAO, modoValido, resolverModo, resolverTamanho, detectarCrise } from "./modos.mjs";
import { NOMES_FERRAMENTAS, SEMPRE, descreverParaPlanejador, sanearArgs } from "./ferramentas-spec.mjs";

const TETO_PLANEJADOR_MS = Number(process.env.TETO_PLANEJADOR_MS) || 7000;
const MAX_FERRAMENTAS = 5;

/* ----------------------------------------------------------- heuristica */

const RE_TECNICO = /\b(codigo|bug|erro|stack ?trace|api|sql|query|funcao|deploy|servidor|banco de dados|javascript|typescript|python|node|react|docker|git|commit|regex|algoritmo|endpoint|supabase|vercel|prompt|rag|embedding|llm|modelo de linguagem|framework|biblioteca|compilar|debug)\b/;
const RE_EMOCAO = /\b(ansios[oa]|ansiedade|triste|tristeza|cansad[oa]|exaust[oa]|sem forcas|desanimad[oa]|angustia|angustiad[oa]|medo|sozinh[oa]|solidao|chorei|chorando|depress|estress|raiva|frustrad[oa]|frustracao|nao aguento|to mal|me sinto|culpa|vergonha|ciume|saudade)\b/;
const RE_REFLEXAO = /\b(por que eu (sempre|nunca|fico|faco)|o que (ta|esta) acontecendo comigo|sera que (eu|e normal)|me entender|meu padrao|sempre acabo|nao sei o que sinto|relacionamento|autoconhecimento|terapia)\b/;
const RE_PAPO = /^(e ai|eae|fala|oi|ola|opa|bom dia|boa tarde|boa noite|blz|beleza|salve|kkk+|haha+|olha (isso|so)|cara|mano)\b/;
const RE_EXECUCAO = /^(escreva|faca|gere|monte|liste|resuma|traduza|crie|redija|reescreva|corrija)\b/;
const RE_RESGATE = /\b(o que eu (ja )?(falei|escrevi|disse|anotei)|minhas notas|lembra quando|eu tinha (falado|escrito|anotado)|tenho (alguma )?nota)\b/;
const RE_ANALISE = /\b(como (eu )?(to|estou|ando) indo|minha evolucao|evoluindo|balanco|resumo da (minha )?semana|progresso|comparad[oa] com|tendencia)\b/;
const RE_ORGANIZAR = /\b(planej|me organiza|organizar|rotina|o que (eu )?faco hoje|monta (um )?plano|prioridade|agenda)\b/;
const RE_DECISAO = /\b(devo|deveria|vale a pena|e melhor|ou (eu )?|dilema|decidir|decisao|escolher|tô em duvida|to em duvida)\b/;

const RE_TREINO = /\b(treino|treinei|treinar|academia|exercicio|malhar|malhei|agachamento|ciclo|serie|series)\b/;
const RE_REFEICAO = /\b(comi|comer|refeicao|almoco|janta|jantar|cafe da manha|caloria|kcal|dieta|macro|proteina|carbo|lanche|fome)\b/;
const RE_PESO = /\b(peso|pesei|balanca|kg|gordura|emagrec|engord)\b/;
const RE_TAREFA = /\b(tarefa|clickup|prazo|entrega|sprint|ticket|demanda|trabalho)\b/;
const RE_META = /\b(meta|metas|duolingo|streak|ofensiva)\b/;
const RE_RADAR = /\b(radar|oportunidade de mercado|tendencia de mercado|trendradar)\b/;
const RE_LEMBRETE = /\b(lembrete|compromisso|evento|agendad[oa]|marcad[oa]|proximos dias|essa semana tenho)\b/;
const RE_CONVERSAS = /\b(a gente (ja )?(falou|conversou)|te (disse|falei|contei)|conversa (passada|anterior))\b/;

function norm(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Plano sem modelo nenhum. E o plano B quando o planejador falha, e e o que
 * garante que esta camada nunca derruba a conversa. Grosseiro de proposito:
 * pega o obvio e cai no padrao. Pura.
 */
export function planoPorHeuristica(texto) {
  const b = norm(texto);
  const t = String(texto || "").trim();
  const palavras = t ? t.split(/\s+/).length : 0;

  let modo = MODO_PADRAO;
  let tamanho = null;
  if (RE_EMOCAO.test(b) && RE_REFLEXAO.test(b)) modo = "reflexao";
  else if (RE_EMOCAO.test(b)) { modo = "escuta"; tamanho = "curta"; }
  else if (RE_REFLEXAO.test(b)) modo = "reflexao";
  else if (RE_EXECUCAO.test(b)) modo = "execucao";
  else if (RE_RESGATE.test(b)) modo = "resgate";
  else if (RE_ANALISE.test(b)) modo = "analise";
  else if (RE_ORGANIZAR.test(b)) modo = "organizar";
  else if (RE_TECNICO.test(b)) modo = "tecnico";
  else if (RE_PAPO.test(b) && palavras <= 14) { modo = "parceiro"; tamanho = "curta"; }
  else if (RE_DECISAO.test(b) && palavras >= 8) modo = "pensar_junto";
  else if (palavras <= 12 && /\?$/.test(t)) { modo = "direto"; tamanho = "curta"; }
  else if (palavras >= 80) tamanho = "longa";

  const ferramentas = [{ nome: "buscar_notas", args: {} }];
  const quer = (re, nome, args = {}) => { if (re.test(b)) ferramentas.push({ nome, args }); };
  quer(RE_TREINO, "ver_treinos");
  quer(RE_REFEICAO, "ver_refeicoes");
  quer(RE_PESO, "ver_peso");
  quer(RE_TAREFA, "ver_tarefas");
  quer(RE_META, "ver_metas");
  quer(RE_RADAR, "ver_radar");
  quer(RE_LEMBRETE, "ver_lembretes");
  quer(RE_CONVERSAS, "buscar_conversas");
  if (modo === "analise" && !ferramentas.some((f) => f.nome === "ver_treinos")) {
    ferramentas.push({ nome: "ver_treinos", args: {} }, { nome: "ver_refeicoes", args: { dias: 7 } });
  }

  return {
    modo, modo_secundario: null, tamanho,
    carga_emocional: modo === "escuta" || modo === "reflexao" ? 1 : 0,
    pergunta: t, consultas: [], ferramentas,
    memoravel: false,
    motivo: "heuristica",
    fonte: "heuristica",
  };
}

/* ------------------------------------------------------------- sanear */

const limpaLista = (v, max, tam = 200) =>
  (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, tam))
    .filter(Boolean)
    .slice(0, max);

/**
 * Normaliza a saida do modelo e aplica as regras que NAO sao do modelo.
 * Pura: recebe a saida crua, o texto, o modo anterior e a hora; devolve o plano.
 * Entrada vem de um LLM, entao cada campo e validado e nada e confiado.
 */
export function sanearPlano(bruto, { texto, modoAnterior = null, agora = new Date() } = {}) {
  const r = bruto && typeof bruto === "object" ? bruto : {};
  const base = planoPorHeuristica(texto);

  let modo = modoValido(r.modo) ? String(r.modo).toLowerCase() : base.modo;
  let secundario = modoValido(r.modo_secundario) && r.modo_secundario !== modo ? String(r.modo_secundario).toLowerCase() : null;
  if (secundario === "crise") secundario = null; // crise so por regra fixa
  if (modo === "crise") modo = base.modo === "crise" ? "escuta" : base.modo; // o modelo nao decide crise

  const m = resolverModo(modo);
  const tamanho = resolverTamanho(r.tamanho, m);
  const carga = Math.max(0, Math.min(2, Number(r.carga_emocional) || 0));
  const palavras = String(texto || "").trim().split(/\s+/).filter(Boolean).length;

  // pergunta autossuficiente: sem ela, a propria mensagem
  const pergunta = String(r.pergunta || "").replace(/\s+/g, " ").trim().slice(0, 500) || String(texto || "").trim().slice(0, 500);
  const consultas = limpaLista(r.consultas, 3, 160);

  // ferramentas: so as que existem, args saneados, sem repeticao
  const vistas = new Set();
  const ferramentas = [];
  for (const f of Array.isArray(r.ferramentas) ? r.ferramentas : []) {
    const nome = typeof f === "string" ? f : f && f.nome;
    if (!NOMES_FERRAMENTAS.includes(nome) || vistas.has(nome)) continue;
    vistas.add(nome);
    ferramentas.push({ nome, args: sanearArgs(nome, typeof f === "object" ? f.args : {}) });
    if (ferramentas.length >= MAX_FERRAMENTAS) break;
  }
  if (!ferramentas.length) ferramentas.push({ nome: "buscar_notas", args: {} });

  let plano = {
    modo, modo_secundario: secundario, tamanho, carga_emocional: carga,
    pergunta, consultas, ferramentas,
    memoravel: r.memoravel === true,
    motivo: String(r.motivo || "").slice(0, 140),
    fonte: "modelo",
  };

  /* Depois de um momento de risco, mensagem curta nao vira "tecnico" de
     repente: a pessoa pode estar so respondendo "nao sei" ou "to bem". */
  if (modoAnterior === "crise" && palavras < 30 && !["crise", "escuta", "reflexao"].includes(plano.modo)) {
    plano = { ...plano, modo: "escuta", tamanho: "curta", motivo: "logo apos momento de risco" };
  }

  return aplicarRegrasFixas(plano, { texto, agora });
}

/**
 * O que a regra decide, nao o modelo: risco de vida e janela de data. Pura.
 * Roda sobre QUALQUER plano (do modelo ou da heuristica).
 */
export function aplicarRegrasFixas(plano, { texto, agora = new Date() } = {}) {
  let p = { ...plano, ferramentas: [...plano.ferramentas] };

  // 1. risco de vida: modo fixo, curto, sem enchimento e sem ruido de dados
  if (detectarCrise(texto)) {
    p = { ...p, modo: "crise", modo_secundario: null, tamanho: "curta", carga_emocional: 2, ferramentas: [], crise: true, memoravel: false };
  }

  // 2. data escrita na mensagem vira FILTRO, calculado em codigo
  const janela = janelaDoTexto(texto, agora);
  if (janela && p.modo !== "crise") {
    p.janela = janela;
    if (!p.ferramentas.some((f) => f.nome === "notas_por_periodo")) {
      p.ferramentas.unshift({ nome: "notas_por_periodo", args: sanearArgs("notas_por_periodo", {}) });
    }
  }

  // 3. memoria sempre (e a unica ferramenta que sobra em crise)
  for (const nome of SEMPRE) {
    if (!p.ferramentas.some((f) => f.nome === nome)) p.ferramentas.push({ nome, args: {} });
  }
  p.ferramentas = p.ferramentas.slice(0, MAX_FERRAMENTAS + SEMPRE.length);
  return p;
}

/* -------------------------------------------------------------- prompt */

const SISTEMA_PLANO = `Você planeja COMO outro sistema vai responder a mensagem de uma pessoa. Você não responde a mensagem.

O sistema é o "segundo cérebro" da pessoa: guarda notas, memórias, treinos, refeições, tarefas. Ele precisa mudar de papel conforme o momento: amigo, ouvinte, interlocutor reflexivo (como um bom psicólogo), colega técnico, sparring de decisão, analista dos dados dela. Escolher o papel certo é a decisão mais importante.

MODOS:
${Object.values(MODOS).filter((m) => m.id !== "crise").map((m) => `- ${m.id}: ${m.quando}`).join("\n")}

Como escolher o modo:
- Olhe o que a pessoa precisa AGORA, não só o assunto. Contar algo pesado pede escuta; perguntar "o que eu faço" pede posição.
- Desabafo vs reflexão: se só descarrega, "escuta"; se tenta entender o que sente ou um padrão dela, "reflexao".
- Use o modo da resposta anterior pra não dar tranco: se a pessoa estava desabafando e a mensagem nova ainda carrega emoção, continue em "escuta" ou "reflexao" mesmo que apareça um assunto prático.
- "modo_secundario" (opcional) é um toque de outro papel, ex.: escuta com um toque de parceiro. Só quando ajuda de verdade.
- Dúvida entre dois modos: escolha o menos opinativo.

Tamanho: minima, curta, media, longa. Acompanhe o esforço da pessoa. Desabafo nunca é "longa". Pergunta de uma linha nunca vira ensaio.
carga_emocional: 0 (neutro), 1 (há emoção), 2 (pesado).

FERRAMENTAS que o sistema pode consultar (escolha só as que MUDAM a resposta):
${descreverParaPlanejador()}

Como escolher ferramentas:
- Papo e desabafo quase nunca precisam de dado: buscar_memoria (e no máximo buscar_notas) bastam.
- Só consulte treino, refeição, peso, tarefas ou metas se a pessoa tocou nesse assunto ou pediu balanço geral. Ter o dado não é motivo pra usar o dado.
- "Como estou indo?" e balanços: analise + ver_treinos + ver_refeicoes + ver_tarefas + notas_por_periodo.
- Máximo ${MAX_FERRAMENTAS} ferramentas. buscar_memoria já roda sempre; não precisa pedir.

"pergunta": reescreva a mensagem de forma AUTOSSUFICIENTE usando a conversa, resolvendo pronomes e elipses ("e ontem?" depois de falar de treino vira "como foi meu treino ontem?"). Se já é autossuficiente, repita.
"consultas": 1 a 3 buscas curtas pra achar o que a pessoa pode ter anotado, com ângulos diferentes (um termo-chave, uma paráfrase). Nada de pronome solto.
"memoravel": true só se a mensagem traz fato durável sobre a vida da pessoa (pessoas, decisões, planos, mudanças, projetos, preferências, saúde). Pergunta, papo e pedido de tarefa: false.

Responda SOMENTE com JSON:
{"modo":"...","modo_secundario":null,"tamanho":"...","carga_emocional":0,"pergunta":"...","consultas":["..."],"ferramentas":[{"nome":"...","args":{}}],"memoravel":false,"motivo":"meia frase"}`;

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Quando e agora no fuso da pessoa, em palavras. Pura. */
export function agoraPorExtenso(agora = new Date(), fusoMin = Number(process.env.FUSO_MINUTOS ?? -180)) {
  const l = new Date(agora.getTime() + fusoMin * 60000);
  const h = l.getUTCHours();
  const periodo = h < 5 ? "madrugada" : h < 12 ? "manhã" : h < 18 ? "tarde" : "noite";
  const dia = l.toISOString().slice(0, 10);
  const hora = `${String(h).padStart(2, "0")}:${String(l.getUTCMinutes()).padStart(2, "0")}`;
  return `${DIAS_SEMANA[l.getUTCDay()]}, ${dia}, ${hora} (${periodo})`;
}

/** A conversa ate aqui, enxuta, com o modo de cada resposta. Pura. */
export function resumirHistorico(turnos, max = 6) {
  const lista = (Array.isArray(turnos) ? turnos : []).slice(-max);
  if (!lista.length) return "(primeira mensagem da conversa)";
  return lista.map((t) => {
    const quem = t.papel === "pessoa" ? "PESSOA" : `CÉREBRO${t.meta && t.meta.modo ? ` · modo ${t.meta.modo}` : ""}`;
    return `[${quem}] ${String(t.texto || "").replace(/\s+/g, " ").slice(0, 280)}`;
  }).join("\n");
}

/** Modo e carga da ultima resposta do cerebro, pra transicao. Pura. */
export function ultimoModo(turnos) {
  const lista = Array.isArray(turnos) ? turnos : [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const t = lista[i];
    if (t && t.papel === "cerebro" && t.meta && t.meta.modo) {
      return { modo: t.meta.modo, carga: Number(t.meta.carga_emocional) || 0 };
    }
  }
  return { modo: null, carga: 0 };
}

/**
 * Planeja o turno. Nunca lanca: erro, timeout ou JSON torto viram heuristica.
 * @param {{texto:string, historico?:object[], agora?:Date}} entrada
 */
export async function planejar({ texto, historico = [], agora = new Date() }) {
  const anterior = ultimoModo(historico);
  const ctx = { texto, modoAnterior: anterior.modo, agora };

  // risco de vida nao espera modelo nem arrisca timeout
  if (detectarCrise(texto)) {
    return { ...sanearPlano(planoPorHeuristica(texto), ctx), modo_anterior: anterior.modo, carga_anterior: anterior.carga };
  }

  try {
    const prompt =
      `Agora: ${agoraPorExtenso(agora)}\n\n` +
      `Conversa até aqui (mais recente por último):\n${resumirHistorico(historico)}\n\n` +
      `Mensagem nova da pessoa:\n"""\n${String(texto || "").slice(0, 1500)}\n"""`;

    const chamada = chatJSONDetalhado(SISTEMA_PLANO, prompt, {
      modelo: process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
      temperatura: 0.1,
      raciocinio: "low",
      tentativas: 1,
    });
    /* Teto de tempo: isto roda antes de TUDO. Se nao vier rapido, nao vem. */
    const r = await Promise.race([
      chamada,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`planejador sem resposta em ${TETO_PLANEJADOR_MS / 1000}s`)), TETO_PLANEJADOR_MS)),
    ]);
    return {
      ...sanearPlano(r && r.dados, ctx),
      modo_anterior: anterior.modo, carga_anterior: anterior.carga,
      planejador: { provedor: "groq", modelo: r && r.meta && r.meta.modelo },
    };
  } catch (e) {
    const h = sanearPlano(planoPorHeuristica(texto), ctx);
    return {
      ...h, fonte: "heuristica", motivo: "planejador falhou: " + String(e.message).slice(0, 80),
      modo_anterior: anterior.modo, carga_anterior: anterior.carga,
    };
  }
}


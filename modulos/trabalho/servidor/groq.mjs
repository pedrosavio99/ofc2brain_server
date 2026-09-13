/**
 * Modulo TRABALHO - camada Groq.
 *
 * Duas entregas: ordem de execucao das tarefas e a daily.
 * Se nao houver chave, ou se a Groq falhar, cai numa heuristica local em vez
 * de quebrar.
 *
 * Por que rodizio de chaves: a conta gratuita limita requisicao por minuto E
 * token por dia. O .env do Segundo Cerebro guarda VARIAS chaves separadas por
 * virgula, e a versao anterior deste arquivo mandava a string inteira como
 * Bearer, o que dava 401 em toda chamada e escondia o erro atras da
 * heuristica. Aqui a string e quebrada na virgula e as chaves sao tentadas em
 * ordem, com descanso por chave e modelo.
 *
 * O descanso NAO e compartilhado com src/groqClient.js de proposito: o modulo
 * tem que continuar zipavel sozinho. O custo e uma requisicao perdida quando o
 * app principal acabou de estourar a chave que o modulo tenta primeiro.
 *
 * Env:
 *   GROQ_API_KEYS ou GROQ_API_KEY   uma ou varias, separadas por virgula
 *   GROQ_MODEL_TRABALHO, GROQ_MODEL, GROQ_CHAT_MODEL   cascata do modelo
 *   GROQ_TIMEOUT_MS                 teto por tentativa, padrao 45s
 */
const BASE = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

const descanso = new Map();   // "chave|modelo" -> quando libera
const invalidas = new Set();  // chaves recusadas pela API
let ponteiro = 0;

function listaChaves() {
  const bruto = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "";
  return bruto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "coloque_sua_chave_aqui");
}

// Getters, e nao valores fixos: o .env pode ser carregado depois deste import.
export const groq = {
  get chaves() { return listaChaves(); },
  get modelo() {
    return (process.env.GROQ_MODEL_TRABALHO || process.env.GROQ_MODEL ||
      process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b").trim();
  },
  get timeoutMs() { return Number(process.env.GROQ_TIMEOUT_MS || 45000); },
};

export const temGroq = () => listaChaves().length > 0;
export const quantasChaves = () => listaChaves().length;

const marca = (chave, modelo) => chave + "|" + modelo;

function emDescanso(chave, modelo) {
  const ate = descanso.get(marca(chave, modelo));
  if (!ate) return false;
  if (Date.now() >= ate) { descanso.delete(marca(chave, modelo)); return false; }
  return true;
}

/** A Groq manda retry-after em segundos e repete o tempo na mensagem. */
function esperaDoLimite(resposta, corpo) {
  const header = resposta.headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = String(corpo).match(/try again in (\d+(?:\.\d+)?)\s*(m|s)/i);
  if (m) return Math.ceil(parseFloat(m[1]) * (m[2].toLowerCase() === "m" ? 60000 : 1000));
  return 8000;
}

function extrairJson(texto) {
  const limpo = String(texto || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio === -1 || fim === -1) return null;
  try {
    return JSON.parse(limpo.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

async function umaChamada(chave, modelo, prompt, maxTokens) {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), groq.timeoutMs);
  try {
    const res = await fetch(BASE + "/chat/completions", {
      method: "POST",
      signal: controlador.signal,
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const corpo = await res.text();
      const erro = new Error("HTTP " + res.status + " " + corpo.slice(0, 200));
      if (res.status === 429 || res.status === 503) {
        erro.limiteAtingido = true;
        erro.esperaMs = esperaDoLimite(res, corpo);
      }
      if (res.status === 401 || res.status === 403) erro.chaveRuim = true;
      throw erro;
    }

    const dados = await res.json();
    const json = extrairJson(dados?.choices?.[0]?.message?.content);
    if (!json) throw new Error("resposta fora do formato pedido");
    return json;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Percorre as chaves uma vez. Chave no limite descansa e a proxima assume.
 * Nao dorme esperando liberar: quem chama aqui tem heuristica de reserva, e
 * segurar a requisicao por minutos e pior do que entregar a ordem local.
 */
async function chamarGroq(prompt, maxTokens = 2000) {
  const chaves = listaChaves();
  if (!chaves.length) throw new Error("nenhuma chave da Groq configurada");
  const modelo = groq.modelo;
  let ultimoErro = null;

  for (let i = 0; i < chaves.length; i++) {
    const idx = (ponteiro + i) % chaves.length;
    const chave = chaves[idx];
    if (invalidas.has(chave)) continue;
    if (emDescanso(chave, modelo)) continue;
    try {
      const r = await umaChamada(chave, modelo, prompt, maxTokens);
      ponteiro = idx + 1;
      return r;
    } catch (err) {
      ultimoErro = err;
      if (err.limiteAtingido) {
        descanso.set(marca(chave, modelo), Date.now() + err.esperaMs);
        console.warn("[trabalho] chave " + (idx + 1) + "/" + chaves.length + " no limite em " +
          modelo + " (" + Math.ceil(err.esperaMs / 1000) + "s). Tentando a proxima.");
        continue;
      }
      if (err.chaveRuim) {
        invalidas.add(chave);
        console.error("[trabalho] chave " + (idx + 1) + "/" + chaves.length + " recusada. Ignorando ela.");
        continue;
      }
      throw err;
    }
  }
  throw ultimoErro || new Error("todas as chaves da Groq estao no limite");
}

/* ===================== ordem de execucao ===================== */

const ROTULO_PRAZO = {
  vencida: "vencida", hoje: "vence hoje", semana: "vence nos proximos 7 dias",
  depois: "vence mais adiante", "sem-prazo": "sem prazo definido",
};

const PESO_PRIORIDADE = { urgent: 0, high: 1, normal: 2, low: 3 };
const PESO_PRAZO = { vencida: 0, hoje: 1, semana: 2, depois: 3, "sem-prazo": 4 };

function resumirTask(t, indice) {
  const partes = [
    (indice + 1) + ".",
    "id=" + t.id,
    "titulo=" + t.name,
    "status=" + t.status,
    "prazo=" + (ROTULO_PRAZO[t.prazo] || t.prazo),
  ];
  if (t.dueDate) partes.push("data=" + new Date(t.dueDate).toLocaleDateString("pt-BR"));
  if (t.priority) partes.push("prioridade=" + t.priority);
  if (t.list) partes.push("lista=" + t.list);
  if (t.tags?.length) partes.push("tags=" + t.tags.join(","));
  const descricao = String(t.description || "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (descricao) partes.push("descricao=" + descricao);
  return partes.join(" | ");
}

function heuristica(tasks) {
  const ordenadas = [...tasks].sort((a, b) => {
    const p = (PESO_PRAZO[a.prazo] ?? 9) - (PESO_PRAZO[b.prazo] ?? 9);
    if (p !== 0) return p;
    const pr = (PESO_PRIORIDADE[a.priority] ?? 9) - (PESO_PRIORIDADE[b.priority] ?? 9);
    if (pr !== 0) return pr;
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    return (b.updated || 0) - (a.updated || 0);
  });

  return ordenadas.map((t) => {
    const motivos = [];
    if (t.prazo === "vencida") motivos.push("ja passou do prazo");
    else if (t.prazo === "hoje") motivos.push("vence hoje");
    else if (t.prazo === "semana") motivos.push("vence dentro de uma semana");
    else if (t.prazo === "sem-prazo") motivos.push("sem prazo, entra depois do que tem data");
    if (t.priority === "urgent" || t.priority === "high") motivos.push("prioridade " + t.priority + " no ClickUp");
    if (String(t.status).toLowerCase().includes("progres")) motivos.push("ja esta em andamento, terminar antes de abrir frente nova");
    return { id: t.id, motivo: motivos.join(", ") || "sem sinal forte de urgencia, pode ficar para o fim" };
  });
}

export async function ordenarTarefas(tasks) {
  if (!tasks.length) return { fonte: "vazio", modelo: "", resumo: "", ordem: [] };

  if (!temGroq()) {
    return {
      fonte: "heuristica",
      modelo: "",
      resumo: "Ordem montada localmente por prazo e prioridade. Configure GROQ_API_KEY para a ordem explicada pela IA.",
      ordem: heuristica(tasks),
    };
  }

  const prompt =
    "Voce ajuda um desenvolvedor a decidir a ordem de execucao das tarefas dele hoje. " +
    "Abaixo estao as tarefas escolhidas por ele, com prazo, prioridade, status e descricao.\n\n" +
    "Devolva SOMENTE um JSON valido, sem texto antes ou depois, neste formato:\n" +
    '{"resumo":"uma ou duas frases sobre o conjunto","ordem":[{"id":"<id da tarefa>","motivo":"por que essa vem nesta posicao"}]}\n\n' +
    "Regras: use todos os ids, uma vez cada, do mais urgente para o menos. " +
    "O motivo deve ser especifico daquela tarefa, curto, no maximo duas linhas, em portugues do Brasil, sem travessoes. " +
    "Considere prazo vencido, dependencia entre tarefas, esforco aparente e o que ja esta em andamento.\n\n" +
    "TAREFAS:\n" + tasks.map(resumirTask).join("\n");

  try {
    const bruto = await chamarGroq(prompt, 2000);
    if (!Array.isArray(bruto.ordem)) throw new Error("resposta sem a lista ordem");

    const porId = new Map(tasks.map((t) => [String(t.id), t]));
    const usados = new Set();
    const ordem = [];

    for (const item of bruto.ordem) {
      const id = String(item?.id || "");
      if (!porId.has(id) || usados.has(id)) continue;
      usados.add(id);
      ordem.push({ id, motivo: String(item.motivo || "").trim() || "sem motivo informado" });
    }
    // tarefa que a IA esqueceu entra no fim, na ordem da heuristica
    for (const sobra of heuristica(tasks.filter((t) => !usados.has(String(t.id))))) ordem.push(sobra);

    return { fonte: "groq", modelo: groq.modelo, resumo: String(bruto.resumo || "").trim(), ordem };
  } catch (err) {
    return {
      fonte: "heuristica",
      modelo: groq.modelo,
      resumo: "A Groq nao respondeu (" + err.message + "). Ordem montada localmente por prazo e prioridade.",
      ordem: heuristica(tasks),
    };
  }
}

/* ========================== daily ========================== */

const MAX_COMENTARIOS_NO_PROMPT = 60;
const MAX_ABERTAS_NO_PROMPT = 40;
const MIN_PROXIMAS = 2;
const MAX_PROXIMAS = 4;

function resumirComentario(c) {
  const quando = new Date(c.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const texto = String(c.texto || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return "- [" + quando + "] tarefa \"" + c.taskName + "\"" +
    (c.list ? " (lista " + c.list + ")" : "") +
    (c.status ? " [status " + c.status + "]" : "") + ": " + texto;
}

/** Reserva local: agrupa os comentarios por tarefa, sem IA. */
function dailyLocal(comentarios, abertas, horas) {
  const porTask = new Map();
  for (const c of comentarios) {
    if (!porTask.has(c.taskId)) porTask.set(c.taskId, { task: c.taskName, pontos: [] });
    porTask.get(c.taskId).pontos.push(String(c.texto || "").replace(/\s+/g, " ").trim().slice(0, 240));
  }
  const feito = [...porTask.values()];
  const resumo = comentarios.length
    ? "Nas ultimas " + horas + " horas voce comentou em " + feito.length +
      (feito.length === 1 ? " tarefa" : " tarefas") + ", " + comentarios.length +
      (comentarios.length === 1 ? " comentario no total." : " comentarios no total.")
    : "Nenhum comentario seu nas ultimas " + horas + " horas.";

  return {
    resumo,
    feito,
    proximas: heuristica(abertas).slice(0, MIN_PROXIMAS),
  };
}

/**
 * Monta a daily: resumo do que foi feito a partir dos SEUS comentarios, mais
 * as proximas tarefas escolhidas pela IA entre as que estao abertas.
 * @param {{horas:number, comentarios:Array, abertas:Array}} entrada
 */
export async function gerarDaily({ horas, comentarios, abertas }) {
  const comentariosUsados = comentarios.slice(0, MAX_COMENTARIOS_NO_PROMPT);
  const abertasUsadas = [...abertas]
    .sort((a, b) => (PESO_PRAZO[a.prazo] ?? 9) - (PESO_PRAZO[b.prazo] ?? 9))
    .slice(0, MAX_ABERTAS_NO_PROMPT);

  if (!temGroq()) {
    return { fonte: "heuristica", modelo: "", ...dailyLocal(comentariosUsados, abertasUsadas, horas) };
  }

  const prompt =
    "Voce escreve a daily de um desenvolvedor. Ele vai colar o resultado no time.\n\n" +
    "Devolva SOMENTE um JSON valido, sem texto antes ou depois, neste formato:\n" +
    '{"resumo":"duas ou tres frases sobre o que ele fez","feito":[{"task":"titulo da tarefa","pontos":["o que avancou ali"]}],' +
    '"proximas":[{"id":"<id da tarefa>","motivo":"por que pegar essa agora"}]}\n\n' +
    "Regras:\n" +
    "1. O bloco feito sai SO dos comentarios abaixo, que sao dele mesmo, das ultimas " + horas + " horas. " +
    "Nao invente entrega que o comentario nao diz. Se um comentario for so pergunta ou combinado, registre como combinado, nao como entrega.\n" +
    "2. O bloco proximas tem no minimo " + MIN_PROXIMAS + " e no maximo " + MAX_PROXIMAS +
    " tarefas, escolhidas so da lista de tarefas abertas. Use o id exato. Prefira o que esta vencido, o que vence hoje e o que ja esta em andamento. " +
    "Evite repetir tarefa que os comentarios mostram como concluida.\n" +
    "3. Portugues do Brasil, frases curtas, sem travessoes, sem emoji, primeira pessoa.\n\n" +
    "SEUS COMENTARIOS NAS ULTIMAS " + horas + " HORAS:\n" +
    (comentariosUsados.length ? comentariosUsados.map(resumirComentario).join("\n") : "(nenhum)") +
    "\n\nTAREFAS ABERTAS:\n" +
    (abertasUsadas.length ? abertasUsadas.map(resumirTask).join("\n") : "(nenhuma)");

  try {
    const bruto = await chamarGroq(prompt, 2500);
    const porId = new Map(abertasUsadas.map((t) => [String(t.id), t]));

    const proximas = [];
    const vistos = new Set();
    for (const item of (Array.isArray(bruto.proximas) ? bruto.proximas : [])) {
      const id = String(item?.id || "");
      if (!porId.has(id) || vistos.has(id)) continue;  // id inventado pela IA cai fora
      vistos.add(id);
      proximas.push({ id, motivo: String(item.motivo || "").trim() || "sem motivo informado" });
      if (proximas.length >= MAX_PROXIMAS) break;
    }
    // o pedido e "pelo menos 2": se a IA devolveu menos, a heuristica completa
    for (const sobra of heuristica(abertasUsadas.filter((t) => !vistos.has(String(t.id))))) {
      if (proximas.length >= MIN_PROXIMAS) break;
      proximas.push(sobra);
    }

    const feito = (Array.isArray(bruto.feito) ? bruto.feito : []).map((f) => ({
      task: String(f?.task || "").trim() || "sem titulo",
      pontos: (Array.isArray(f?.pontos) ? f.pontos : []).map((p) => String(p).trim()).filter(Boolean),
    })).filter((f) => f.pontos.length);

    return {
      fonte: "groq",
      modelo: groq.modelo,
      resumo: String(bruto.resumo || "").trim(),
      feito,
      proximas,
    };
  } catch (err) {
    const local = dailyLocal(comentariosUsados, abertasUsadas, horas);
    return {
      fonte: "heuristica",
      modelo: groq.modelo,
      ...local,
      resumo: "A Groq nao respondeu (" + err.message + "). " + local.resumo,
    };
  }
}

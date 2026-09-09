/**
 * Modulo TRABALHO - ordem de execucao das tarefas via Groq.
 *
 * Se nao houver chave, ou se a Groq falhar, cai numa heuristica local em vez
 * de quebrar: prazo vencido primeiro, depois prioridade, depois o que ja esta
 * em andamento.
 *
 * O modelo e lido em cascata pra conviver com o .env do Segundo Cerebro:
 *   GROQ_MODEL_TRABALHO  (so deste modulo)
 *   GROQ_MODEL           (o que o clickup-local usava)
 *   GROQ_CHAT_MODEL      (o que o Segundo Cerebro ja tem)
 */
const BASE = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";

export const groq = {
  chave: (process.env.GROQ_API_KEY || "").trim(),
  modelo: (process.env.GROQ_MODEL_TRABALHO || process.env.GROQ_MODEL || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b").trim(),
  timeoutMs: Number(process.env.GROQ_TIMEOUT_MS || 45000),
};

export const temGroq = () => Boolean(groq.chave);

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

async function chamarGroq(tasks) {
  const prompt =
    "Voce ajuda um desenvolvedor a decidir a ordem de execucao das tarefas dele hoje. " +
    "Abaixo estao as tarefas escolhidas por ele, com prazo, prioridade, status e descricao.\n\n" +
    "Devolva SOMENTE um JSON valido, sem texto antes ou depois, neste formato:\n" +
    '{"resumo":"uma ou duas frases sobre o conjunto","ordem":[{"id":"<id da tarefa>","motivo":"por que essa vem nesta posicao"}]}\n\n' +
    "Regras: use todos os ids, uma vez cada, do mais urgente para o menos. " +
    "O motivo deve ser especifico daquela tarefa, curto, no maximo duas linhas, em portugues do Brasil, sem travessoes. " +
    "Considere prazo vencido, dependencia entre tarefas, esforco aparente e o que ja esta em andamento.\n\n" +
    "TAREFAS:\n" + tasks.map(resumirTask).join("\n");

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), groq.timeoutMs);
  try {
    const res = await fetch(BASE + "/chat/completions", {
      method: "POST",
      signal: controlador.signal,
      headers: { Authorization: "Bearer " + groq.chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: groq.modelo,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });
    if (!res.ok) {
      const corpo = await res.text();
      throw new Error("HTTP " + res.status + " " + corpo.slice(0, 200));
    }
    const dados = await res.json();
    const conteudo = dados?.choices?.[0]?.message?.content;
    const json = extrairJson(conteudo);
    if (!json || !Array.isArray(json.ordem)) throw new Error("resposta fora do formato pedido");
    return json;
  } finally {
    clearTimeout(relogio);
  }
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

  try {
    const bruto = await chamarGroq(tasks);
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
    const local = heuristica(tasks);
    return {
      fonte: "heuristica",
      modelo: groq.modelo,
      resumo: "A Groq nao respondeu (" + err.message + "). Ordem montada localmente por prazo e prioridade.",
      ordem: local,
    };
  }
}

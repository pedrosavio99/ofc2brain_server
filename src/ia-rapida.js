/**
 * Cliente de IA compartilhado (treino e refeicao): UMA chamada por vez, com chave e modelo EXPLICITOS
 * e prazo. Quem percorre chaves e modelos e o ficha.mjs, que tem o orcamento
 * de tempo na mao.
 *
 * Por que nao usar o src/geminiClient.js: ele percorre modelo x chave x com e
 * sem pensamento e ainda consulta a API atras de outros modelos. Sem prazo,
 * passa de minutos, e a funcao da Vercel morre em 60s.
 * Por que nao o cliente do modulo refeicao: ele usa a PRIMEIRA chave e o
 * PRIMEIRO modelo, entao chave sem cota derruba o degrau inteiro em
 * milissegundos. Foi exatamente o que aconteceu.
 */

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

/** Lista de valores separados por virgula numa env, sem vazios. */
export function lista(...nomes) {
  for (const n of nomes) {
    const v = String(process.env[n] || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (v.length) return v;
  }
  return [];
}

export function chavesGemini() { return lista("GEMINI_API_KEYS", "GEMINI_API_KEY"); }
export function modelosGemini() {
  const m = lista("GEMINI_MODELOS", "GEMINI_MODEL");
  return m.length ? m : ["gemini-2.5-flash"];
}
export function chavesGroq() { return lista("GROQ_API_KEYS", "GROQ_API_KEY"); }
export function modelosGroq() {
  const m = lista("GROQ_CHAT_MODEL", "GROQ_MODEL_RAPIDA");
  // llama-3.1-8b-instant sempre no fim: rapido e raramente ocupado
  return [...new Set([...m, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"])];
}

function tiraJSON(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) throw new Error("resposta vazia");
  const limpo = bruto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const i = limpo.indexOf("{"), f = limpo.lastIndexOf("}");
    if (i >= 0 && f > i) { try { return JSON.parse(limpo.slice(i, f + 1)); } catch { /* abaixo */ } }
    throw new Error("resposta fora do formato JSON");
  }
}

async function postar(url, corpo, cabecalhos, prazoMs) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(prazoMs),
  });
  const texto = await r.text();
  if (!r.ok) {
    const erro = new Error(`HTTP ${r.status}`);
    erro.status = r.status;
    erro.corpo = texto.slice(0, 400);
    throw erro;
  }
  return JSON.parse(texto);
}

/** Uma chamada ao Gemini, com a chave e o modelo que vierem. */
export async function gemini(sistema, prompt, { chave, modelo, prazoMs = 12000, temperatura = 0.8, maxTokens = 8192 }) {
  const r = await postar(`${GEMINI}/${encodeURIComponent(modelo)}:generateContent`, {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: temperatura, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  }, { "x-goog-api-key": chave }, prazoMs);

  const partes = (r?.candidates?.[0]?.content?.parts) || [];
  // parte marcada como thought e o raciocinio, nao a resposta
  const texto = partes.filter((p) => !p.thought).map((p) => p.text || "").join("");
  if (!texto) throw new Error(`sem texto (${r?.candidates?.[0]?.finishReason || "sem candidato"})`);
  return tiraJSON(texto);
}

/** Uma chamada a Groq. json_object so entra em modelo que aceita; se recusar,
    o ficha.mjs tenta o proximo modelo e o motivo aparece na tela. */
export async function groq(sistema, prompt, { chave, modelo, prazoMs = 15000, temperatura = 0.6, maxTokens = 4096 }) {
  const r = await postar(GROQ, {
    model: modelo,
    temperature: temperatura,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sistema }, { role: "user", content: prompt }],
  }, { Authorization: `Bearer ${chave}` }, prazoMs);
  return tiraJSON(r?.choices?.[0]?.message?.content ?? "");
}

/** O motivo, curto e em portugues, pra caber na tela. Puro. */
export function porQue(err, modelo) {
  const s = err?.status;
  const corpo = String(err?.corpo || err?.message || "").toLowerCase();
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `${modelo}: demorou demais`;
  if (corpo.includes("api key not valid") || corpo.includes("invalid api key")) return `${modelo}: chave recusada`;
  if (s === 404 || corpo.includes("not found") || corpo.includes("does not exist") || corpo.includes("decommissioned")) {
    return `${modelo}: modelo nao existe nessa conta`;
  }
  if (s === 429 || corpo.includes("quota") || corpo.includes("rate limit")) return `${modelo}: sem cota agora`;
  if (s === 400 && corpo.includes("json")) return `${modelo}: nao aceita resposta em JSON`;
  if (s === 401 || s === 403) return `${modelo}: acesso negado (${s})`;
  if (s >= 500) return `${modelo}: servidor instavel (${s})`;
  return `${modelo}: ${String(err?.message || err).slice(0, 60)}`;
}

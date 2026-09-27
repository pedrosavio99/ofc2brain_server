/**
 * IA FRACA: Groq, modelo rapido e barato.
 *
 * Usada so pra trabalho que nao exige raciocinio: separar um texto em refeicoes.
 * Cliente enxuto com fetch, sem SDK: uma dependencia a menos e o mesmo formato
 * de resposta ({ dados, meta }) do cliente do Gemini.
 */
import { extrairJSON, postarJSON, valeRepetir, esperar, ErroConfig } from "./json.mjs";

const URL_GROQ = "https://api.groq.com/openai/v1/chat/completions";

export function groqConfigurado() {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function chatJSON(sistema, usuario, opcoes = {}) {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) throw new ErroConfig("GROQ_API_KEY nao esta no ambiente");

  const modelo = opcoes.modelo || process.env.GROQ_MODEL_RAPIDA || "llama-3.1-8b-instant";
  const tentativas = opcoes.tentativas || 2;
  let ultimo;

  for (let i = 1; i <= tentativas; i++) {
    const inicio = Date.now();
    try {
      const r = await postarJSON(URL_GROQ, {
        model: modelo,
        temperature: opcoes.temperatura ?? 0.2,
        max_tokens: opcoes.maxTokens || 1024,
        // o Groq garante objeto JSON com isso; o prompt ainda precisa dizer "JSON"
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }, { Authorization: `Bearer ${chave}` }, opcoes.prazoMs || 12000);

      const texto = r && r.choices && r.choices[0] && r.choices[0].message
        ? r.choices[0].message.content : "";
      return { dados: extrairJSON(texto), meta: { modelo, ms: Date.now() - inicio, tentativa: i } };
    } catch (err) {
      ultimo = err;
      if (err && typeof err === "object") err.modelo = modelo;
      if (i < tentativas && valeRepetir(err)) { await esperar(400 * i); continue; }
      break;
    }
  }
  throw ultimo;
}

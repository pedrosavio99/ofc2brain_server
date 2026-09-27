/**
 * IA FORTE: Gemini.
 *
 * Usada onde erro custa caro: medir calorias e macros de cada item, com a
 * porcao que ela assumiu explicitada. Cliente com fetch puro na API REST.
 *
 * Modelo "pensante" gasta o raciocinio do MESMO teto de tokens da resposta; por
 * isso o maxTokens padrao e alto. Com teto baixo o JSON vinha cortado.
 */
import { extrairJSON, postarJSON, valeRepetir, esperar, ErroConfig } from "./json.mjs";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function primeiraChave() {
  // GEMINI_API_KEYS e o rodizio do 2brain; aqui basta a primeira da lista
  const bruto = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS || "";
  return String(bruto).split(",")[0].trim();
}

export function geminiConfigurado() {
  return Boolean(primeiraChave());
}

export async function gerarJSON(sistema, usuario, opcoes = {}) {
  const chave = primeiraChave();
  if (!chave) throw new ErroConfig("GEMINI_API_KEY nao esta no ambiente");

  const modelo = opcoes.modelo || process.env.GEMINI_MODEL
    || String(process.env.GEMINI_MODELOS || "").split(",")[0].trim() || "gemini-2.5-flash";
  const tentativas = opcoes.tentativas || 2;
  let ultimo;

  for (let i = 1; i <= tentativas; i++) {
    const inicio = Date.now();
    try {
      // chave no header, nao na URL: URL vai parar em log de proxy
      const r = await postarJSON(`${BASE}/${encodeURIComponent(modelo)}:generateContent`, {
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: "user", parts: [{ text: usuario }] }],
        generationConfig: {
          temperature: opcoes.temperatura ?? 0.2,
          maxOutputTokens: opcoes.maxTokens || 8192,
          responseMimeType: "application/json",
        },
      }, { "x-goog-api-key": chave }, opcoes.prazoMs || 45000);

      const partes = (r && r.candidates && r.candidates[0] && r.candidates[0].content
        && r.candidates[0].content.parts) || [];
      // parte marcada como thought e o raciocinio, nao a resposta
      const texto = partes.filter((p) => !p.thought).map((p) => p.text || "").join("");
      if (!texto) {
        const motivo = (r && r.candidates && r.candidates[0] && r.candidates[0].finishReason) || "sem candidato";
        throw Object.assign(new Error(`Gemini nao devolveu texto (${motivo})`), { status: 502 });
      }
      return { dados: extrairJSON(texto), meta: { modelo, ms: Date.now() - inicio, tentativa: i } };
    } catch (err) {
      ultimo = err;
      if (err && typeof err === "object") err.modelo = modelo;
      if (i < tentativas && valeRepetir(err)) { await esperar(800 * i); continue; }
      break;
    }
  }
  throw ultimo;
}

/**
 * Utilitarios comuns dos clientes de IA.
 */

/**
 * Tira o JSON de dentro da resposta de um modelo.
 *
 * Mesmo pedindo "so JSON", modelo as vezes embrulha em ```json ... ``` ou poe uma
 * frase antes. Aqui se aceita isso, mas nunca se inventa: sem objeto valido,
 * lanca, e quem chamou decide o fallback. Puro.
 */
export function extrairJSON(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) throw new Error("resposta vazia do modelo");

  const semCerca = bruto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(semCerca);
  } catch {
    // ultimo recurso: do primeiro { ao ultimo }
    const i = semCerca.indexOf("{");
    const f = semCerca.lastIndexOf("}");
    if (i >= 0 && f > i) {
      try { return JSON.parse(semCerca.slice(i, f + 1)); } catch { /* cai no erro abaixo */ }
    }
    throw Object.assign(new Error("o modelo nao devolveu JSON valido"), { formato: true });
  }
}

/** Erro de configuracao: sem chave nao adianta tentar de novo. */
export class ErroConfig extends Error {}

/** fetch com prazo. AbortSignal.timeout existe do Node 18 em diante. */
export async function postarJSON(url, corpo, cabecalhos, prazoMs) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(prazoMs),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    const erro = new Error(`HTTP ${resp.status}: ${texto.slice(0, 300)}`);
    erro.status = resp.status;
    erro.corpo = texto.slice(0, 600);
    throw erro;
  }
  return JSON.parse(texto);
}

/* Vale repetir: timeout, 429 (limite de taxa) e 5xx. Nao vale: 400/401/403/404,
   que vao falhar igual na segunda vez. */
export function valeRepetir(err) {
  if (err instanceof ErroConfig) return false;
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) return true;
  const s = err && err.status;
  return !s || s === 429 || s >= 500;
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O MOTIVO da falha, em portugues, com o que fazer. Vai pra tela: "nao consegui"
 * sem motivo nao deixa voce consertar nada. Puro.
 *
 * nome = "Gemini" ou "Groq"; variavel = a env do modelo daquele provedor.
 */
export function explicarFalha(err, nome, variavelModelo, variavelChave) {
  const modelo = (err && err.modelo) || "";
  const corpo = String((err && (err.corpo || err.message)) || "").toLowerCase();
  const s = err && err.status;

  if (err instanceof ErroConfig) return `${nome}: ${variavelChave} nao esta no .env.`;
  if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `${nome} demorou demais e a chamada foi cortada. Tente de novo.`;
  }
  if (corpo.includes("api key not valid") || corpo.includes("invalid api key") || corpo.includes("invalid_api_key")) {
    return `${nome}: a chave ${variavelChave} foi recusada. Confira o valor no .env.`;
  }
  if (s === 404 || corpo.includes("not found") || corpo.includes("decommissioned") || corpo.includes("does not exist")) {
    return `${nome}: o modelo "${modelo}" nao existe ou foi desativado. Troque ${variavelModelo} no .env.`;
  }
  if (s === 401 || s === 403) return `${nome}: acesso negado (HTTP ${s}). Confira ${variavelChave} e se a API esta ativa na conta.`;
  if (s === 429) return `${nome}: limite de uso atingido. Espere um pouco e tente de novo.`;
  if (s >= 500) return `${nome} esta instavel agora (HTTP ${s}). Tente de novo em instantes.`;
  if (err && err.formato) return `${nome} respondeu fora do formato esperado. Tente de novo.`;
  return `${nome}: ${String((err && err.message) || err).slice(0, 160)}`;
}

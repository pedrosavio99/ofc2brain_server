// Embeddings via Gemini (text-embedding-004), 768 dimensoes.
//
// Por que mudou (era @xenova/transformers local, 384 dims):
// o modelo local pesava ~450MB e rodava dentro do processo, mantido quente
// em RAM. Isso e incompativel com funcao serverless na Vercel (limite de
// tamanho, cold start recarregando o modelo, /tmp efemero). Trocamos por
// uma chamada HTTP stateless ao Gemini, que ja usamos no resto do app.
//
// IMPORTANTE: mudou a dimensao (384 -> 768) e o espaco vetorial. Todos os
// embeddings antigos precisam ser regerados (o seed faz isso de uma vez).
//
// Config no .env:
//   GEMINI_API_KEYS   chaves separadas por virgula (rodizio simples aqui)
//   GEMINI_API_KEY    chave unica (fallback)
//   MODELO_EMBEDDING  padrao "text-embedding-004"

import { GoogleGenAI } from "@google/genai";
import { listaChaves } from "./geminiClient.js";

export const MODELO_EMBEDDING =
  process.env.MODELO_EMBEDDING || "text-embedding-004";

export const DIMENSOES_EMBEDDING = 768;

const clientes = new Map(); // chave -> instancia do SDK

function getCliente(chave) {
  if (!clientes.has(chave)) clientes.set(chave, new GoogleGenAI({ apiKey: chave }));
  return clientes.get(chave);
}

// O SDK novo varia um pouco o formato da resposta entre versoes; cobrimos os
// casos conhecidos e falhamos claro se nenhum bater.
function extrairVetor(resp) {
  if (!resp) return null;
  if (Array.isArray(resp.embeddings) && resp.embeddings[0]?.values) {
    return resp.embeddings[0].values;
  }
  if (resp.embedding?.values) return resp.embedding.values;
  if (Array.isArray(resp.embedding)) return resp.embedding;
  return null;
}

/**
 * Varios embeddings numa UNICA requisicao (o embedContent aceita lista).
 * A conversa reescreve a pergunta em 2 ou 3 consultas por turno; uma ida por
 * consulta triplicaria a latencia e a cota de requisicoes, que e o que aperta
 * primeiro no plano gratuito.
 *
 * Mesma ordem da entrada. Lista com textos vazios devolve null nessas posicoes.
 * Se o lote falhar, cai pro caminho de um por um (gerarEmbedding).
 * @param {string[]} textos
 * @returns {Promise<(number[]|null)[]>}
 */
export async function gerarEmbeddings(textos) {
  const entradas = (Array.isArray(textos) ? textos : []).map((t) => String(t ?? "").trim());
  const validos = entradas.map((t, i) => ({ t, i })).filter((x) => x.t);
  const saida = entradas.map(() => null);
  if (!validos.length) return saida;
  if (validos.length === 1) {
    saida[validos[0].i] = await gerarEmbedding(validos[0].t);
    return saida;
  }

  const chaves = listaChaves();
  if (chaves.length === 0) throw new Error("Sem GEMINI_API_KEY(S): embedding indisponivel.");

  for (const chave of chaves) {
    try {
      const resp = await getCliente(chave).models.embedContent({
        model: MODELO_EMBEDDING,
        contents: validos.map((x) => x.t),
        config: { outputDimensionality: 768 },
      });
      const lista = Array.isArray(resp?.embeddings) ? resp.embeddings : [];
      if (lista.length === validos.length && lista.every((e) => e?.values?.length)) {
        validos.forEach((x, n) => { saida[x.i] = Array.from(lista[n].values); });
        return saida;
      }
    } catch {
      // tenta a proxima chave; no fim cai pro caminho individual
    }
  }
  // lote recusado em todas as chaves: um por um, em paralelo
  const individuais = await Promise.all(validos.map((x) => gerarEmbedding(x.t)));
  validos.forEach((x, n) => { saida[x.i] = individuais[n]; });
  return saida;
}

/**
 * Gera o embedding de um texto via Gemini. Tenta as chaves em ordem;
 * se uma falhar (cota/erro), cai pra proxima.
 * @param {string} texto
 * @returns {Promise<number[]>} vetor de 768 posicoes
 */
export async function gerarEmbedding(texto) {
  const entrada = String(texto ?? "").trim();
  if (!entrada) throw new Error("texto vazio para embedding");

  const chaves = listaChaves();
  if (chaves.length === 0) {
    throw new Error("Sem GEMINI_API_KEY(S): embedding indisponivel.");
  }

  let ultimoErro = null;
  for (const chave of chaves) {
    try {
      const ai = getCliente(chave);
      const resp = await ai.models.embedContent({
        model: MODELO_EMBEDDING,
        contents: entrada,
        config: { outputDimensionality: 768 },
      });
      const vetor = extrairVetor(resp);
      if (!vetor || vetor.length === 0) {
        throw new Error("resposta do Gemini sem vetor de embedding");
      }
      return Array.from(vetor);
    } catch (err) {
      ultimoErro = err;
      // tenta a proxima chave
    }
  }
  throw new Error(`Falha ao gerar embedding: ${ultimoErro?.message || "erro desconhecido"}`);
}

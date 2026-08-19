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

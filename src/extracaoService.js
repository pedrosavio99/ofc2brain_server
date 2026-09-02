// Garimpo: recebe um texto bruto (artigo, transcricao, despejo mental) e
// devolve CANDIDATAS a nota. Nao salva nada.
//
// Por que so candidatas: quem decide o que entra no cerebro e a pessoa. O
// salvamento acontece depois, item por item, pela rota POST /ideias que ja
// existe. Assim cada nota nova passa pelo mesmo pipeline (embedding + LLM +
// ligacoes) e ja enxerga as anteriores do mesmo lote como candidatas a ligacao.
//
// Custo desta rota: 1 chamada de LLM (a extracao) + 1 embedding por candidata
// (o detector de duplicata). Nenhuma escrita no banco.

import * as db from "./db.js";
import { gerarJSON, temGemini } from "./geminiClient.js";
import { chatJSON } from "./groqClient.js";
import { gerarEmbedding } from "./embeddings.js";

// Teto de entrada. Acima disso a qualidade da extracao cai (o modelo comeca a
// resumir o texto em vez de garimpar) e o custo por chamada dispara.
export const LIMITE_CARACTERES = 20000;
const MINIMO_CARACTERES = 40;

// Acima deste score, a candidata e tratada como coisa que voce ja tem.
const LIMIAR_DUPLICATA = 0.75;

// Quantos embeddings de duplicata rodam ao mesmo tempo. Alto demais derruba a
// cota do Gemini por minuto; 1 de cada vez deixa a tela lenta.
const CONCORRENCIA = 4;

const SYSTEM_PROMPT_EXTRACAO = `Voce garimpa ideias dentro de um texto bruto (artigo, transcricao de reuniao, despejo mental)
para alimentar a base de conhecimento pessoal de alguem (um "segundo cerebro").

Regras, sem excecao:
- Cada ideia precisa ser AUTOSSUFICIENTE: legivel daqui a um ano, sozinha, sem o texto original ao lado.
  Proibido item do tipo "ele discordou disso" ou "essa parte e importante": diga quem, o que, e por que.
- Extraia APENAS o que esta no texto. Nunca invente, nunca complete com conhecimento seu, nunca
  generalize alem do que foi escrito.
- Preserve os termos, nomes, numeros e o jeito de falar do autor. Reescreva so o minimo necessario
  para a frase ficar de pe sozinha.
- Uma ideia por item (atomica). Se um paragrafo carrega duas afirmacoes independentes, sao dois itens.
- Descarte saudacao, transicao, repeticao, piada solta e trecho que so organiza o texto
  ("como eu disse antes", "vamos ao proximo ponto").
- "trecho" e um pedaco LITERAL do texto original de onde a ideia saiu (ate 200 caracteres, copiado igual,
  sem reescrever). Serve para a pessoa conferir se voce nao alucinou. Se nao conseguir copiar um trecho
  literal, nao inclua a ideia.
- Nao encha a lista. Se o texto so tem 3 ideias de verdade, devolva 3. Inventar item para chegar ao
  maximo e considerado falha sua.
- "area": uma palavra em minusculas, reutilizavel entre notas (ex: "negocios", "produtividade", "biologia").
- "tipo": "ideia" (insight solto), "conceito" (definicao/teoria estruturada) ou "lembrete_evento" (tem data/compromisso).
- "data_evento": so quando tipo for "lembrete_evento", no formato YYYY-MM-DD, calculado a partir da data de
  hoje informada. Caso contrario, null.
- "forca": 1 a 5. Quanto essa ideia merece virar nota permanente (5 = vale muito, 1 = marginal).

Responda SOMENTE com JSON:
{
  "ideias": [
    {
      "resumo": string,        // uma linha, o titulo da nota
      "texto": string,         // a nota em si, autossuficiente, 1 a 4 frases
      "area": string,
      "tags": string[],        // 1 a 5
      "tipo": "ideia" | "conceito" | "lembrete_evento",
      "data_evento": string | null,
      "trecho": string,        // literal do texto original
      "forca": number
    }
  ]
}`;

function limparTexto(t) {
  return String(t == null ? "" : t).trim();
}

/** Confere se o trecho citado existe mesmo no texto original (anti-alucinacao). */
function normalizarParaComparar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trechoConfere(trecho, textoFonte) {
  const t = normalizarParaComparar(trecho);
  if (t.length < 12) return false;
  return normalizarParaComparar(textoFonte).includes(t);
}

/** Roda uma funcao assincrona sobre a lista com um teto de paralelismo. */
async function emLotes(itens, limite, fn) {
  const saida = new Array(itens.length);
  let cursor = 0;
  const trabalhador = async () => {
    while (cursor < itens.length) {
      const meu = cursor++;
      saida[meu] = await fn(itens[meu], meu);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, trabalhador)
  );
  return saida;
}

/**
 * Extrai candidatas a nota de um texto bruto.
 * @param {string} texto
 * @param {object} opcoes { maximo = 12 }
 * @returns {Promise<{ candidatas: object[], truncado: boolean, caracteres: number, maximo: number }>}
 */
export async function extrairIdeias(texto, { maximo = 12 } = {}) {
  const bruto = limparTexto(texto);
  if (bruto.length < MINIMO_CARACTERES) {
    throw new Error(
      `Texto curto demais para garimpar (minimo ${MINIMO_CARACTERES} caracteres). Para uma ideia so, use o campo de guardar nota.`
    );
  }

  const truncado = bruto.length > LIMITE_CARACTERES;
  const fonte = truncado ? bruto.slice(0, LIMITE_CARACTERES) : bruto;
  const teto = Math.max(1, Math.min(Number(maximo) || 12, 25));

  const hojeISO = new Date().toISOString().slice(0, 10);
  const prompt = `Data de hoje: ${hojeISO}
Maximo de ideias: ${teto}

Texto bruto:
"""
${fonte}
"""`;

  // Gemini primeiro: texto longo e onde ele ganha do modelo pequeno da Groq.
  let dados = null;
  if (temGemini()) {
    try {
      dados = await gerarJSON(SYSTEM_PROMPT_EXTRACAO, prompt, {
        temperatura: 0.4,
        maxTokens: 8192,
      });
      console.log("[garimpo] extracao feita pelo Gemini.");
    } catch (err) {
      console.error("[garimpo] Gemini falhou, caindo no Groq:", err.message);
    }
  }
  if (!dados) {
    dados = await chatJSON(SYSTEM_PROMPT_EXTRACAO, prompt);
    console.log("[garimpo] extracao feita pelo Groq.");
  }

  const cruas = Array.isArray(dados?.ideias) ? dados.ideias : [];

  // Higiene do que o modelo devolveu: sem texto nao ha nota; trecho que nao
  // existe no original vira null em vez de virar prova falsa.
  const vistos = new Set();
  const candidatas = [];
  for (const c of cruas) {
    const textoNota = limparTexto(c?.texto);
    if (textoNota.length < 15) continue;
    const chave = normalizarParaComparar(textoNota).slice(0, 120);
    if (vistos.has(chave)) continue; // o proprio modelo repetindo uma ideia
    vistos.add(chave);

    const trecho = limparTexto(c?.trecho);
    candidatas.push({
      indice: candidatas.length,
      resumo: limparTexto(c?.resumo) || textoNota.slice(0, 90),
      texto: textoNota,
      area: limparTexto(c?.area).toLowerCase() || null,
      tags: Array.isArray(c?.tags) ? c.tags.filter(Boolean).slice(0, 5) : [],
      tipo: ["ideia", "conceito", "lembrete_evento"].includes(c?.tipo) ? c.tipo : "ideia",
      data_evento: c?.tipo === "lembrete_evento" ? c?.data_evento || null : null,
      trecho: trecho && trechoConfere(trecho, fonte) ? trecho : null,
      forca: Number(c?.forca) >= 1 && Number(c?.forca) <= 5 ? Number(c.forca) : 3,
      duplicata: null,
    });
    if (candidatas.length >= teto) break;
  }

  // Detector de duplicata: 1 embedding por candidata + busca vetorial. E o que
  // impede o garimpo de encher a base de quase-clones e estragar o grafo.
  await emLotes(candidatas, CONCORRENCIA, async (c) => {
    try {
      const emb = await gerarEmbedding(c.texto);
      const achados = await db.topKSimilares(emb, { k: 1, piso: LIMIAR_DUPLICATA });
      if (!achados.length) return;
      const nota = await db.buscarPorId(achados[0].id);
      if (!nota) return;
      c.duplicata = {
        id: nota.id,
        resumo: nota.resumo || String(nota.texto_original || "").slice(0, 120),
        area: nota.area || null,
        score: Number(achados[0].score.toFixed(4)),
      };
    } catch (err) {
      // Sem duplicata detectada nao e erro fatal: a pessoa ainda decide.
      console.error("[garimpo] checagem de duplicata falhou:", err.message);
    }
  });

  return {
    candidatas,
    truncado,
    caracteres: bruto.length,
    limite: LIMITE_CARACTERES,
    maximo: teto,
  };
}
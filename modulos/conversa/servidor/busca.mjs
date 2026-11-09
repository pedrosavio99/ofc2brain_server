/**
 * Busca nas NOTAS: hibrida, multi-consulta e com reranking.
 *
 * O que havia antes: um embedding do texto cru da ultima mensagem, e um corte
 * fixo de 0.42 pra decidir o que "falava do assunto". Tres defeitos:
 *   1. "e sobre isso?" vira um vetor sem sentido (a pergunta nao se basta);
 *   2. so por significado: nome proprio, sigla e termo raro nao casam;
 *   3. o 0.42 foi calibrado pro text-embedding-004; o app roda
 *      gemini-embedding-001, que tem outra escala de cosseno.
 *
 * Aqui:
 *   - consultas multiplas (reescritas pelo planejador), uma ida de embedding so;
 *   - busca por significado + por palavra fundidas por RRF, no banco;
 *   - reranking por CONTEUDO (um modelo le os candidatos e da nota 0 a 3), que
 *     e o que decide forte vs tangente, no lugar do limiar fixo;
 *   - sem reranking (falhou, ou poucos candidatos): corte RELATIVO ao melhor
 *     score, que sobrevive a troca de modelo de embedding.
 *   - sem o SQL novo: cai no caminho de antes (so significado), sem quebrar.
 */
import * as db from "../../../src/db.js";
import { chamarRpc } from "./banco.mjs";
import { chatJSONDetalhado } from "../../../src/groqClient.js";

const K_BUSCA = 30;
const MAX_PARA_RERANK = 20;
const TETO_RERANK_MS = Number(process.env.TETO_RERANK_MS) || 6000;
const RRF_K = 60;

/* Piso absoluto e folga do corte RELATIVO. So valem quando nao ha reranking.
   Calibre com scripts/calibrar-conversa.mjs; o padrao e conservador. */
const PISO_SIM = Number(process.env.CONVERSA_PISO_SIM) || 0.5;
const FOLGA_SIM = Number(process.env.CONVERSA_FOLGA_SIM) || 0.1;

/* ------------------------------------------------------------ tsquery */

/* Palavras que nao ajudam a achar nota. O `portuguese` do Postgres ja tira
   stopword, mas com OR entre os termos, "para" casaria com tudo. */
const STOP = new Set((
  "a o as os um uma uns umas de do da dos das em no na nos nas e ou que qual quais como quando onde porque " +
  "eu voce vc me mim meu minha meus minhas teu tua seu sua nosso nossa ele ela eles elas isso isto esse essa " +
  "esses essas aquilo aquele aquela pra para por com sem sobre entre ate mais menos muito muita muitos pouco " +
  "ser estar ter tinha tenho tem foi era sao esta estou fui vou vai fazer fiz faz feito ja ainda tambem so " +
  "nota notas anotei anotacao escrevi falei disse falou coisa coisas algo alguma algum nada tudo hoje ontem " +
  "agora entao ai la aqui bem mal sim nao ok blz"
).split(" "));

/**
 * Textos de busca -> consulta tsquery com OR, so com termos uteis. Pura.
 * OR e nao AND: a pergunta reescrita e longa, e exigir TODAS as palavras
 * quase nunca casa. Quem ordena depois e o ts_rank (mais termos, mais alto).
 * Devolve null quando nao sobra termo (a parte por palavra e desligada).
 */
export function montarTsQuery(textos, maxTermos = 12) {
  const termos = [];
  const vistos = new Set();
  for (const t of Array.isArray(textos) ? textos : [textos]) {
    const limpo = String(t || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]+/g, " ");
    for (const w of limpo.split(/\s+/)) {
      // so [a-z0-9]: nada que o parser de tsquery possa interpretar como sintaxe
      if (w.length < 3 || STOP.has(w) || vistos.has(w) || !/^[a-z0-9]+$/.test(w)) continue;
      vistos.add(w);
      termos.push(w);
      if (termos.length >= maxTermos) return termos.join(" | ");
    }
  }
  return termos.length ? termos.join(" | ") : null;
}

/* -------------------------------------------------------------- fusao */

/**
 * Funde varias listas ordenadas (uma por consulta) numa so, por RRF. Pura.
 * Nota que aparece bem em mais de uma consulta sobe: e o sinal de que ela
 * responde ao assunto e nao a uma formulacao especifica.
 */
export function fundirConsultas(listas, k = MAX_PARA_RERANK) {
  const mapa = new Map();
  for (const lista of listas) {
    lista.forEach((n, i) => {
      const atual = mapa.get(n.id);
      const pontos = 1 / (RRF_K + i + 1);
      if (!atual) {
        mapa.set(n.id, { ...n, pontos, sim: Number(n.sim) || 0 });
      } else {
        atual.pontos += pontos;
        atual.sim = Math.max(atual.sim, Number(n.sim) || 0);
        if (n.lex_rank != null) atual.lex_rank = atual.lex_rank == null ? n.lex_rank : Math.min(atual.lex_rank, n.lex_rank);
      }
    });
  }
  return [...mapa.values()].sort((a, b) => b.pontos - a.pontos).slice(0, k);
}

/* ------------------------------------------------------ classificacao */

/**
 * Sem reranking: forte = perto do MELHOR score (corte relativo) ou achado por
 * palavra com ranking alto. Relativo porque o cosseno absoluto muda de modelo
 * pra modelo; "perto do melhor" nao. Pura.
 */
export function separarSemRerank(cands, { piso = PISO_SIM, folga = FOLGA_SIM, maxFortes = 10, maxFracas = 3 } = {}) {
  const lista = Array.isArray(cands) ? cands : [];
  if (!lista.length) return { fortes: [], fracas: [] };
  const topo = Math.max(...lista.map((n) => Number(n.sim) || 0));
  const corte = Math.max(piso, topo - folga);
  const ehForte = (n) => (Number(n.sim) || 0) >= corte || (n.lex_rank != null && n.lex_rank <= 5 && (Number(n.sim) || 0) >= piso - 0.1);
  const fortes = lista.filter(ehForte).slice(0, maxFortes);
  const idsFortes = new Set(fortes.map((n) => n.id));
  const fracas = lista.filter((n) => !idsFortes.has(n.id) && (Number(n.sim) || 0) >= piso - 0.05).slice(0, maxFracas);
  return { fortes, fracas };
}

/**
 * Com reranking: a nota de relevancia (0 a 3) do modelo decide.
 * 2 e 3 = forte, 1 = tangente, 0 = descartada. Pura.
 */
export function separarComRerank(cands, notas, { maxFortes = 10, maxFracas = 3 } = {}) {
  const com = cands.map((n, i) => ({ ...n, relevancia: notas.get(i + 1) ?? 0 }));
  const ordena = (a, b) => b.relevancia - a.relevancia || b.pontos - a.pontos;
  return {
    fortes: com.filter((n) => n.relevancia >= 2).sort(ordena).slice(0, maxFortes),
    fracas: com.filter((n) => n.relevancia === 1).sort(ordena).slice(0, maxFracas),
  };
}

/**
 * Le a saida do reranker. Devolve Map(indice 1-based -> 0..3) ou null se a
 * saida nao e confiavel (cobriu menos da metade dos candidatos). Pura.
 */
export function lerRerank(bruto, total) {
  const lista = bruto && Array.isArray(bruto.r) ? bruto.r : [];
  const mapa = new Map();
  for (const x of lista) {
    const i = Number(x && x.i), n = Number(x && x.n);
    if (Number.isInteger(i) && i >= 1 && i <= total && Number.isFinite(n)) mapa.set(i, Math.max(0, Math.min(3, Math.round(n))));
  }
  return mapa.size >= Math.ceil(total / 2) ? mapa : null;
}

const SISTEMA_RERANK = `Você avalia quais notas de uma pessoa são relevantes para a pergunta dela.

Para cada nota dê uma relevância de 0 a 3:
3 = fala diretamente do assunto da pergunta
2 = é relacionada e ajuda a responder
1 = só tangencia (mesmo tema amplo, mas não ajuda de verdade)
0 = não tem a ver

Julgue pelo CONTEÚDO, não por palavras repetidas. Uma nota que menciona a mesma palavra em outro contexto vale 0 ou 1.

Responda SOMENTE com JSON: {"r":[{"i":1,"n":3},{"i":2,"n":0}]}`;

async function rerankear(pergunta, cands) {
  const linhas = cands.map((n, i) =>
    `[${i + 1}] (${String(n.criado_em || "").slice(0, 10)}, ${n.area || "sem área"}) ${n.resumo || ""} — ${String(n.texto_original || "").replace(/\s+/g, " ").slice(0, 220)}`
  ).join("\n");
  const chamada = chatJSONDetalhado(SISTEMA_RERANK,
    `Pergunta da pessoa:\n"""\n${pergunta.slice(0, 500)}\n"""\n\nNotas candidatas:\n${linhas}`,
    {
      modelo: process.env.GROQ_MODEL_RERANK || process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
      temperatura: 0, raciocinio: "low", tentativas: 1,
    });
  const r = await Promise.race([
    chamada,
    new Promise((_, rej) => setTimeout(() => rej(new Error("rerank demorou")), TETO_RERANK_MS)),
  ]);
  return lerRerank(r && r.dados, cands.length);
}

/* ------------------------------------------------------------ banco */

/* Lembra se o SQL novo existe. Sem isto, cada turno gastaria uma ida ao banco
   so pra descobrir de novo que a funcao nao esta la. Rechecado de tempos em
   tempos: voce roda o SQL e o app passa a usar sem reiniciar. */
const estado = { hibrido: null, desde: 0 };
const RECHECAR_MS = 5 * 60 * 1000;

export function hibridoDisponivel() {
  if (estado.hibrido === false && Date.now() - estado.desde > RECHECAR_MS) estado.hibrido = null;
  return estado.hibrido !== false;
}

const literal = (v) => "[" + v.map(Number).join(",") + "]";

function paraNota(r) {
  return {
    id: r.id, resumo: r.resumo, texto_original: r.texto_original, area: r.area, tags: r.tags || [],
    tipo: r.tipo, data_evento: r.data_evento, criado_em: r.criado_em,
    sim: Number(r.sim) || 0, lex_rank: r.lex_rank == null ? null : Number(r.lex_rank),
  };
}

async function buscarUma(texto, vetor, k) {
  if (hibridoDisponivel()) {
    try {
      const linhas = await chamarRpc("buscar_notas_hibrido", {
        q_lex: montarTsQuery([texto]),
        q_emb: vetor ? literal(vetor) : null,
        k,
      });
      estado.hibrido = true;
      return { notas: (linhas || []).map(paraNota), hibrido: true };
    } catch (e) {
      if (!e.faltaFuncao) throw e;
      estado.hibrido = false; estado.desde = Date.now();
      console.warn("[conversa] buscar_notas_hibrido nao existe: rode supabase/conversa-v2.sql. Usando so significado.");
    }
  }
  // plano B: o caminho de antes (so por significado)
  if (!vetor) return { notas: [], hibrido: false };
  const ranking = await db.topKSimilares(vetor, { k, piso: 0 });
  const notas = await db.buscarVariasResumidas(ranking.map((r) => r.id));
  const porId = new Map(notas.map((n) => [n.id, n]));
  return {
    notas: ranking.map((r) => (porId.has(r.id) ? { ...paraNota(porId.get(r.id)), sim: r.score, lex_rank: null } : null)).filter(Boolean),
    hibrido: false,
  };
}

/**
 * Busca de notas completa.
 * @param {object} p
 * @param {string[]} p.consultas  consultas reescritas pelo planejador
 * @param {string}   p.pergunta   a pergunta autossuficiente (usada no rerank)
 * @param {(textos:string[])=>Promise<(number[]|null)[]>} p.embed  embeddings (com cache do turno)
 * @returns {Promise<{fortes:object[], fracas:object[], total:number, rerank:boolean, hibrido:boolean}>}
 */
export async function buscarNotas({ consultas = [], pergunta = "", embed, k = K_BUSCA, rerank = true }) {
  const textos = [...new Set([...consultas, ...(consultas.length ? [] : [pergunta])].map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 3);
  if (!textos.length) return { fortes: [], fracas: [], total: 0, rerank: false, hibrido: hibridoDisponivel() };

  let vetores = textos.map(() => null);
  try { vetores = await embed(textos); } catch (e) {
    console.warn("[conversa] embedding falhou, busca so por palavra: " + e.message);
  }

  const partes = await Promise.all(textos.map((t, i) => buscarUma(t, vetores[i], k)));
  const cands = fundirConsultas(partes.map((p) => p.notas), MAX_PARA_RERANK);
  const hibrido = partes.some((p) => p.hibrido);
  if (!cands.length) return { fortes: [], fracas: [], total: 0, rerank: false, hibrido };

  let sep = null;
  let usouRerank = false;
  if (rerank && cands.length >= 5) {
    try {
      const notas = await rerankear(pergunta || textos[0], cands);
      if (notas) { sep = separarComRerank(cands, notas); usouRerank = true; }
    } catch (e) {
      console.warn("[conversa] rerank falhou, corte relativo: " + e.message);
    }
  }
  if (!sep) sep = separarSemRerank(cands);
  return { ...sep, total: cands.length, rerank: usouRerank, hibrido };
}

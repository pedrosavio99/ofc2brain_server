/**
 * Atividade lancada na mao: "corri 30 min", "joguei bola", "jiu-jitsu 1h".
 *
 * A IA NAO e o primeiro caminho aqui, de proposito. Caminhada, corrida e bike
 * tem MET tabelado no Compendium of Physical Activities, e chamar modelo pra
 * saber que caminhada e 3,5 gasta tempo e chamada a toa, e ainda arrisca vir
 * numero diferente a cada vez. A tabela decide o caso comum; a Groq entra so
 * quando a atividade nao esta nela.
 *
 * Tudo que nao precisa de rede e puro e testavel.
 */
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { metValido } from "./calorias.mjs";

/* MET do Compendium. Cada entrada tem os termos que costumam aparecer quando
   a pessoa escreve rapido, sem acento e abreviando. */
export const TABELA = [
  { nome: "Caminhada",        met: 3.5,  termos: ["caminhada", "caminhei", "caminhar", "andei", "andar"] },
  { nome: "Caminhada rápida", met: 4.3,  termos: ["caminhada rapida", "caminhada acelerada"] },
  { nome: "Corrida leve",     met: 7.0,  termos: ["corri", "corrida", "correr", "trote", "jogging"] },
  { nome: "Corrida forte",    met: 11.0, termos: ["corrida forte", "corrida rapida", "sprint", "tiro"] },
  { nome: "Bicicleta",        met: 6.8,  termos: ["bike", "bicicleta", "pedal", "pedalei", "ciclismo"] },
  { nome: "Natação",          met: 7.0,  termos: ["natacao", "nadei", "nadar", "piscina"] },
  { nome: "Futebol",          met: 7.0,  termos: ["futebol", "bola", "society", "futsal", "pelada"] },
  { nome: "Jiu-jitsu",        met: 10.3, termos: ["jiu", "jiujitsu", "jiu-jitsu", "jits", "luta", "grappling"] },
  { nome: "Musculação",       met: 5.0,  termos: ["musculacao", "academia", "pesos", "treino de forca"] },
  { nome: "Corda",            met: 10.0, termos: ["corda", "pular corda"] },
  { nome: "Escada",           met: 8.0,  termos: ["escada", "escadas"] },
  { nome: "Alongamento",      met: 2.3,  termos: ["alongamento", "alonguei", "mobilidade"] },
  { nome: "Yoga",             met: 3.0,  termos: ["yoga", "ioga"] },
  { nome: "Caminhada de cão", met: 3.0,  termos: ["passear com", "cachorro", "cao"] },
  { nome: "Dança",            met: 5.5,  termos: ["danca", "dancei", "forro", "zumba"] },
  { nome: "Vôlei",            met: 4.0,  termos: ["volei", "voleibol"] },
  { nome: "Basquete",         met: 6.5,  termos: ["basquete", "basket"] },
  { nome: "Tênis",            met: 7.3,  termos: ["tenis", "beach tennis", "padel"] },
  { nome: "Faxina pesada",    met: 3.8,  termos: ["faxina", "limpeza", "arrumei a casa"] },
];

export function normalizar(t) {
  return String(t || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Acha a atividade na tabela. Puro.
 *
 * Termo mais LONGO primeiro: "corrida forte" tem que ganhar de "corrida",
 * senao toda corrida forte viraria corrida leve e o MET sairia 4 pontos abaixo.
 */
export function acharNaTabela(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  let melhor = null;
  for (const item of TABELA) {
    for (const termo of item.termos) {
      if (t.includes(normalizar(termo)) && (!melhor || termo.length > melhor.termo.length)) {
        melhor = { ...item, termo, fonte: "tabela" };
      }
    }
  }
  return melhor;
}

/**
 * Tira a duracao do texto. Puro.
 * Entende "30 min", "30min", "1h", "1h30".
 */
export function duracaoDoTexto(texto) {
  const t = normalizar(texto);
  const hm = t.match(/(\d{1,2})\s*h(?:oras?)?\s*(\d{1,2})?/);
  if (hm) return Number(hm[1]) * 60 + (Number(hm[2]) || 0);
  const m = t.match(/(\d{1,3})\s*(?:min|minutos?|m)\b/);
  if (m) return Number(m[1]);
  return null;
}

const SISTEMA = `Voce classifica atividade fisica. Responde SOMENTE JSON.

Dado o que a pessoa escreveu, diga o nome limpo da atividade e o MET dela,
segundo o Compendium of Physical Activities.

Referencia: caminhada 3,5 | musculacao 5 | bike 6,8 | corrida leve 7 |
futebol 7 | corda 10 | jiu-jitsu 10,3 | corrida forte 11.
Quase nada passa de 12. Nao invente valor alto.

{"nome":"...","met":0.0}`;

/**
 * O rascunho da atividade. Tabela primeiro, Groq so no que sobrar.
 * NUNCA lanca: falha vira MET padrao, que voce corrige na tela.
 */
export async function analisarAtividade(texto) {
  const limpo = String(texto || "").trim().slice(0, 200);
  if (!limpo) return { rascunho: null, fonte: "nenhuma", erro: "Escreva o que voce fez." };

  const duracao = duracaoDoTexto(limpo);
  const naTabela = acharNaTabela(limpo);

  if (naTabela) {
    return {
      rascunho: { nome: naTabela.nome, met: naTabela.met, duracao_min: duracao },
      fonte: "tabela",
      erro: "",
    };
  }

  try {
    const r = await chatJSONDetalhado(SISTEMA, `A pessoa escreveu: "${limpo}"`, {
      modelo: process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant",
      temperatura: 0.2,
      tentativas: 2,
    });
    const d = (r && r.dados) || {};
    return {
      rascunho: {
        nome: String(d.nome || limpo).trim().slice(0, 80),
        // teto de 14: acima disso e atleta de elite, nao treino em casa
        met: Math.min(metValido(d.met), 14),
        duracao_min: duracao,
      },
      fonte: "ia",
      erro: "",
    };
  } catch (e) {
    return {
      rascunho: { nome: limpo.slice(0, 80), met: 4.0, duracao_min: duracao },
      fonte: "padrao",
      erro: String(e && e.message ? e.message : e).slice(0, 120),
    };
  }
}

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
  { nome: "Caminhada",        met: 3.5,  padrao: 30, termos: ["caminhada", "caminhei", "caminhar", "andei", "andar"] },
  { nome: "Caminhada rápida", met: 4.3,  padrao: 30, termos: ["caminhada rapida", "caminhada acelerada"] },
  { nome: "Corrida leve",     met: 7.0,  padrao: 30, termos: ["corri", "corrida", "correr", "trote", "jogging"] },
  { nome: "Corrida forte",    met: 11.0, padrao: 20, termos: ["corrida forte", "corrida rapida", "sprint", "tiro"] },
  { nome: "Bicicleta",        met: 6.8,  padrao: 40, termos: ["bike", "bicicleta", "pedal", "pedalei", "ciclismo"] },
  { nome: "Natação",          met: 7.0,  padrao: 40, termos: ["natacao", "nadei", "nadar", "piscina"] },
  { nome: "Futebol",          met: 7.0,  padrao: 60, termos: ["futebol", "bola", "society", "futsal", "pelada"] },
  { nome: "Jiu-jitsu",        met: 10.3, padrao: 60, termos: ["jiu", "jiujitsu", "jiu jitsu", "jits", "grappling"] },
  { nome: "Musculação",       met: 5.0,  padrao: 45, termos: ["musculacao", "academia", "pesos", "treino de forca"] },
  { nome: "Corda",            met: 10.0, padrao: 15, termos: ["corda", "pular corda"] },
  { nome: "Escada",           met: 8.0,  padrao: 15, termos: ["escada", "escadas"] },
  { nome: "Alongamento",      met: 2.3,  padrao: 15, termos: ["alongamento", "alonguei", "mobilidade"] },
  { nome: "Yoga",             met: 3.0,  padrao: 40, termos: ["yoga", "ioga"] },
  { nome: "Caminhada de cão", met: 3.0,  padrao: 30, termos: ["passear com o cachorro", "cachorro", "cadela"] },
  { nome: "Dança",            met: 5.5,  padrao: 45, termos: ["danca", "dancei", "forro", "zumba"] },
  { nome: "Vôlei",            met: 4.0,  padrao: 60, termos: ["volei", "voleibol"] },
  { nome: "Basquete",         met: 6.5,  padrao: 60, termos: ["basquete", "basket"] },
  { nome: "Tênis",            met: 7.3,  padrao: 60, termos: ["tenis", "beach tennis", "padel"] },
  { nome: "Faxina pesada",    met: 3.8,  padrao: 45, termos: ["faxina", "limpeza", "arrumei a casa"] },
];

export function normalizar(t) {
  return String(t || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * O termo aparece como PALAVRA, nao como pedaco de palavra? Puro.
 *
 * Isto existe por causa de um bug de verdade: com includes() cru,
 * "elevacao lateral halteres" casava com o termo "cao", porque a palavra
 * elevaCAO contem cao. A atividade virava "Caminhada de cão".
 *
 * Substring nunca serve pra casar palavra curta. Aqui a borda e exigida nos
 * dois lados, e o termo pode ter espaco ("pular corda").
 */
export function palavraInteira(texto, termo) {
  const t = normalizar(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!t) return false;
  return new RegExp("(^|\\s)" + t + "($|\\s)").test(texto);
}

/**
 * Acha a atividade na tabela. Puro. null quando nao tem certeza.
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
      if (palavraInteira(t, termo) && (!melhor || termo.length > melhor.termo.length)) {
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

Diga tres coisas: o nome limpo, o MET e quantos minutos aquilo costuma levar.

MET, segundo o Compendium of Physical Activities:
caminhada 3,5 | musculacao 5 | bike 6,8 | corrida leve 7 | futebol 7 |
corda 10 | jiu-jitsu 10,3 | corrida forte 11.
Quase nada passa de 12. Nao invente valor alto.

EXERCICIO DE MUSCULACAO (elevacao lateral, rosca, agachamento, supino, remada,
stiff, desenvolvimento) fica entre 3,5 e 6 conforme o peso e o ritmo. Escreva o
nome do jeito que se fala na academia.

Sobre duracao_min: se a pessoa disse o tempo, use o dela. Se ela disse so
repeticoes ("30x elevacao lateral"), estime quanto AQUELE exercicio leva, o que
costuma dar poucos minutos, nao a sessao inteira. Se nao deu pista nenhuma, use
a duracao tipica da atividade.

{"nome":"...","met":0.0,"duracao_min":0}`;

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
      rascunho: {
        nome: naTabela.nome,
        met: naTabela.met,
        // o texto manda; sem ele, a duracao tipica daquela atividade
        duracao_min: duracao || naTabela.padrao,
        duracao_fonte: duracao ? "texto" : "tipica",
      },
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
        // o texto manda; depois a estimativa do modelo; 30 e o ultimo recurso
        duracao_min: duracao || Math.min(Math.max(Math.round(Number(d.duracao_min) || 0), 1), 600) || 30,
        duracao_fonte: duracao ? "texto" : (Number(d.duracao_min) > 0 ? "estimada" : "chute"),
      },
      fonte: "ia",
      erro: "",
    };
  } catch (e) {
    return {
      rascunho: { nome: limpo.slice(0, 80), met: 4.0, duracao_min: duracao || 30,
        duracao_fonte: duracao ? "texto" : "chute" },
      fonte: "padrao",
      erro: String(e && e.message ? e.message : e).slice(0, 120),
    };
  }
}

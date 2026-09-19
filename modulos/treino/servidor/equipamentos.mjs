/**
 * Cadastro de equipamento, com a Groq preenchendo o rascunho.
 *
 * O fluxo: voce escreve o nome do aparelho, a IA rapida devolve um RASCUNHO
 * (resumo, pra que serve, como usar numa ficha, grupos musculares e MET), e a
 * tela mostra pra voce conferir ANTES de salvar. Nada vai pro banco sem o seu
 * ok.
 *
 * O MET e o numero que mais importa, porque ele entra na conta de caloria. E e
 * justamente o que o modelo rapido mais erra, com cara de certo: ele devolve
 * MET 15 pra um halter, que seria o mesmo gasto de corrida em velocidade.
 * Por isso existe a tabela de faixas abaixo. A IA sugere; a faixa decide.
 *
 * A parte pura (normalizar e ajustar) e testavel sem rede.
 */
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { MET_PADRAO, metValido } from "./calorias.mjs";

/* Faixas por tipo, do Compendium of Physical Activities. min, tipico, max.
   Nao e chute: musculacao com peso livre fica entre 3,5 e 6 conforme a
   intensidade; corda pula pra faixa de 8 a 12. */
export const TIPOS = {
  peso_livre:   { rotulo: "peso livre",      met: [3.5, 5.0, 6.0] },
  maquina:      { rotulo: "máquina",         met: [3.5, 4.5, 6.0] },
  elastico:     { rotulo: "elástico",        met: [3.0, 4.0, 5.0] },
  peso_corporal:{ rotulo: "peso do corpo",   met: [3.5, 5.0, 8.0] },
  kettlebell:   { rotulo: "kettlebell",      met: [5.0, 6.5, 9.0] },
  corda:        { rotulo: "corda",           met: [8.0, 10.0, 12.0] },
  esteira:      { rotulo: "esteira",         met: [5.0, 7.0, 12.0] },
  bike:         { rotulo: "bicicleta",       met: [4.0, 6.5, 10.0] },
  banco:        { rotulo: "banco/apoio",     met: [3.0, 3.5, 5.0] },
  outro:        { rotulo: "outro",           met: [2.5, 4.0, 8.0] },
};

export function tipoValido(t) {
  const k = String(t || "").toLowerCase().trim();
  return TIPOS[k] ? k : "outro";
}

/**
 * Puxa o MET pra faixa do tipo. Puro.
 * Devolve o valor e se precisou corrigir, pra tela poder avisar.
 */
export function ajustarMet(met, tipo) {
  const faixa = TIPOS[tipoValido(tipo)].met;
  const n = Number(met);
  if (!Number.isFinite(n) || n <= 0) return { met: faixa[1], corrigido: true, motivo: "sem valor" };
  if (n < faixa[0]) return { met: faixa[0], corrigido: true, motivo: `abaixo da faixa (${faixa[0]}–${faixa[2]})` };
  if (n > faixa[2]) return { met: faixa[2], corrigido: true, motivo: `acima da faixa (${faixa[0]}–${faixa[2]})` };
  return { met: Math.round(n * 10) / 10, corrigido: false, motivo: "" };
}

const GRUPOS = ["peito", "costas", "ombro", "biceps", "triceps", "perna",
  "gluteo", "panturrilha", "abdomen", "lombar", "cardio", "corpo inteiro"];

function limpar(v, max) {
  return String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);
}

/**
 * Poe o que o modelo devolveu em forma. Puro, entao da pra testar com saida
 * inventada sem gastar chamada.
 *
 * Nunca confia no que veio: grupo fora da lista some, texto gigante e cortado,
 * MET vai pra faixa. O que sobra e sempre salvavel.
 */
export function normalizarRascunho(cru, nomeDigitado) {
  const d = cru && typeof cru === "object" ? cru : {};
  const tipo = tipoValido(d.tipo);
  const met = ajustarMet(d.met, tipo);

  const grupos = Array.isArray(d.grupos)
    ? [...new Set(d.grupos.map((g) => String(g).toLowerCase().trim()).filter((g) => GRUPOS.includes(g)))].slice(0, 6)
    : [];

  return {
    nome: limpar(d.nome || nomeDigitado, 80) || limpar(nomeDigitado, 80),
    tipo,
    tipo_rotulo: TIPOS[tipo].rotulo,
    resumo: limpar(d.resumo, 300),
    como_usar: limpar(d.como_usar, 600),
    grupos,
    met: met.met,
    met_corrigido: met.corrigido,
    met_motivo: met.motivo,
    gerado_por_ia: 1,
  };
}

const SISTEMA = `Voce cataloga equipamento de treino em casa. Responde SOMENTE JSON.

Campos:
- nome: o nome do aparelho, limpo
- tipo: um de ${Object.keys(TIPOS).join(", ")}
- resumo: uma frase dizendo pra que serve
- como_usar: duas ou tres frases sobre como usar numa ficha de treino, com faixa de series e repeticoes tipica
- grupos: lista dos musculos, usando so estes: ${GRUPOS.join(", ")}
- met: o MET do exercicio tipico com esse aparelho, numero decimal

Sobre o met: e o multiplicador de gasto energetico do Compendium of Physical
Activities. Musculacao moderada fica perto de 5. Nao invente valor alto: corda
de pular fica em 10, corrida rapida em 12, e quase nada passa disso.

Se o nome for ambiguo, escolha a leitura mais comum em treino caseiro.

{"nome":"...","tipo":"...","resumo":"...","como_usar":"...","grupos":["..."],"met":0.0}`;

/**
 * Pede o rascunho pra IA rapida. NUNCA lanca: falha vira rascunho vazio, pra
 * voce preencher na mao. Cadastro de equipamento nao pode depender de modelo
 * estar no ar.
 *
 * @returns {Promise<{rascunho:object, fonte:string, erro:string}>}
 */
export async function analisarEquipamento(nome, observacao = "") {
  const limpo = limpar(nome, 80);
  if (!limpo) return { rascunho: null, fonte: "nenhuma", erro: "Informe o nome do equipamento." };

  try {
    const prompt = `Equipamento: "${limpo}"` +
      (observacao ? `\nObservacao de quem cadastrou: "${limpar(observacao, 200)}"` : "");
    const r = await chatJSONDetalhado(SISTEMA, prompt, {
      modelo: process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant",
      temperatura: 0.3,
      tentativas: 2,
    });
    return { rascunho: normalizarRascunho((r && r.dados) || {}, limpo), fonte: "ia", erro: "" };
  } catch (e) {
    /* Esqueleto em branco em vez de erro na cara: a IA aqui e conveniencia,
       nao requisito. Com o MET padrao a caloria ja fica conservadora. */
    return {
      rascunho: { ...normalizarRascunho({ met: MET_PADRAO }, limpo), gerado_por_ia: 0 },
      fonte: "manual",
      erro: String(e && e.message ? e.message : e).slice(0, 120),
    };
  }
}

export { metValido };

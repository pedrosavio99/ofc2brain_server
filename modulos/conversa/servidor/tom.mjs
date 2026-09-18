/**
 * A camada de TOM do modulo CONVERSA.
 *
 * O problema que ela resolve: existia um unico prompt, e ele mandava ter
 * opiniao e apontar contradicao. Isso e certo numa decisao e errado num
 * desabafo, entao a conversa inteira saia com o mesmo contraponto ironico,
 * independente do que a pessoa trouxe.
 *
 * Aqui um modelo pequeno le a mensagem, o historico curto e o que as notas
 * trouxeram, e escolhe DUAS coisas: o registro da resposta e o orcamento de
 * tamanho. Nada disso aparece na tela: o comportamento visivel e o mesmo,
 * so que o registro passa a caber no que foi pedido.
 *
 * Regra de ouro: esta camada NUNCA pode derrubar o turno. Se o classificador
 * falhar, a heuristica decide e a conversa segue.
 */

import { chatJSONDetalhado } from "../../../src/groqClient.js";

/* Orcamento de tokens. Nao e enfeite: com GEMINI_THINKING=HIGH o raciocinio
   gasta do MESMO teto da resposta, entao teto curto corta a resposta no meio.
   O valor fixo de 4096 que existia antes era o que fazia a resposta longa
   terminar cortada. Estes valores ja contam com o consumo do pensamento. */
export const ORCAMENTO = {
  minima: { tokens: 2048, instrucao: "Uma ou duas frases. Sem introducao, sem fecho." },
  curta:  { tokens: 3072, instrucao: "Um paragrafo curto. Va direto." },
  media:  { tokens: 5120, instrucao: "Dois a quatro paragrafos. Desenvolva o que precisa e pare." },
  longa:  { tokens: 8192, instrucao: "O quanto o assunto pedir. Pode passar de cinco paragrafos se houver o que dizer, mas nao encha linguica pra parecer completo." },
};

/**
 * Os registros. Cada um e um jeito de responder, nao um humor.
 * `quando` alimenta o classificador; `instrucao` entra no prompt do chat.
 */
export const REGISTROS = {
  direto: {
    id: "direto",
    quando: "pergunta objetiva, factual, de recuperar algo ou de sim ou nao",
    tamanho: "curta",
    instrucao:
      "Responda a pergunta e pare. Nao traga contraponto, nao problematize, nao " +
      "ofereca angulo alternativo. Se a resposta e curta, ela e curta mesmo.",
  },
  resgate: {
    id: "resgate",
    quando: "ela quer lembrar do que ja escreveu, pediu o que tinha falado sobre algo",
    tamanho: "media",
    instrucao:
      "O trabalho aqui e devolver o que ela ja escreveu, organizado, pelo conteudo " +
      "das notas. Cite o que existe e diga claramente o que NAO achou. Opiniao sua " +
      "so se ela pedir depois.",
  },
  pensar_junto: {
    id: "pensar_junto",
    quando: "decisao, dilema, ela esta pesando caminhos ou testando uma ideia",
    tamanho: "media",
    instrucao:
      "Aqui voce tem opiniao e diz qual. Se as notas dela se contradizem, aponte a " +
      "contradicao. Traga o custo que ela talvez nao tenha visto. Termine tomando " +
      "posicao, nao devolvendo a pergunta.",
  },
  escuta: {
    id: "escuta",
    quando: "desabafo, cansaco, frustracao, ela esta contando algo pesado ou so descarregando",
    tamanho: "curta",
    instrucao:
      "NAO aconselhe, NAO relativize, NAO ofereca contraponto e NAO tente consertar. " +
      "Reconheca o que ela disse com o peso que tem e fique junto. Se houver nota " +
      "que mostre que isso ja vem de antes, pode dizer. Uma pergunta curta no fim, " +
      "ou nenhuma. Nunca vire coach.",
  },
  execucao: {
    id: "execucao",
    quando: "pediu para escrever, listar, estruturar, resumir, traduzir ou gerar algo pronto",
    tamanho: "media",
    instrucao:
      "Entregue a coisa pedida, pronta pra usar. Sem preambulo, sem explicar o que " +
      "voce vai fazer, sem perguntar se ficou bom. Comentario so se mudar a decisao dela.",
  },
  exploracao: {
    id: "exploracao",
    quando: "brainstorm, ela quer possibilidades, abrir o leque, pensar alto",
    tamanho: "longa",
    instrucao:
      "Abra caminhos em vez de fechar num. Varias direcoes, inclusive as improvaveis. " +
      "Marque o que e especulacao sua e o que saiu das notas dela.",
  },
};

export const REGISTRO_PADRAO = "pensar_junto";

/** Registro valido ou o padrao. Puro. */
export function resolverRegistro(id) {
  return REGISTROS[String(id || "").toLowerCase()] || REGISTROS[REGISTRO_PADRAO];
}

/** Orcamento valido ou o do proprio registro. Puro. */
export function resolverTamanho(id, registro) {
  return ORCAMENTO[String(id || "").toLowerCase()] ? String(id).toLowerCase() : registro.tamanho;
}

/**
 * Decisao sem modelo nenhum. E o plano B quando o classificador falha, e e o
 * que garante que a camada de tom nunca derruba a conversa.
 * Deliberadamente grosseira: so pega os casos obvios e cai no padrao.
 * Pura, entao da pra testar sem rede.
 */
export function tomPorHeuristica(texto) {
  const t = String(texto || "").trim();
  const b = t.toLowerCase();
  const palavras = t ? t.split(/\s+/).length : 0;

  if (/^(escreva|faca|gere|monte|liste|resuma|traduza|crie|redija)\b/.test(b)) {
    return { registro: "execucao", tamanho: "media", fonte: "heuristica" };
  }
  if (/\b(o que eu (ja )?(falei|escrevi|disse)|minhas notas|lembra quando|eu tinha (falado|escrito))\b/.test(b)) {
    return { registro: "resgate", tamanho: "media", fonte: "heuristica" };
  }
  if (/\b(cansad[ao]|exaust[ao]|nao aguento|sem forcas|to mal|foda-se|puto|triste|angustia)\b/.test(b)) {
    return { registro: "escuta", tamanho: "curta", fonte: "heuristica" };
  }
  // pergunta curta e objetiva: nao merece ensaio
  if (palavras <= 12 && /\?$/.test(t)) {
    return { registro: "direto", tamanho: "curta", fonte: "heuristica" };
  }
  // pedido longo e detalhado pede resposta a altura
  if (palavras >= 80) {
    return { registro: REGISTRO_PADRAO, tamanho: "longa", fonte: "heuristica" };
  }
  return { registro: REGISTRO_PADRAO, tamanho: null, fonte: "heuristica" };
}

const SISTEMA_TOM = `Voce escolhe COMO outro sistema deve responder a uma mensagem. Voce nao responde a mensagem.

Leia o que a pessoa escreveu e escolha um registro e um tamanho.

Registros:
${Object.values(REGISTROS).map((r) => `- ${r.id}: ${r.quando}`).join("\n")}

Tamanhos: minima, curta, media, longa.

Como escolher o tamanho:
- Acompanhe o esforco dela. Pergunta de uma linha nao vira ensaio; pedido detalhado, com varios pontos, merece resposta a altura.
- Se existem muitas notas relevantes e o assunto puxa por elas, va de media ou longa.
- Se ela so quer um fato ou um sim ou nao, minima ou curta.
- Desabafo nunca e longa: texto grande em cima de dor vira sermao.

Duvida entre dois registros: escolha o menos opinativo dos dois.

Responda SOMENTE com JSON:
{"registro": "...", "tamanho": "...", "motivo": "meia frase"}`;

/** O que o classificador le sobre as notas. Puro. */
export function blocoDasNotas(notas) {
  const lista = Array.isArray(notas) ? notas : [];
  if (!lista.length) return "Nenhuma nota dela se ligou a essa mensagem.";
  return `${lista.length} nota(s) dela se ligaram a isso:\n` +
    lista.slice(0, 8).map((n) => `- ${String(n.resumo || n.texto || "").slice(0, 120)}`).join("\n");
}

/**
 * Escolhe o tom. Nunca lanca: erro vira heuristica.
 * @returns {Promise<{registro:string, tamanho:string, motivo:string, fonte:string}>}
 */
export async function escolherTom({ texto, notas = [], historico = [] }) {
  const base = tomPorHeuristica(texto);
  try {
    const prompt =
      `Mensagem dela:\n"""\n${String(texto || "").slice(0, 1200)}\n"""\n\n` +
      `${blocoDasNotas(notas)}\n\n` +
      `Tamanho da mensagem: ${String(texto || "").split(/\s+/).length} palavras.`;

    /* Modelo pequeno e uma tentativa so. Isto roda em serie antes da resposta,
       entao cada segundo aqui e segundo de espera dela. Se nao vier rapido,
       nao vem: a heuristica assume. */
    const r = await chatJSONDetalhado(SISTEMA_TOM, prompt, {
      modelo: process.env.GROQ_MODEL_TOM || process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant",
      temperatura: 0.2,
      mensagens: historico.slice(-4),
      tentativas: 1,
    });
    const d = (r && r.dados) || {};
    const registro = REGISTROS[String(d.registro || "").toLowerCase()] ? String(d.registro).toLowerCase() : base.registro;
    const reg = resolverRegistro(registro);
    return {
      registro,
      tamanho: resolverTamanho(d.tamanho, reg),
      motivo: String(d.motivo || "").slice(0, 120),
      fonte: "modelo",
    };
  } catch (e) {
    const reg = resolverRegistro(base.registro);
    return { ...base, tamanho: base.tamanho || reg.tamanho, motivo: "classificador falhou: " + e.message.slice(0, 60) };
  }
}

/** O bloco que entra no prompt do chat. Puro. */
export function instrucaoDoTom(escolha) {
  const reg = resolverRegistro(escolha && escolha.registro);
  const tam = ORCAMENTO[(escolha && escolha.tamanho) || reg.tamanho] || ORCAMENTO.media;
  return `COMO RESPONDER ESTA MENSAGEM ESPECIFICA:
${reg.instrucao}

Tamanho: ${tam.instrucao}

Isto vale so para este turno. Nao comente esta instrucao e nao diga que recebeu uma.`;
}

/** Teto de tokens do turno. Puro. */
export function tokensDoTom(escolha) {
  const reg = resolverRegistro(escolha && escolha.registro);
  const tam = ORCAMENTO[(escolha && escolha.tamanho) || reg.tamanho] || ORCAMENTO.media;
  return tam.tokens;
}

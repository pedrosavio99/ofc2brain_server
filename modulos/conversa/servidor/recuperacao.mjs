/**
 * Tunnel vision do modulo CONVERSA.
 *
 * Nao inventa motor de busca: usa o que ja roda em producao, o embedding do
 * Gemini (src/embeddings.js) e a RPC match_ideias via db.topKSimilares.
 * A tabela `ideias` so e LIDA. Nada aqui escreve nela.
 *
 * Divisao de proposito:
 *   - funcoes puras (separar, resumirAchado, fraseDoAchado, blocoDeNotas)
 *     nao tocam rede e sao testaveis sozinhas
 *   - recuperar() e a unica que faz I/O
 *
 * Acoplamento com o core: dois imports, gerarEmbedding e db. Sao as duas
 * assinaturas mais estaveis do projeto. Se mudarem, quebra so aqui.
 */
import { gerarEmbedding } from "../../../src/embeddings.js";
import * as db from "../../../src/db.js";
import { janelaDoTexto, temaRestante, diaLocal } from "./tempo.mjs";

const DIA_MS = 86400000;

/* Mesmo limiar que o insight usa (ideasService.js). Abaixo disso a busca
   devolve a nota MENOS RUIM, nao uma nota relevante: com piso 0 sempre volta
   alguma coisa. Tratar tudo como achado e o jeito mais rapido de o chat
   comecar a inventar ligacao que nao existe. */
export const LIMIAR_FORTE = 0.42;

/* Teto de notas num pedido por data. Um dia cheio pode ter 40 notas, e mandar
   as 40 estoura o prompt e afoga o assunto. Ao estourar, o corte e avisado no
   proprio bloco, pra ele nao afirmar que aquilo e tudo que existe. */
export const MAX_POR_PERIODO = 14;

/** Divide o que veio da busca no que realmente fala do assunto e no resto. */
export function separar(notas, limiar = LIMIAR_FORTE) {
  const lista = Array.isArray(notas) ? notas : [];
  return {
    fortes: lista.filter((n) => Number(n.score) >= limiar),
    fracas: lista.filter((n) => Number(n.score) < limiar),
  };
}

/** Numeros do achado. E daqui que sai a frase da camada 1, sem gastar LLM. */
export function resumirAchado(notas) {
  const { fortes } = separar(notas);
  const areas = [...new Set(fortes.map((n) => n.area).filter(Boolean))];
  const datas = fortes
    .map((n) => new Date(n.criado_em).getTime())
    .filter((t) => Number.isFinite(t));
  return {
    total: (notas || []).length,
    fortes: fortes.length,
    areas,
    maisNova: datas.length ? new Date(Math.max(...datas)) : null,
    maisAntiga: datas.length ? new Date(Math.min(...datas)) : null,
  };
}

/* Banco pequeno de aberturas. A escolha e por hash do texto, entao e
   deterministica (da pra testar) mas varia entre perguntas diferentes. */
const ABERTURAS = ["Achei", "Tenho aqui", "Olha, achei", "Peguei"];

function indicePorTexto(texto, tamanho) {
  const s = String(texto || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h % tamanho;
}

function idadeEmPalavras(data) {
  if (!data) return "";
  const dias = Math.round((Date.now() - data.getTime()) / DIA_MS);
  if (dias <= 0) return "de hoje";
  if (dias === 1) return "de ontem";
  if (dias <= 10) return `de ${dias} dias atrás`;
  if (dias <= 45) return "das últimas semanas";
  if (dias <= 400) return `de ${data.toISOString().slice(0, 7)}`;
  return "de mais de um ano atrás";
}

/**
 * A fala da camada 1. Sai DEPOIS da busca e ANTES do modelo pensar, entao ela
 * diz coisa verdadeira em vez de enrolar. Zero chamada de LLM.
 * Quando nao ha material, ela avisa: preferivel a fingir que achou.
 */
export function fraseDoAchado(resumo, textoPessoa = "") {
  if (!resumo || resumo.fortes === 0) {
    return resumo && resumo.total > 0
      ? "Não achei nota sua falando disso direto. Deixa eu ver o que chega perto."
      : "Não tenho nada guardado sobre isso ainda. Deixa eu pensar com o que eu sei de você.";
  }

  const abre = ABERTURAS[indicePorTexto(textoPessoa, ABERTURAS.length)];
  const quantas = resumo.fortes === 1 ? "1 nota sua" : `${resumo.fortes} notas suas`;

  const partes = [`${abre} ${quantas} sobre isso`];
  if (resumo.areas.length === 1) partes.push(`, tudo em ${resumo.areas[0]}`);
  else if (resumo.areas.length > 1) partes.push(`, espalhadas em ${resumo.areas.length} áreas`);

  const idade = idadeEmPalavras(resumo.maisNova);
  if (idade) partes.push(`. A mais recente é ${idade}`);

  return partes.join("") + ". Deixa eu ler.";
}

/** A fala da camada 1 quando o pedido foi por data. Pura. */
export function frasePeriodo(janela, quantas) {
  if (!quantas) return `Não tem nota nenhuma sua de ${janela.rotulo}.`;
  const n = quantas === 1 ? "1 nota sua" : `${quantas} notas suas`;
  return `Peguei ${n} de ${janela.rotulo}. Deixa eu ler.`;
}

/** As notas do periodo viradas em texto. Pura. */
export function blocoDoPeriodo(janela, notas, total, agora = new Date()) {
  if (!notas.length) {
    return `Ele pediu as notas de ${janela.rotulo} e NAO existe nenhuma nesse periodo. ` +
      `Diga isso com todas as letras. Nao troque por nota de outra data e nao invente que achou.`;
  }
  const linha = (n, i) =>
    `${i + 1}. [${n.area || "sem área"}] ${n.resumo || "(sem resumo)"}\n` +
    `   guardada em ${String(n.criado_em).slice(0, 10)} (${rotuloDaNota(n.criado_em, agora)})\n` +
    `   texto: ${corta(n.texto_original, 700)}`;
  const aviso = total > notas.length
    ? `\n\n(São ${total} no período; estas são as ${notas.length} mais recentes. Diga que tem mais se ele perguntar.)`
    : "";
  return `Notas dele de ${janela.rotulo} (${notas.length}), TODAS deste periodo:\n` +
    notas.map(linha).join("\n") + aviso;
}

/**
 * A idade da nota em palavras, para a LINHA da nota no prompt.
 *
 * Existe porque a data crua nao bastava. O prompt ja dizia "Hoje e 2026-09-18"
 * e a nota ja dizia "guardada em 2026-09-18", mas a conta ficava por conta do
 * modelo, e ele errava: chamava nota de hoje de "aquela vez que voce escreveu".
 *
 * Irmao do idadeEmPalavras, que e da frase de espera e pode ser vago ("das
 * ultimas semanas"). Aqui nao pode: e o que o modelo vai repetir pra voce.
 * Puro.
 */
export function rotuloDaNota(criadoEm, agora = new Date()) {
  const t = new Date(criadoEm).getTime();
  if (!Number.isFinite(t)) return "data desconhecida";
  /* Dias de CALENDARIO, nao horas decorridas. Nota de ontem as 20h tem 18
     horas de idade e a conta por horas dizia "hoje". */
  const dias = diaLocal(agora) - diaLocal(t);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias === 2) return "anteontem";
  if (dias <= 13) return `há ${dias} dias`;
  if (dias <= 60) {
    const sem = Math.round(dias / 7);
    return `há ${sem} semana${sem === 1 ? "" : "s"}`;
  }
  const d = new Date(t);
  return `em ${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

const corta = (t, n) => {
  const s = String(t || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/**
 * As notas viradas em texto pro prompt. Forte e fraco vao SEPARADOS e
 * rotulados: o modelo precisa saber no que pode se apoiar e o que e so
 * vizinhanca, senao ele cita tangente com a mesma confianca do resto.
 */
export function blocoDeNotas(notas, agora = new Date()) {
  const { fortes, fracas } = separar(notas);
  const linha = (n, i) =>
    `${i + 1}. [${n.area || "sem área"}] ${n.resumo || "(sem resumo)"}\n` +
    `   guardada em ${String(n.criado_em).slice(0, 10)} (${rotuloDaNota(n.criado_em, agora)})\n` +
    `   texto: ${corta(n.texto_original, 700)}`;

  const blocos = [];
  if (fortes.length) {
    blocos.push(`Notas dele que falam disso (${fortes.length}):\n${fortes.map(linha).join("\n")}`);
  }
  if (fracas.length) {
    blocos.push(
      `Notas que só tangenciam, use com cuidado e só se ajudar (${fracas.length}):\n` +
      fracas.map(linha).join("\n")
    );
  }
  if (!blocos.length) {
    blocos.push("A base não tem nota sobre isso. Não invente que tem: fale do que você sabe dele.");
  }
  return blocos.join("\n\n");
}

/**
 * Busca as notas mais parecidas com o texto e devolve tudo mastigado.
 * @param {string} texto o que a pessoa acabou de dizer
 * @param {object} [opcoes] { limite }
 * @returns {Promise<{ notas, fortes, fracas, resumo, frase, bloco }>}
 */
/**
 * @param {object} [opcoes]
 *   buscar    quantas o pgvector traz do ranking
 *   maxFortes teto das que realmente falam do assunto
 *   maxFracas teto das tangentes. Poucas de proposito: elas existem so pra ele
 *             poder dizer "isso aqui chega perto", nao pra ocupar o prompt.
 *
 * Tetos separados porque um teto unico enche a lista de score baixo quando a
 * base tem pouca coisa do tema, e corta nota boa quando tem muita.
 */
export async function recuperar(texto, { buscar = 40, maxFortes = 20, maxFracas = 4, agora = new Date() } = {}) {
  const entrada = String(texto || "").trim();
  if (!entrada) {
    const vazio = resumirAchado([]);
    return { notas: [], fortes: [], fracas: [], resumo: vazio, frase: fraseDoAchado(vazio, ""), bloco: blocoDeNotas([]) };
  }

  /* Pedido de data vira FILTRO, nao busca. "As notas de hoje" nao e parecida
     com nota nenhuma: as notas falam de jiu-jitsu, de entrevista, de gente.
     Procurar por semelhanca nesse caso devolve qualquer coisa, que era o que
     acontecia. */
  const janela = janelaDoTexto(entrada, agora);
  if (janela) {
    const doPeriodo = await db.listarPorPeriodo(janela.desde, janela.ate);
    // mais novas primeiro: quem pergunta pelo periodo quer o fim dele
    doPeriodo.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
    const cortou = doPeriodo.length > MAX_POR_PERIODO;
    const usadas = doPeriodo.slice(0, MAX_POR_PERIODO)
      // tudo que esta na janela E do assunto pedido: nao ha tangente aqui
      .map((n) => ({ ...n, embedding: undefined, score: 1 }));
    const resumo = { ...resumirAchado(usadas), periodo: janela.rotulo, cortou, totalPeriodo: doPeriodo.length };
    return {
      notas: usadas, fortes: usadas, fracas: [], resumo, janela,
      frase: frasePeriodo(janela, doPeriodo.length),
      bloco: blocoDoPeriodo(janela, usadas, doPeriodo.length),
    };
  }

  const emb = await gerarEmbedding(entrada);
  /* piso 0 igual ao pesquisar(): quem decide o que presta e o LIMIAR_FORTE
     aqui em cima, nao o banco. Assim a gente ve a tangente e pode dizer que
     ela e tangente, em vez de o banco esconder e o modelo achar que e deserto. */
  const ranking = await db.topKSimilares(emb, { k: buscar, piso: 0 });

  /* Em paralelo de proposito: em fila, 8 notas sao 8 idas ao Supabase, e a
     camada 1 deixa de ser instantanea. */
  const brutas = await Promise.all(ranking.map((r) => db.buscarPorId(r.id).catch(() => null)));
  const notas = brutas
    .map((o, i) => (o ? { ...o, embedding: undefined, score: Number(ranking[i].score.toFixed(4)) } : null))
    .filter(Boolean);

  const bruto = separar(notas);
  const fortes = bruto.fortes.slice(0, maxFortes);
  const fracas = bruto.fracas.slice(0, maxFracas);
  const usadas = fortes.concat(fracas);

  const resumo = resumirAchado(usadas);
  return { notas: usadas, fortes, fracas, resumo, frase: fraseDoAchado(resumo, entrada), bloco: blocoDeNotas(usadas) };
}

/**
 * O panorama em texto pro prompt. Puro.
 *
 * Existe pelo caso que mais incomoda: quando a busca nao acha nota do tema.
 * Sem isto ele fica sem chao e enche linguica. Com isto ele sabe de quantas
 * notas voce tem, de que areas e de que periodo, entao consegue falar do seu
 * contexto em vez de falar do nada.
 */
export function blocoDoPanorama(p) {
  if (!p || !p.total) return "";
  const lista = (arr, n) => (Array.isArray(arr) ? arr : []).slice(0, n)
    .map((x) => `${x.nome} (${x.n})`).join(", ");
  const areas = lista(p.areas, 12);
  const tags = lista(p.tags, 20);
  const periodo = p.primeira && p.ultima ? `Período coberto: de ${p.primeira} a ${p.ultima}.` : "";
  return [
    `A base dele tem ${p.total} nota(s) no total.`,
    periodo,
    areas ? `Áreas: ${areas}.` : "",
    tags ? `Tags mais usadas: ${tags}.` : "",
    "Isso é o retrato geral dele, não o recorte deste assunto. Use pra saber de quem você está falando.",
  ].filter(Boolean).join("\n");
}

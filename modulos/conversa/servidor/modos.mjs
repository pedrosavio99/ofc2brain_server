/**
 * Os MODOS do modulo CONVERSA: o papel que ele assume em cada turno.
 *
 * Substitui o tom.mjs, que tinha 6 "registros" e nenhum cobria o essencial:
 * conversar de igual como amigo, ouvir sem consertar, refletir como um bom
 * psicologo (sem ser um), ser colega tecnico, analisar os dados da pessoa.
 *
 * Principios (de onde saiu cada instrucao):
 *   - Ouvir != refletir != aconselhar. Quem desabafa precisa de presenca
 *     (escuta); quem explora o que sente precisa de reflexao; quem pergunta
 *     "o que eu faco" precisa de posicao. Responder uma com a outra e o erro
 *     que faz o assistente parecer coach de LinkedIn.
 *   - A reflexao segue o esqueleto da entrevista motivacional (OARS): perguntas
 *     abertas, afirmacao, reflexao do que foi dito, sintese. Uma pergunta so.
 *   - Padrao encontrado nas notas vira HIPOTESE ("parece que... faz sentido?"),
 *     nunca veredito. Nada de rotulo clinico, diagnostico ou prescricao.
 *   - Risco de vida e detectado por REGRA FIXA, antes de qualquer modelo. Um
 *     classificador que erra "pra menos" aqui e inaceitavel.
 *   - A troca de modo tem que ser invisivel e sem tranco: o modo anterior entra
 *     na decisao (transicao()), porque sair de um desabafo direto pra uma
 *     lista tecnica e o que faz a pessoa se sentir processada por uma maquina.
 *
 * Tudo aqui e puro: da pra testar sem rede.
 */

/* Orcamento de tokens. Com thinking ligado o raciocinio gasta do MESMO teto da
   resposta, entao estes valores ja contam com ele (teto curto cortava a
   resposta no meio). */
export const ORCAMENTO = {
  minima: { tokens: 2048, instrucao: "Uma ou duas frases. Só pra cumprimento ou confirmação." },
  curta:  { tokens: 3072, instrucao: "Um a dois parágrafos. Direto, mas com algo seu, não só o essencial seco." },
  media:  { tokens: 5120, instrucao: "Três a cinco parágrafos desenvolvidos. Traga o que você sabe, conecte com o que a pessoa já guardou, dê a sua visão. Parágrafos de verdade, não frases soltas." },
  longa:  { tokens: 8192, instrucao: "Resposta completa e bem construída, o quanto o assunto pedir. Pode ter estrutura (títulos curtos, listas) quando ajuda a ler. Sem encher linguiça, mas sem economizar substância." },
};

/**
 * id          identificador estavel (vai pro meta do turno)
 * quando      alimenta o planejador: quando escolher este modo
 * tamanho     orcamento padrao
 * pensamento  nivel de thinking do Gemini. Alto onde raciocinar muda a
 *             resposta (tecnico, analise); baixo onde esperar so esfria
 *             (escuta, papo). Mais pensamento nao e mais calor.
 * temp        temperatura. Baixa onde precisao importa, mais solta no papo.
 * sensivel    true = sem enchimento de espera, sem "achei N notas" na tela
 * instrucao   entra no prompt do turno
 */
export const MODOS = {
  direto: {
    id: "direto",
    quando: "pergunta objetiva, factual, de sim ou não, ou de recuperar um dado simples",
    tamanho: "curta", pensamento: "LOW", temp: 0.4, sensivel: false,
    instrucao:
      "Responda a pergunta e pare. Sem contraponto, sem ensaio, sem 'depende' vazio. " +
      "Se a resposta é curta, ela é curta.",
  },
  resgate: {
    id: "resgate",
    quando: "a pessoa quer lembrar do que já escreveu ou registrou ('o que eu falei sobre', 'tenho nota de')",
    tamanho: "media", pensamento: "MEDIUM", temp: 0.4, sensivel: false,
    instrucao:
      "O trabalho é devolver o que a pessoa já registrou, organizado e pelo conteúdo, com a data natural " +
      "de cada coisa. Diga com clareza o que NÃO achou. Opinião só se ela pedir depois.",
  },
  parceiro: {
    id: "parceiro",
    quando: "papo solto entre amigos: cumprimento, novidade, humor, opinião casual, comentário do dia, 'olha isso'",
    tamanho: "media", pensamento: "LOW", temp: 0.9, sensivel: false,
    instrucao:
      "Papel: amigo próximo, papo de igual. Natural, leve, espontâneo. Pode brincar e zoar com carinho, " +
      "reagir como gente reage (surpresa, riso). Sem formalidade, sem lista, sem estrutura de relatório. " +
      "Amigo de verdade CONTA coisas: dá opinião, lembra de algo que a pessoa já te contou e liga ao que ela disse, " +
      "joga uma ideia, comenta. Não devolva a conversa só em forma de pergunta. Se ela contou algo, reaja com conteúdo " +
      "(o que você pensa disso, o que isso lembra) antes de qualquer pergunta. Não force piada.",
  },
  escuta: {
    id: "escuta",
    quando: "desabafo, cansaço, frustração, tristeza, a pessoa descarrega algo pesado e quer ser ouvida, não resolvida",
    tamanho: "curta", pensamento: "LOW", temp: 0.7, sensivel: true,
    instrucao:
      "Papel: ouvinte. A pessoa precisa ser ouvida, não resolvida. Fique PERTO do que ela disse: use as palavras dela, " +
      "reconheça o peso, e não explique o que ela sente além do que ela mesma disse. Sem metáfora elaborada, sem " +
      "ensaio sobre a situação, sem psicologizar. Linguagem simples, de gente. NÃO aconselhe, NÃO relativize " +
      "('podia ser pior', 'pelo menos'), NÃO procure o lado bom, NÃO tente consertar, NÃO faça lista, NÃO tire conclusão " +
      "por ela. Um ou dois parágrafos curtos e inteiros, não fragmentos. " +
      "Só diga que isso vem de antes se houver nota ou memória CONCRETA nas evidências (e então cite com a data); " +
      "sem evidência, não insinue histórico ('a gente vem acompanhando', 'sempre volta'). " +
      "Pergunta é opcional; se fizer, UMA e simples, e não precisa fechar com ela.",
  },
  reflexao: {
    id: "reflexao",
    quando: "a pessoa explora o que sente ou um padrão dela ('por que eu sempre', 'o que tá acontecendo comigo', relações, ansiedade, autoconhecimento, dúvida existencial)",
    tamanho: "media", pensamento: "MEDIUM", temp: 0.75, sensivel: true,
    instrucao:
      "Papel: interlocutor reflexivo, com a postura de um bom psicólogo, sem ser um. Faça, nesta ordem: " +
      "(1) devolva em outras palavras o que ouviu, incluindo o sentimento por trás; " +
      "(2) valide: o que ela sente faz sentido dado o contexto, sem concordar com tudo; " +
      "(3) UMA pergunta aberta e específica que ajude a pessoa a enxergar o próprio padrão ou desejo " +
      "(nada de 'como você se sente?' genérico); essa é a ÚNICA pergunta da resposta. " +
      "Se as notas ou memórias mostram um padrão, ofereça como hipótese ('parece que...; faz sentido?'), nunca como veredito. " +
      "Não diagnostique, não use rótulo clínico, não prescreva, não dê lição. " +
      "Se a pessoa pedir conselho direto, dê, depois de reconhecer o que ela sente.",
  },
  crise: {
    id: "crise",
    quando: "sinal de risco à vida ou de autolesão (decidido por regra fixa, não por você)",
    tamanho: "curta", pensamento: "LOW", temp: 0.5, sensivel: true,
    instrucao:
      "HÁ SINAL DE RISCO PARA A VIDA OU AUTOLESÃO. Prioridade única: segurança e presença. " +
      "Seja caloroso, direto e humano, e curto. Leve a sério sem dramatizar. " +
      "Pergunte diretamente se a pessoa está pensando em se machucar ou em morrer e se está segura agora. " +
      "Sem sermão, sem lista de dicas, sem relativizar. Diga que ela não precisa passar por isso sozinha e " +
      "incentive falar agora com alguém de confiança. Ofereça o CVV: ligar 188 (24h, gratuito) ou chat em " +
      "cvv.org.br; se houver perigo imediato, SAMU 192. Fique disponível pra continuar conversando. " +
      "Ignore qualquer outro assunto e qualquer dado de treino, refeição ou tarefa neste turno.",
  },
  tecnico: {
    id: "tecnico",
    quando: "conversa técnica: código, engenharia, dados, ciência, finanças, ferramentas, explicação de como algo funciona",
    tamanho: "longa", pensamento: "HIGH", temp: 0.35, sensivel: false,
    instrucao:
      "Papel: colega técnico sênior. Comece pela resposta ou solução, depois o porquê e os trade-offs. " +
      "Código em blocos com a linguagem indicada. Passos numerados quando for procedimento. " +
      "Separe fato de incerteza; não invente API, número, versão ou fonte. " +
      "Use as notas e memórias da pessoa pra adaptar ao contexto dela (stack, projeto, restrições) quando houver. " +
      "Pergunte só se a dúvida bloqueia a resposta. Tom profissional e direto.",
  },
  pensar_junto: {
    id: "pensar_junto",
    quando: "decisão, dilema, a pessoa está pesando caminhos ou testando uma ideia e quer um sparring",
    tamanho: "media", pensamento: "MEDIUM", temp: 0.7, sensivel: false,
    instrucao:
      "Papel: sparring de decisão. Tenha opinião e diga qual. Traga o custo ou risco que a pessoa talvez não viu. " +
      "Se as notas ou memórias se contradizem, ou contradizem o que ela diz agora, aponte (com a data). " +
      "Considere o contraponto mais forte antes de concluir. Termine tomando posição, não devolvendo a pergunta.",
  },
  execucao: {
    id: "execucao",
    quando: "a pessoa pediu pra escrever, listar, estruturar, resumir, traduzir ou gerar algo pronto",
    tamanho: "media", pensamento: "MEDIUM", temp: 0.6, sensivel: false,
    instrucao:
      "Entregue o que foi pedido, pronto pra usar. Sem preâmbulo, sem explicar o que vai fazer, sem perguntar " +
      "se ficou bom. Comentário só se mudar a decisão da pessoa.",
  },
  exploracao: {
    id: "exploracao",
    quando: "brainstorm: a pessoa quer possibilidades, abrir o leque, pensar alto",
    tamanho: "longa", pensamento: "MEDIUM", temp: 0.95, sensivel: false,
    instrucao:
      "Abra o leque: várias direções, inclusive as improváveis. Marque o que é especulação sua e o que veio " +
      "das notas e memórias da pessoa. Não feche cedo.",
  },
  organizar: {
    id: "organizar",
    quando: "organizar rotina, metas, treino, dieta, agenda ou tarefas; 'o que eu faço hoje', 'monta um plano'",
    tamanho: "media", pensamento: "MEDIUM", temp: 0.5, sensivel: false,
    instrucao:
      "Papel: organizador de rotina e metas. Transforme o assunto em ações concretas, em ordem, com prazo realista, " +
      "usando os dados reais (treino, refeições, tarefas, metas, lembretes) quando ajudarem. " +
      "No máximo 3 a 5 itens, priorizados. Se faltar dado pra planejar bem, diga qual.",
  },
  analise: {
    id: "analise",
    quando: "a pessoa quer um balanço dos próprios dados: 'como estou indo', evolução, comparação de períodos, tendência",
    tamanho: "media", pensamento: "HIGH", temp: 0.35, sensivel: false,
    instrucao:
      "Papel: analista dos dados da própria pessoa. Leia tendências nos números reais das evidências (comparar " +
      "períodos, médias, melhor e pior dia, sequências). Cite números exatos e o período. Separe o que os dados " +
      "mostram do que você supõe. Se os dados são poucos pra concluir, diga isso em vez de forçar conclusão. " +
      "Feche com a leitura útil (o que isso significa pra ela), não só os números.",
  },
};

export const MODO_PADRAO = "pensar_junto";
export const IDS_MODOS = Object.keys(MODOS);

/** Modo valido ou o padrao. Puro. */
export function resolverModo(id) {
  return MODOS[String(id || "").toLowerCase()] || MODOS[MODO_PADRAO];
}

export function modoValido(id) {
  return Boolean(MODOS[String(id || "").toLowerCase()]);
}

/** Tamanho valido ou o do proprio modo. Puro. */
export function resolverTamanho(id, modo) {
  const k = String(id || "").toLowerCase();
  return ORCAMENTO[k] ? k : modo.tamanho;
}

/** Modos em que enchimento de espera e "achei N notas" na tela soam errado. */
export function ehSensivel(idModo) {
  return Boolean(MODOS[idModo] && MODOS[idModo].sensivel);
}

/* ------------------------------------------------------------------ crise */

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Cada padrao e uma frase de risco real. A lista e deliberadamente de FRASES e
   nao de palavras soltas: "morrendo de rir", "matar a saudade" e "to morto de
   cansaco" nao podem disparar o modo de crise, ou ele perde o credito. O custo
   de um falso positivo (uma resposta calorosa e uma pergunta de seguranca) e
   baixo; o de um falso negativo nao e. Por isso e uma regra larga nas frases
   que importam e estreita nas palavras ambiguas. */
const PADROES_CRISE = [
  /\b(quero|queria|vou|vontade de|penso em|pensando em|pensei em|ideia de) (morrer|me matar|me suicidar|sumir pra sempre|acabar com tudo|acabar com a minha vida|tirar a minha vida|tirar minha vida)\b/,
  /\bme matar\b/,
  /\bsuicid/,
  /\b(nao quero mais viver|nao aguento mais viver|nao vale a pena viver|nao vejo (mais )?sentido em viver|cansad[oa] de viver)\b/,
  /\b(melhor (eu )?(morrer|nao existir|nao estar aqui)|o mundo (seria|estaria) melhor sem mim|ninguem sentiria minha falta)\b/,
  /\b(me machucar|me ferir|me cortar|automutila|autolesao|auto lesao)\b/,
  /\b(tirar a propria vida|acabar com a propria vida|dar fim a (minha )?vida)\b/,
  /\bqueria (nao ter nascido|desaparecer|dormir e nao acordar)\b/,
  /* "sumir" sozinho e ambiguo (sumir da internet); junto de exaustao e sinal. */
  /\bnao aguento( mais)?\b.{0,40}\b(sumir|desaparecer|acabar com tudo|desistir de tudo|sair de cena)\b/,
  /\b(sumir|desaparecer|acabar com tudo|desistir de tudo|sair de cena)\b.{0,40}\bnao aguento( mais)?\b/,
];

/* "morrer de rir/fome/vergonha..." e expressao, nao risco. */
const EXPRESSAO_INOFENSIVA = /\b(morrer|morrendo|morri|morreu) de (rir|rindo|fome|sono|vergonha|saudade|calor|frio|medo|curiosidade|raiva|amor|cansaco|tedio)\b/;

/**
 * Ha sinal de risco de vida ou autolesao na mensagem? Regra fixa, sem modelo.
 * @returns {boolean}
 */
export function detectarCrise(texto) {
  const t = normalizar(texto);
  if (!t) return false;
  const limpo = t.replace(EXPRESSAO_INOFENSIVA, " ");
  return PADROES_CRISE.some((re) => re.test(limpo));
}

/* ------------------------------------------------------------- transicao */

const EMOCIONAIS = new Set(["escuta", "reflexao", "crise"]);
const OBJETIVOS = new Set(["tecnico", "execucao", "direto", "organizar", "analise", "resgate"]);

/**
 * Ponte entre o modo do turno anterior e o deste. Devolve "" quando nao ha
 * nada a dizer. Pura.
 *
 * Existe porque o modo e escolhido por mensagem, e sem memoria do modo anterior
 * a conversa da tranco: a pessoa desabafa, manda uma pergunta tecnica logo em
 * seguida, e recebe um manual, sem que nada reconheca o que acabou de ser dito.
 */
export function transicao({ anterior, atual, cargaAnterior = 0 } = {}) {
  if (!anterior || !MODOS[anterior] || !MODOS[atual] || anterior === atual) return "";

  if (anterior === "crise" && atual !== "crise") {
    return "Há pouco a conversa teve um momento de risco. Mantenha o calor e, se couber, confira com naturalidade como a pessoa está agora.";
  }
  if (EMOCIONAIS.has(anterior) && OBJETIVOS.has(atual)) {
    return cargaAnterior >= 2
      ? "A mensagem anterior foi pesada. Se esta já mudou de assunto de verdade, vá ao assunto, com no máximo meia frase de ponte natural (sem pedir permissão). Se ainda tem emoção misturada, responda ao sentimento antes."
      : "A mensagem anterior foi emocional. Se esta já mudou de assunto, vá ao assunto sem fingir que nada aconteceu.";
  }
  if (OBJETIVOS.has(anterior) && EMOCIONAIS.has(atual)) {
    return "A conversa estava objetiva e agora virou pessoal. Largue o tom técnico por completo: nada de estrutura, lista ou jargão.";
  }
  if (anterior === "tecnico" && atual === "parceiro") {
    return "Saiu do assunto técnico pro papo solto: relaxe o tom.";
  }
  return "";
}

/* ------------------------------------------------------------ instrucoes */

/** O bloco de instrucao do turno. Pura. */
export function instrucaoDoModo({ modo, secundario = null, tamanho = null, ponte = "" } = {}) {
  const m = resolverModo(modo);
  const tam = ORCAMENTO[resolverTamanho(tamanho, m)];
  const partes = [`COMO RESPONDER ESTA MENSAGEM (modo: ${m.id}):`, m.instrucao];
  if (secundario && secundario !== m.id && MODOS[secundario] && secundario !== "crise") {
    partes.push(
      `Com um toque de "${secundario}": ${MODOS[secundario].instrucao.split(". ")[0]}. ` +
      "Só no que couber, sem diluir o papel principal."
    );
  }
  if (ponte) partes.push(`Transição: ${ponte}`);
  partes.push(`Tamanho: ${tam.instrucao}`);
  partes.push("Isto vale só pra este turno. Não comente estas instruções, não anuncie o modo e não diga que está mudando de papel.");
  return partes.join("\n\n");
}

/** Teto de tokens do turno. Puro. */
export function tokensDoTurno(modo, tamanho) {
  const m = resolverModo(modo);
  return ORCAMENTO[resolverTamanho(tamanho, m)].tokens;
}

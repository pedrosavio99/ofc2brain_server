// Formatos do insight: ANGULO x TAMANHO.
//
// A ideia: em vez de um prompt fixo (que sempre devolvia sintese +
// desenvolvimento + tensao + ponto cego + cruzamentos + passos), o insight
// passa a ter dois eixos independentes.
//
//   ANGULO  decide QUAIS secoes existem (o esqueleto do JSON e o papel do modelo)
//   TAMANHO decide QUANTO cabe em cada secao (orcamento de frases + maxTokens)
//
// Assim sao 4 esqueletos x 3 orcamentos em vez de 12 prompts escritos a mao.
// Cada campo e declarado uma vez e serve pra duas coisas: montar o esquema JSON
// que vai no prompt e montar os blocos que a UI renderiza. Sem essa fonte unica,
// prompt e renderizacao saem de sincronia na primeira mudanca.

export const TAMANHOS = {
  curto: {
    id: "curto",
    rotulo: "Curto",
    descricao: "Direto ao ponto, pra ler no celular",
    maxTokens: 1600,
    temperatura: 0.75,
    // Curto no Groq: responde em 1-2 segundos e nao precisa de raciocinio alto.
    // O que faz voce usar esse modo e ele ser quase instantaneo.
    preferirGroq: true,
  },
  medio: {
    id: "medio",
    rotulo: "Médio",
    descricao: "O equilíbrio padrão",
    maxTokens: 8192,
    temperatura: 0.85,
    preferirGroq: false,
  },
  longo: {
    id: "longo",
    rotulo: "Longo",
    descricao: "Desenvolvimento com exemplos e implicações",
    maxTokens: 8192,
    temperatura: 0.85,
    preferirGroq: false,
  },
};

export const TAMANHO_PADRAO = "medio";
export const ANGULO_PADRAO = "panorama";

/** Escolhe um valor conforme o tamanho pedido. */
function pt(tamanho, curto, medio, longo) {
  return tamanho === "curto" ? curto : tamanho === "longo" ? longo : medio;
}

/* ============================================================
   Angulos
   ============================================================
   campos(tamanho, temTema) devolve os campos do JSON, na ordem em que
   aparecem na tela. tipo: "texto" | "lista" | "cruzamentos".
   ============================================================ */

const ANGULOS = {
  panorama: {
    id: "panorama",
    rotulo: "Panorama",
    descricao: "Lê o conjunto e diz o que ele revela",
    criterio: "Escolha quando nao ha pergunta clara, quando a pessoa quer entender o conjunto, ou quando o recorte mistura assuntos sem um pedido especifico. E a escolha segura quando nenhuma outra se encaixa bem.",
    papel: (temTema) =>
      temTema
        ? `Voce e um pensador que cruza um tema com a base de conhecimento pessoal de alguem.`
        : `Voce e um pensador que le um recorte de notas pessoais e diz o que elas revelam juntas.`,
    campos: (tamanho, temTema) =>
      tamanho === "curto"
        ? [
            {
              chave: "sintese",
              titulo: null,
              tipo: "texto",
              spec: `4 a 6 frases, texto corrido, sem subdividir. O essencial de ${
                temTema ? "cruzar o tema com estas notas" : "o que estas notas dizem juntas"
              }. Nada de introducao nem de resumo do resumo.`,
            },
            { chave: "proximos_passos", titulo: "Faça isso", tipo: "lista", spec: "EXATAMENTE 1 acao concreta e executavel hoje." },
          ]
        : [
            {
              chave: "sintese",
              titulo: null,
              tipo: "texto",
              spec: pt(tamanho, "", "4 a 8 frases densas.", "6 a 10 frases densas.") +
                ` O que ${temTema ? "o cruzamento do tema com esta base" : "este recorte de notas"} revela.`,
            },
            {
              chave: "desenvolvimento",
              titulo: null,
              tipo: "texto",
              spec: pt(tamanho, "", "6 a 12 frases.", "14 a 22 frases, em 2 ou 3 paragrafos separados por linha em branco.") +
                ` A parte principal: ${temTema ? "ataque o tema de verdade" : "desenvolva o que emerge das notas"}, sob medida pro perfil que emerge das notas. Opcoes concretas, criterios de escolha, exemplos nomeados, riscos.`,
            },
            { chave: "tensao", titulo: "Tensão", tipo: "texto", spec: "Contradicao ou trade-off real (entre notas, ou entre o tema e o perfil). null se nao houver." },
            { chave: "ponto_cego", titulo: "Ponto cego", tipo: "texto", spec: "O que falta e que muda o resultado se for considerado. null se nao houver." },
            {
              chave: "cruzamentos",
              titulo: "Cruzamento",
              tipo: "cruzamentos",
              spec: pt(tamanho, "", "ate 3", "ate 4") + " ligacoes entre notas, cada uma com o porque E o que fazer.",
            },
            {
              chave: "proximos_passos",
              titulo: "Próximos passos",
              tipo: "lista",
              spec: pt(tamanho, "", "2 a 4", "3 a 5") + " acoes concretas, especificas, executaveis nesta semana.",
            },
            ...(tamanho === "longo"
              ? [{ chave: "implicacao", titulo: "Daqui a três meses", tipo: "texto", spec: "2 a 4 frases: o que muda se voce seguir por esse caminho, e o que voce vai querer ter medido ate la." }]
              : []),
          ],
  },

  contraponto: {
    id: "contraponto",
    rotulo: "Contraponto",
    descricao: "Ataca as premissas em vez de concordar",
    criterio: "Escolha quando a frase AFIRMA uma decisao ja tomada ou uma conviccao, quando a pessoa pede opiniao sobre algo que ela ja escolheu, ou quando as notas repetem a mesma intencao ha tempo sem sinal de execucao.",
    papel: () =>
      `Voce e um critico rigoroso e leal. Seu trabalho NAO e concordar nem elogiar: e achar onde o
pensamento desta pessoa esta frouxo. Voce e duro com as ideias e respeitoso com a pessoa. Concordar
por educacao, suavizar uma critica real ou terminar com um afago sao falhas suas.`,
    campos: (tamanho) =>
      tamanho === "curto"
        ? [
            { chave: "veredito", titulo: null, tipo: "texto", spec: "3 a 4 frases: o ponto mais fraco de tudo isso, dito sem rodeio." },
            { chave: "fragilidades", titulo: "Não se sustenta", tipo: "lista", spec: "EXATAMENTE 2 itens. Cada um: a afirmacao entre aspas + por que ela nao se sustenta." },
          ]
        : [
            { chave: "veredito", titulo: null, tipo: "texto", spec: pt(tamanho, "", "3 a 5 frases.", "5 a 8 frases.") + " O que nao se sustenta aqui, dito de forma direta." },
            {
              chave: "fragilidades",
              titulo: "Não se sustenta",
              tipo: "lista",
              spec: pt(tamanho, "", "2 a 4", "3 a 6") + " itens. Cada um: a afirmacao (curta, entre aspas, tirada das notas) + por que ela e fragil. Sem inventar afirmacao que nao esta nas notas.",
            },
            { chave: "contradicoes", titulo: "Se contradizem", tipo: "lista", spec: "Notas que se batem entre si. Diga qual contra qual e no que elas divergem. Lista vazia se nao houver, e melhor vazia do que forcada." },
            { chave: "parado", titulo: "Você repete e não executa", tipo: "texto", spec: "1 a 3 frases, SO se houver evidencia real de repeticao ao longo do tempo nas notas. Caso contrario null." },
            {
              chave: "o_que_mudaria",
              titulo: "O que mudaria minha opinião",
              tipo: "lista",
              spec: "2 a 3 itens: que fato, teste ou numero faria essa critica cair por terra. E o caminho pra pessoa te provar errado.",
            },
          ],
  },

  plano: {
    id: "plano",
    rotulo: "Plano",
    descricao: "Quase só ação, na ordem de fazer",
    criterio: "Escolha quando a frase pergunta o que fazer, como comecar, por onde ir ou o que priorizar, ou quando as notas estao cheias de intencao e faltando ordem.",
    papel: () =>
      `Voce transforma o material em execucao. Nada de contextualizar, filosofar ou resumir o que a
pessoa ja escreveu: ela quer saber o que fazer, em que ordem, e como saber que terminou.`,
    campos: (tamanho) =>
      tamanho === "curto"
        ? [
            { chave: "primeiro", titulo: null, tipo: "texto", spec: "2 a 3 frases: por onde comecar HOJE e por que e esse o comeco." },
            { chave: "passos", titulo: "Depois", tipo: "lista", spec: "EXATAMENTE 3 passos curtos, na ordem." },
          ]
        : [
            { chave: "objetivo", titulo: null, tipo: "texto", spec: "1 a 3 frases: qual resultado essas notas apontam. Concreto, verificavel." },
            { chave: "primeiro", titulo: "Comece por aqui", tipo: "texto", spec: "1 a 2 frases: o passo de hoje, e por que ele vem antes dos outros." },
            {
              chave: "passos",
              titulo: "Ordem",
              tipo: "lista",
              spec: pt(tamanho, "", "3 a 6", "5 a 8") + " passos NA ORDEM. Cada um comeca com verbo no infinitivo e termina com o criterio de pronto (como voce sabe que acabou).",
            },
            { chave: "riscos", titulo: "O que pode dar errado", tipo: "lista", spec: "1 a 3 riscos reais, cada um com o sinal de alerta que aparece primeiro." },
            { chave: "ignorar", titulo: "Deixe pra depois", tipo: "lista", spec: "1 a 3 coisas presentes nas notas que NAO valem esforco agora, com o motivo. Lista vazia se nao houver." },
          ],
  },

  conexoes: {
    id: "conexoes",
    rotulo: "Conexões",
    descricao: "Só as ligações entre as notas, sem opinião",
    criterio: "Escolha quando ha muitas notas de areas diferentes e nenhuma pergunta, ou quando a frase pede relacao, padrao ou o que uma coisa tem a ver com outra.",
    papel: () =>
      `Voce liga pontos. Seu trabalho e mostrar o que so aparece quando duas ou mais notas sao lidas
juntas. Nao opine, nao aconselhe, nao resuma nota isolada: se um item pode ser dito com uma nota so,
ele nao e um cruzamento e nao entra.`,
    campos: (tamanho) =>
      tamanho === "curto"
        ? [{ chave: "cruzamentos", titulo: "Cruzamento", tipo: "cruzamentos", spec: "EXATAMENTE 2 cruzamentos, os mais fortes. Cada 'ideia' em 2 a 3 frases." }]
        : [
            {
              chave: "cruzamentos",
              titulo: "Cruzamento",
              tipo: "cruzamentos",
              spec: pt(tamanho, "", "3 a 5", "5 a 7") + " cruzamentos. Em 'notas', cite os resumos curtos das notas ligadas. Em 'ideia', " +
                pt(tamanho, "", "2 a 4 frases", "4 a 6 frases") + ": o que nasce da ligacao, nao o que cada nota diz.",
            },
            { chave: "padrao", titulo: "O padrão por trás", tipo: "texto", spec: "1 a 3 frases: o fio que atravessa varios desses cruzamentos. null se os cruzamentos forem independentes demais." },
            { chave: "lacuna", titulo: "A ligação que falta", tipo: "texto", spec: "1 a 2 frases: a nota que voce ainda nao escreveu e que fecharia o desenho. null se nao houver." },
          ],
  },
};

export function listaAngulos() {
  return Object.keys(ANGULOS).map((id) => ({
    id,
    rotulo: ANGULOS[id].rotulo,
    descricao: ANGULOS[id].descricao,
  }));
}

export function listaTamanhos() {
  return Object.keys(TAMANHOS).map((id) => ({
    id,
    rotulo: TAMANHOS[id].rotulo,
    descricao: TAMANHOS[id].descricao,
  }));
}

export function resolverAngulo(id) {
  return ANGULOS[String(id || "").toLowerCase()] || ANGULOS[ANGULO_PADRAO];
}

export function resolverTamanho(id) {
  return TAMANHOS[String(id || "").toLowerCase()] || TAMANHOS[TAMANHO_PADRAO];
}

/** Monta o trecho de JSON que vai no prompt, a partir dos campos do angulo. */
function esquemaJSON(campos) {
  const linhas = campos.map((c) => {
    if (c.tipo === "lista") return `  "${c.chave}": string[],   // ${c.spec}`;
    if (c.tipo === "cruzamentos") return `  "${c.chave}": [ { "notas": string[], "ideia": string } ],   // ${c.spec}`;
    return `  "${c.chave}": string|null,   // ${c.spec}`;
  });
  return `{\n${linhas.join("\n")}\n}`;
}

// Regras de qualidade que valem pra qualquer angulo. Sao elas que impedem o
// insight de virar texto motivacional que serviria pra qualquer pessoa.
const REGRAS_BASE = `Regras de qualidade, sem excecao:
- Seja concreto e especifico: nomes, exemplos, numeros e escolhas reais, nunca categorias vazias.
- Proibido: frase generica que serviria para qualquer pessoa; conselho do tipo "identifique seus
  objetivos"; repetir o conteudo das notas; elogiar o usuario; encher linguica.
- Densidade: cada frase precisa carregar informacao nova. Prefira afirmar a sugerir.
- Escreva em portugues do Brasil, direto, tom de quem pensa junto e nao de consultor.
- Nunca invente fato que nao esta nas notas. Quando for conhecimento seu, e nao delas, assuma isso na frase.
- Um campo sem conteudo honesto vira null (ou lista vazia). Encher campo e falha.`;

/**
 * Instrucao completa (system prompt) do insight, ja com angulo, tamanho e esquema.
 */
export function instrucaoDoFormato({ angulo, tamanho, temTema, temMaterial }) {
  const ang = resolverAngulo(angulo);
  const tam = resolverTamanho(tamanho);
  const campos = ang.campos(tam.id, !!temTema);

  const semMaterial = temTema && !temMaterial
    ? `\nATENCAO: a base nao tem nota realmente proxima do tema. Nao se limite a dizer que nao ha relacao.
Use as notas apenas para entender QUEM e essa pessoa (o que faz, o que a interessa, em que momento esta)
e trabalhe o tema sob medida pra ela, com o seu proprio conhecimento do assunto.`
    : "";

  const orcamento = tam.id === "curto"
    ? `\nTamanho: CURTO. Corte tudo que nao for essencial. Se a escolha for entre completar um campo e ser breve, seja breve.`
    : tam.id === "longo"
      ? `\nTamanho: LONGO. Aqui ha espaco: desenvolva, exemplifique e mostre implicacao. Volume sem informacao nova continua sendo falha.`
      : "";

  return `${ang.papel(!!temTema)}
Sua saida precisa ser util o suficiente para a pessoa AGIR depois de ler.

${REGRAS_BASE}${orcamento}${semMaterial}

Responda SOMENTE com JSON:
${esquemaJSON(campos)}`;
}

/**
 * Converte o JSON do modelo em blocos de tela.
 * @returns {{ chave, tipo, titulo, texto, itens? }[]}
 */
export function montarBlocos({ angulo, tamanho, temTema }, dados) {
  if (!dados) return [];
  // formato antigo (string pura ou { insight }): vira um bloco so
  if (typeof dados === "string") return [{ chave: "texto", tipo: "texto", titulo: null, texto: dados }];
  if (dados.insight && !dados.sintese) {
    return [{ chave: "texto", tipo: "texto", titulo: null, texto: String(dados.insight) }];
  }

  const ang = resolverAngulo(angulo);
  const tam = resolverTamanho(tamanho);
  const campos = ang.campos(tam.id, !!temTema);
  const blocos = [];

  for (const c of campos) {
    const valor = dados[c.chave];
    if (valor == null) continue;

    if (c.tipo === "cruzamentos") {
      const lista = Array.isArray(valor) ? valor : [];
      for (const item of lista) {
        if (!item || !item.ideia) continue;
        const quais = Array.isArray(item.notas) && item.notas.length ? item.notas.join(" + ") : null;
        blocos.push({
          chave: "cruzamento",
          tipo: "cruzamento",
          titulo: c.titulo,
          notas: quais,
          texto: (quais ? quais + ": " : "") + item.ideia,
        });
      }
      continue;
    }

    if (c.tipo === "lista") {
      const itens = (Array.isArray(valor) ? valor : [valor]).filter(Boolean).map(String);
      if (!itens.length) continue;
      blocos.push({
        chave: c.chave,
        tipo: "lista",
        titulo: c.titulo,
        itens,
        texto: itens.map((t, i) => `${i + 1}) ${t}`).join("  "),
      });
      continue;
    }

    const texto = String(valor).trim();
    if (!texto) continue;
    blocos.push({ chave: c.chave, tipo: "texto", titulo: c.titulo, texto });
  }

  return blocos;
}

/** Versao em texto puro dos blocos. Mantida pro campo "insight" da API nao mudar de tipo. */
export function textoDosBlocos(blocos) {
  if (!Array.isArray(blocos) || !blocos.length) return null;
  const partes = blocos.map((b) => (b.titulo ? `${b.titulo}: ${b.texto}` : b.texto));
  const texto = partes.filter(Boolean).join("\n\n").trim();
  return texto || null;
}

/* ============================================================
   Sugestao automatica de formato
   ============================================================
   Um modelo pequeno decide angulo e tamanho ANTES de gerar. O criterio nao pode
   ficar implicito: um 8b nao adivinha quando usar cada angulo, entao a regra de
   cada um vai escrita no prompt, tirada do proprio catalogo. Angulo novo
   cadastrado la em cima ja entra aqui sozinho.
   ============================================================ */

export function instrucaoSugerirFormato() {
  const angulos = Object.keys(ANGULOS)
    .map((id) => `- ${id}: ${ANGULOS[id].descricao}. ${ANGULOS[id].criterio}`)
    .join("\n");

  return `Voce escolhe COMO um insight deve ser gerado sobre um recorte de notas pessoais.
Voce NAO gera o insight: so decide o formato e explica a escolha em uma frase.

Angulos disponiveis:
${angulos}

Tamanhos disponiveis:
- curto: frase objetiva, pergunta fechada, ou recorte pequeno (ate 6 notas).
- medio: o padrao. Use quando nao houver motivo claro pro curto nem pro longo.
- longo: recorte grande (25 notas ou mais), tema aberto, ou pedido explicito de profundidade.

Regras:
- Decida pelo que ESTA no recorte e na frase, nao pelo que seria interessante.
- Na duvida entre dois angulos, prefira panorama. Na duvida entre dois tamanhos, prefira medio.
- "motivo" e UMA frase curta, em portugues do Brasil, dizendo o que na frase ou nas notas levou
  a essa escolha. Nada de generico ("para dar uma visao completa"): cite o que voce viu.

Responda SOMENTE com JSON: { "angulo": string, "tamanho": string, "motivo": string }`;
}

/** Valida a resposta do modelo contra o catalogo. Nada de id inventado passar. */
export function normalizarSugestao(dados) {
  const ang = ANGULOS[String(dados?.angulo || "").toLowerCase()] ? String(dados.angulo).toLowerCase() : ANGULO_PADRAO;
  const tam = TAMANHOS[String(dados?.tamanho || "").toLowerCase()] ? String(dados.tamanho).toLowerCase() : TAMANHO_PADRAO;
  const motivo = dados && dados.motivo ? String(dados.motivo).trim().slice(0, 400) : null;
  return {
    angulo: ang,
    anguloRotulo: ANGULOS[ang].rotulo,
    tamanho: tam,
    tamanhoRotulo: TAMANHOS[tam].rotulo,
    motivo,
  };
}

/* ============================================================
   Continuidade (follow-up sobre um insight ja gerado)
   ============================================================ */

export const ATALHOS = {
  explicar: {
    id: "explicar",
    rotulo: "Explique melhor",
    pedido: "Pegue o ponto central do que voce disse e explique com mais calma: o raciocinio passo a passo, o que voce assumiu como verdade e por que a conclusao segue. Nada de repetir o texto anterior com outras palavras.",
  },
  exemplos: {
    id: "exemplos",
    rotulo: "Mais exemplos",
    pedido: "Traga exemplos concretos e nomeados que sustentem o que voce disse. Casos reais, ferramentas, nomes, numeros. Se o exemplo for conhecimento seu e nao das notas, diga isso.",
  },
  encurtar: {
    id: "encurtar",
    rotulo: "Encurte",
    pedido: "Reduza tudo a no maximo 3 frases, sem perder o que decide alguma coisa. Corte contexto, corte ressalva, fique com o miolo.",
  },
  plano: {
    id: "plano",
    rotulo: "Vira plano",
    pedido: "Converta isso em plano de acao: passos na ordem, cada um com verbo no infinitivo e criterio de pronto. Nada de contexto novo.",
  },
  discordar: {
    id: "discordar",
    rotulo: "Discorde disso",
    pedido: "Agora argumente CONTRA o que voce mesmo acabou de dizer. Onde esse raciocinio e fragil, o que ele ignora, e em que situacao ele estaria errado. Seja honesto, nao faca teatro de discordancia.",
  },
  aprofundar: {
    id: "aprofundar",
    rotulo: "Aprofundar",
    pedido: "Aprofunde especificamente este ponto, ignorando o resto do insight.",
  },
};

export function resolverAtalho(id) {
  return ATALHOS[String(id || "").toLowerCase()] || null;
}

export function listaAtalhos() {
  return Object.keys(ATALHOS).map((id) => ({ id, rotulo: ATALHOS[id].rotulo }));
}

export const INSTRUCAO_CONTINUAR = `Voce esta continuando uma conversa sobre a base de conhecimento pessoal de alguem.
Ja existe um insight gerado; agora a pessoa pediu algo em cima dele.

${REGRAS_BASE}
- Responda APENAS ao que foi pedido. Nao reapresente o insight anterior, nao faca resumo do resumo,
  nao abra com "claro" nem com "otima pergunta".
- As notas continuam sendo a fonte: nao invente conteudo que nao esta nelas.
- Texto corrido, em paragrafos separados por linha em branco. Sem titulo, sem markdown, sem lista
  numerada a nao ser que o pedido peca uma ordem.

Responda SOMENTE com JSON: { "resposta": string }`;
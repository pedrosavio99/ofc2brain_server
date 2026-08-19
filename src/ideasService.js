import { v4 as uuid } from "uuid";
import * as db from "./db.js";
import { gerarJSON, temGemini } from "./geminiClient.js";
import { chatJSON } from "./groqClient.js";
import { gerarEmbedding, MODELO_EMBEDDING } from "./embeddings.js";

const SYSTEM_PROMPT = `Voce e um assistente que organiza uma base pessoal de conhecimento (um "segundo cerebro").
Para cada texto enviado pelo usuario, voce deve:
1. Escrever um resumo curto (1-2 frases) que capture a essencia da ideia antes de ela ser detalhada.
2. Classificar a ideia em UMA area/categoria principal (ex: "produtividade", "biologia", "culinaria", "negocios", "filosofia"). Use nomes de area consistentes e reutilizaveis, em minusculas.
3. Sugerir de 1 a 5 tags/palavras-chave secundarias.
4. Definir o "tipo": "ideia" (insight solto), "conceito" (definicao/teoria mais estruturada) ou "lembrete_evento" (algo com data/compromisso).
5. Se for "lembrete_evento", calcular "data_evento" no formato YYYY-MM-DD com base na data de hoje informada. Caso contrario, "data_evento" deve ser null.
6. Olhar a lista de "ideias candidatas" (ja pre-filtradas por similaridade semantica) e apontar APENAS as que realmente tem relacao conceitual real com a nova ideia, explicando o motivo em uma frase curta. Nunca invente um id que nao esteja na lista de candidatas. Se nenhuma for relacionada de verdade, retorne uma lista vazia.

Responda SOMENTE com um JSON no formato:
{
  "resumo": string,
  "area": string,
  "tags": string[],
  "tipo": "ideia" | "conceito" | "lembrete_evento",
  "data_evento": string | null,
  "relacionados": [ { "id": string, "motivo": string } ]
}`;

// Prompt enxuto usado no relink: so decide relacoes, nao re-resume nada.
const SYSTEM_PROMPT_RELACAO = `Voce conecta ideias de um "segundo cerebro". Dada uma ideia base e uma lista
de candidatas (ja pre-filtradas por similaridade semantica), aponte APENAS as que tem relacao conceitual real,
explicando o motivo em uma frase curta. Nunca invente um id fora da lista. Se nenhuma for relacionada de verdade,
retorne lista vazia. Responda SOMENTE com JSON: { "relacionados": [ { "id": string, "motivo": string } ] }`;

function montarUserPrompt({ texto, hojeISO, candidatas }) {
  const listaCandidatas =
    candidatas
      .map((c) => `- id: ${c.id} | area: ${c.area} | resumo: ${c.resumo}`)
      .join("\n") || "(nenhuma ideia candidata encontrada)";

  return `Data de hoje: ${hojeISO}

Texto novo enviado pelo usuario:
"""
${texto}
"""

Ideias candidatas a relacionamento (pre-selecionadas por similaridade semantica):
${listaCandidatas}`;
}

function montarPromptRelacao({ texto, resumo, candidatas }) {
  const lista = candidatas
    .map((c) => `- id: ${c.id} | area: ${c.area} | resumo: ${c.resumo}`)
    .join("\n");
  return `Ideia base:
"""
${resumo || texto}
"""

Candidatas:
${lista}`;
}

// Quantas candidatas (por similaridade) mandar pro LLM avaliar. O LLM e o filtro
// de PRECISAO, entao aqui a gente favorece RECALL: top-K com um piso baixo.
const MAX_CANDIDATOS = Number(process.env.MAX_CANDIDATOS || 10);
const PISO_SIMILARIDADE = Number(process.env.PISO_SIMILARIDADE || 0.3);

async function hidratarCandidatas(cands) {
  const out = [];
  for (const c of cands) {
    const o = await db.buscarPorId(c.id);
    if (o) out.push({ id: o.id, area: o.area, resumo: o.resumo, score: c.score });
  }
  return out;
}

/**
 * Processa um novo texto de ponta a ponta e ja salva o objeto completo.
 * @param {string} texto
 */
export async function criarIdeiaAutomaticamente(texto) {
  if (!texto || !texto.trim()) {
    throw new Error("Campo 'texto' e obrigatorio.");
  }

  // 1. embedding do texto novo
  const embedding = await gerarEmbedding(texto);

  // 2. pre-selecao local (barata) de candidatas: top-K acima de um piso de recall
  const candidatasBrutas = await db.topKSimilares(embedding, {
    k: MAX_CANDIDATOS,
    piso: PISO_SIMILARIDADE,
  });
  const candidatasComScore = await hidratarCandidatas(candidatasBrutas);

  // 3. LLM: resumo + area + tags + tipo + data_evento + confirmacao das relacoes reais
  const hojeISO = new Date().toISOString().slice(0, 10);
  const userPrompt = montarUserPrompt({ texto, hojeISO, candidatas: candidatasComScore });
  const analise = await chatJSON(SYSTEM_PROMPT, userPrompt);

  // 4. junta o score (calculado localmente) com o motivo (explicado pelo LLM)
  const scorePorId = new Map(candidatasComScore.map((c) => [c.id, c.score]));
  const relacionados = (analise.relacionados || [])
    .filter((r) => scorePorId.has(r.id)) // nunca confia cegamente em id inventado pelo modelo
    .map((r) => ({
      id: r.id,
      motivo: r.motivo,
      score: Number(scorePorId.get(r.id).toFixed(4)),
    }));

  const novaIdeia = {
    id: uuid(),
    texto_original: texto,
    resumo: analise.resumo,
    area: analise.area,
    tags: analise.tags || [],
    tipo: analise.tipo || "ideia",
    data_evento: analise.tipo === "lembrete_evento" ? analise.data_evento : null,
    relacionados,
    embedding,
    criado_em: new Date().toISOString(),
  };

  await db.salvar(novaIdeia);

  // referencia de volta: a ideia antiga tambem passa a "saber" da nova (relacao nao fica de mao unica)
  for (const rel of relacionados) {
    await db.atualizar(rel.id, (ideiaAntiga) => ({
      ...ideiaAntiga,
      relacionados: [
        ...(ideiaAntiga.relacionados || []),
        { id: novaIdeia.id, motivo: rel.motivo, score: rel.score },
      ],
    }));
  }

  return semExpoerEmbedding(novaIdeia);
}

/**
 * Lista com filtros opcionais.
 * desde/ate aceitam ISO ("2026-07-01") ou ISO completo. "ate" sem hora vira o
 * fim do dia, senao um intervalo de um dia so nao pegaria nada.
 */
export async function listarIdeias({ area, tipo, desde, ate } = {}) {
  const todas = await db.listarTodas();

  const limiteInicio = desde ? new Date(desde).getTime() : null;
  let limiteFim = null;
  if (ate) {
    const d = new Date(ate);
    // se veio so a data (sem hora), estende ate 23:59:59.999 daquele dia
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(ate))) d.setHours(23, 59, 59, 999);
    limiteFim = d.getTime();
  }

  return todas
    .filter((i) => (area ? i.area === area : true))
    .filter((i) => (tipo ? i.tipo === tipo : true))
    .filter((i) => {
      if (limiteInicio === null && limiteFim === null) return true;
      const t = new Date(i.criado_em).getTime();
      if (Number.isNaN(t)) return false;
      if (limiteInicio !== null && t < limiteInicio) return false;
      if (limiteFim !== null && t > limiteFim) return false;
      return true;
    })
    .map(semExpoerEmbedding);
}

export async function buscarIdeiaPorId(id) {
  const ideia = await db.buscarPorId(id);
  return ideia ? semExpoerEmbedding(ideia) : null;
}

export async function removerIdeia(id) {
  return db.remover(id);
}

/**
 * Busca semantica (modo pesquisa): embeda a query e ranqueia por similaridade
 * usando a mesma varredura rapida do banco.
 */
export async function pesquisar(query, { comInsight = false, limite = 5 } = {}) {
  const embeddingQuery = await gerarEmbedding(query);

  const ranking = await db.topKSimilares(embeddingQuery, { k: limite, piso: 0 });
  const resultados = [];
  for (const r of ranking) {
    const o = await db.buscarPorId(r.id);
    if (o) resultados.push({ ...semExpoerEmbedding(o), score: Number(r.score.toFixed(4)) });
  }

  if (resultados.length === 0) {
    return { resultados: [], insight: null };
  }

  let insight = null;
  if (comInsight) {
    insight = await gerarInsight(query, resultados);
  }

  return { resultados, insight };
}

/**
 * Insight. Aqui vale gastar um modelo forte, entao a qualidade depende menos do
 * modelo e mais do que a gente coloca na frente dele. Tres coisas mudaram:
 *
 * 1. A busca semantica usa piso 0, entao quando voce pesquisa um tema que nao
 *    existe na base ela devolve as notas MENOS RUINS, e nao notas relevantes.
 *    Aqui separamos o que e forte do que e fraco, e dizemos isso ao modelo.
 * 2. Ele passa a ver a base inteira (areas, tags, volume), nao so os 10 achados,
 *    entao consegue falar do seu contexto e nao so do recorte.
 * 3. Quando a base nao tem material sobre o tema, ele NAO se limita a dizer
 *    "nao achei". Ele trabalha o tema usando o seu perfil que emerge das notas.
 */
const LIMIAR_RELEVANTE = 0.42;

async function gerarInsight(query, resultados) {
  const fortes = resultados.filter((r) => (r.score ?? 0) >= LIMIAR_RELEVANTE);
  const fracos = resultados.filter((r) => (r.score ?? 0) < LIMIAR_RELEVANTE);

  // panorama da base, pra ele entender de quem esta falando
  let panorama = "";
  try {
    const todas = await db.listarTodas();
    const porArea = {}, porTag = {};
    for (const n of todas) {
      const a = n.area || "sem area";
      porArea[a] = (porArea[a] || 0) + 1;
      for (const t of n.tags || []) porTag[t] = (porTag[t] || 0) + 1;
    }
    const areas = Object.entries(porArea).sort((a, b) => b[1] - a[1])
      .map(([a, c]) => `${a} (${c})`).join(", ");
    const tags = Object.entries(porTag).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([t, c]) => `${t} (${c})`).join(", ");
    panorama = `Base completa: ${todas.length} nota(s).
Areas: ${areas || "nenhuma"}.
Tags mais usadas: ${tags || "nenhuma"}.`;
  } catch {
    panorama = "Base completa: nao foi possivel ler o panorama.";
  }

  // corta o texto de cada nota: uma nota gigante sozinha estouraria o prompt,
  // e o essencial ja esta no resumo.
  const corta = (t, n) => {
    const s = String(t || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

  const formatar = (lista) => lista.map((r, i) => {
    const rels = (r.relacionados || [])
      .map((x) => (x && x.motivo) ? `${x.motivo}` : null)
      .filter(Boolean).slice(0, 3);
    return `${i + 1}. [${r.area || "sem area"}] ${r.resumo || "(sem resumo)"}
   texto: ${corta(r.texto_original, 600)}
   tags: ${(r.tags || []).join(", ") || "-"}
   proximidade com o tema: ${Math.round((r.score ?? 0) * 100)}%${rels.length ? `
   ja ligada a outras notas porque: ${rels.join(" / ")}` : ""}`;
  }).join("\n");

  const temMaterial = fortes.length > 0;

  const instrucao = `Voce e um pensador que trabalha sobre a base de conhecimento pessoal de alguem.
Sua saida precisa ser util o suficiente para a pessoa AGIR depois de ler. Um texto que so descreve
o que ela ja escreveu, ou que diz "nao ha conexao clara", e considerado uma falha sua.

Regras de qualidade, sem excecao:
- NUNCA responda apenas que as notas nao se relacionam com o tema. Se a base for pobre no tema,
  seu trabalho passa a ser: usar o que as notas revelam sobre ESSA PESSOA (area de atuacao,
  interesses, momento de vida, jeito de pensar) para atacar o tema de forma sob medida,
  com o seu proprio conhecimento do assunto. Seja concreto e especifico, com nomes, exemplos,
  numeros e escolhas reais, nao categorias vazias.
- Proibido: frase generica que serviria para qualquer pessoa; conselho do tipo "identifique seus
  objetivos"; repetir o conteudo das notas; elogiar o usuario; encher linguica.
- Densidade: cada frase precisa carregar informacao nova. Prefira afirmar a sugerir.
- Escreva em portugues do Brasil, direto, tom de quem pensa junto e nao de consultor.

Responda SOMENTE com JSON:
{
  "sintese": string,          // 4-8 frases densas. O que o cruzamento do tema com esta base revela.
  "desenvolvimento": string,  // 6-12 frases. A parte principal: ataque o tema de verdade,
                              // sob medida para o perfil que emerge das notas. Traga opcoes
                              // concretas, criterios de escolha, exemplos nomeados, riscos.
  "tensao": string|null,      // contradicao ou trade-off real (entre notas, ou entre o tema e o perfil)
  "ponto_cego": string|null,  // o que falta e que muda o resultado se for considerado
  "cruzamentos": [ { "notas": string[], "ideia": string } ], // ate 3, cada um com o porque E o que fazer
  "proximos_passos": string[] // 2 a 4 acoes concretas, especificas, executaveis nesta semana
}`;

  const prompt = `${panorama}

Tema pesquisado: "${query}"

${temMaterial
  ? `Notas REALMENTE relacionadas ao tema (use como materia-prima principal):
${formatar(fortes)}`
  : `A base NAO tem nenhuma nota realmente proxima deste tema.
As notas abaixo apareceram na busca por eliminacao, com proximidade baixa: NAO force conexao
entre elas e o tema, e NAO diga apenas que nao ha relacao. Use-as apenas para entender quem e
esta pessoa (o que ela faz, o que a interessa, em que momento esta) e entao trabalhe o tema
"${query}" de forma sob medida para ela, com profundidade e recomendacoes concretas suas.`}

${temMaterial && fracos.length
  ? `Notas de proximidade baixa (contexto de fundo, use com parcimonia):
${formatar(fracos.slice(0, 5))}`
  : (!temMaterial ? `Notas para inferir o perfil da pessoa:
${formatar(resultados.slice(0, 8))}` : "")}`;

  // 1) caminho principal: Gemini com raciocinio alto
  if (temGemini()) {
    try {
      const d = await gerarJSON(instrucao, prompt, { temperatura: 0.85, maxTokens: 8192 });
      console.log("[insight] gerado pelo Gemini.");
      return montarTextoInsight(d);
    } catch (err) {
      console.error("[insight] Gemini falhou, caindo no Groq:", err.message);
    }
  }

  // 2) ultimo recurso: Groq. Da pra desligar com GROQ_FALLBACK_INSIGHT=false:
  // as vezes e melhor a tela dizer "tente em 1 minuto" do que entregar um
  // insight fraco e queimar a confianca na ferramenta.
  if (process.env.GROQ_FALLBACK_INSIGHT === "false") {
    console.warn("[insight] Gemini indisponivel e o fallback do Groq esta desligado.");
    return null;
  }
  try {
    const r = await chatJSON(`${instrucao}\n\nSe nao conseguir preencher um campo, use null.`, prompt);
    console.log("[insight] gerado pelo Groq (ultimo recurso).");
    return montarTextoInsight(r);
  } catch (err) {
    console.error("[insight] Groq tambem falhou:", err.message);
    return null;
  }
}

/** Junta o JSON estruturado num texto legivel para o front. */
function montarTextoInsight(d) {
  if (!d) return null;
  if (typeof d === "string") return d;
  if (d.insight && !d.sintese) return d.insight; // formato antigo

  const partes = [];
  if (d.sintese) partes.push(d.sintese);
  if (d.desenvolvimento) partes.push(d.desenvolvimento);
  if (d.tensao) partes.push(`Tensão: ${d.tensao}`);
  if (d.ponto_cego) partes.push(`Ponto cego: ${d.ponto_cego}`);

  const cruz = d.cruzamentos || d.conexoes || [];
  if (Array.isArray(cruz)) {
    for (const c of cruz.slice(0, 3)) {
      if (c && c.ideia) {
        const quais = Array.isArray(c.notas) && c.notas.length ? `${c.notas.join(" + ")}: ` : "";
        partes.push(`Cruzamento: ${quais}${c.ideia}`);
      }
    }
  }

  const passos = d.proximos_passos || (d.proximo_passo ? [d.proximo_passo] : []);
  if (Array.isArray(passos) && passos.length) {
    partes.push("Próximos passos: " + passos.filter(Boolean).map((p, i) => `${i + 1}) ${p}`).join("  "));
  }

  const texto = partes.filter(Boolean).join("\n\n").trim();
  return texto || null;
}

export async function proximosEventos({ dias = 30 } = {}) {
  const todas = await db.listarTodas();
  const agora = new Date();
  const limite = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);

  return todas
    .filter((i) => i.tipo === "lembrete_evento" && i.data_evento)
    .filter((i) => {
      const data = new Date(i.data_evento);
      return data >= agora && data <= limite;
    })
    .sort((a, b) => new Date(a.data_evento) - new Date(b.data_evento))
    .map(semExpoerEmbedding);
}

/**
 * Reconstroi a base inteira: re-embeda tudo com o modelo atual e recalcula
 * TODAS as relacoes do zero (o grafo deixa de ser congelado no insert).
 * Operacao de manutencao: roda 1 embedding local por ideia + 1 chamada LLM por
 * ideia que tenha candidatas. Barato para um cerebro pessoal.
 */
/**
 * Reconstroi embeddings e relacoes de TODAS as notas.
 *
 * Duas coisas que essa funcao precisa respeitar, aprendidas na marra:
 *  - E uma chamada de LLM POR NOTA. Numa base grande isso estoura o limite de
 *    requisicoes por minuto, entao existe um intervalo minimo entre chamadas
 *    (RELINK_INTERVALO_MS) e o cliente do Groq espera e tenta de novo no 429.
 *  - Demora minutos. Por isso ela reporta progresso via onProgress e a rota
 *    roda em background, em vez de segurar a conexao ate o fim.
 *
 * @param {function} [onProgress] recebe { fase, feito, total, etapa, falhas }
 */
export async function reindexarTudo(onProgress) {
  const avisar = typeof onProgress === "function" ? onProgress : () => {};
  const intervalo = Number(process.env.RELINK_INTERVALO_MS || 2100);
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  const todas = await db.listarTodas(); // ordem de criacao
  const total = todas.length;
  let falhas = 0;

  avisar({ fase: "embeddings", etapa: 1, feito: 0, total, falhas });

  // 1. re-embeda tudo e zera relacoes antigas (local, sem limite de API)
  for (let i = 0; i < todas.length; i++) {
    const it = todas[i];
    const emb = await gerarEmbedding(it.texto_original);
    await db.atualizar(it.id, (a) => ({
      ...a,
      embedding: Float32Array.from(emb),
      relacionados: [],
    }));
    avisar({ fase: "embeddings", etapa: 1, feito: i + 1, total, falhas });
  }

  // 2. reconstroi relacoes de forma simetrica e sem duplicar pares
  const atualizadas = await db.listarTodas();
  const relPorId = new Map(atualizadas.map((t) => [t.id, []]));
  const paresVistos = new Set();
  let totalRelacoes = 0;

  avisar({ fase: "relacoes", etapa: 2, feito: 0, total: atualizadas.length, falhas });

  for (let i = 0; i < atualizadas.length; i++) {
    const ideia = atualizadas[i];

    const cands = await db.topKSimilares(ideia.embedding, {
      k: MAX_CANDIDATOS,
      piso: PISO_SIMILARIDADE,
      excluirId: ideia.id,
    });

    if (cands.length > 0) {
      const candObjs = await hidratarCandidatas(cands);
      try {
        // Modelo PEQUENO de proposito. Decidir "quais destas candidatas tem
        // relacao real" e classificacao simples: nao precisa de um 70b, e o
        // 70b e justamente quem estoura o teto DIARIO de tokens numa base
        // grande (50 notas x ~1.8k tokens ja passa de 90k num relink so).
        const analise = await chatJSON(
          SYSTEM_PROMPT_RELACAO,
          montarPromptRelacao({ texto: ideia.texto_original, resumo: ideia.resumo, candidatas: candObjs }),
          { modelo: process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant" }
        );

        const scorePorId = new Map(candObjs.map((c) => [c.id, c.score]));
        for (const r of analise.relacionados || []) {
          if (!scorePorId.has(r.id)) continue;
          const chave = [ideia.id, r.id].sort().join("|");
          if (paresVistos.has(chave)) continue;
          paresVistos.add(chave);

          const score = Number(scorePorId.get(r.id).toFixed(4));
          relPorId.get(ideia.id).push({ id: r.id, motivo: r.motivo, score });
          relPorId.get(r.id).push({ id: ideia.id, motivo: r.motivo, score });
          totalRelacoes++;
        }
      } catch (err) {
        // uma nota que falha nao pode derrubar o processo inteiro: registra e segue
        falhas++;
        console.error(`[relink] falhou na nota ${ideia.id}: ${err.message}`);
      }

      // respiro entre chamadas de LLM, pra nao bater no limite por minuto
      if (i < atualizadas.length - 1 && intervalo > 0) await dormir(intervalo);
    }

    avisar({ fase: "relacoes", etapa: 2, feito: i + 1, total: atualizadas.length, falhas });
  }

  for (const [id, rels] of relPorId) {
    await db.atualizar(id, (a) => ({ ...a, relacionados: rels }));
  }

  avisar({ fase: "concluido", etapa: 2, feito: atualizadas.length, total: atualizadas.length, falhas });
  return { ideias: atualizadas.length, relacoes: totalRelacoes, falhas, modelo: MODELO_EMBEDDING };
}


// O vetor de embedding e grande e nao serve pro usuario final ver na resposta da API
function semExpoerEmbedding(ideia) {
  const { embedding, ...resto } = ideia;
  return resto;
}

/* ============================================================
   Sugestoes de perguntas para insight
   ============================================================ */

// Cache em memoria: gerar sugestao custa uma chamada de LLM, e enquanto voce
// nao guarda nota nova as sugestoes seriam as mesmas. A chave e o conjunto de
// ids considerado, entao guardar uma nota nova invalida sozinho.
let cacheSugestoes = { chave: null, dados: null, em: null };

/**
 * Propoe perguntas de insight ancoradas nas ultimas N notas.
 * @param {object} opts { ultimas = 20, forcar = false }
 */
export async function sugerirPerguntas({ ultimas = 20, ids = null, forcar = false } = {}) {
  const todas = await db.listarTodas();
  if (todas.length === 0) {
    return { perguntas: [], baseadoEm: 0, motivo: "sem notas ainda" };
  }

  // Dois escopos possiveis:
  //  - ids: um conjunto especifico (ex: o resultado de uma pesquisa). E o mais
  //    util, porque as perguntas saem do que voce esta investigando agora.
  //  - ultimas: as N mais recentes (padrao, quando nao ha recorte).
  let recentes;
  let escopo;
  if (Array.isArray(ids) && ids.length) {
    const porId = new Map(todas.map((n) => [n.id, n]));
    recentes = ids.map((id) => porId.get(id)).filter(Boolean);
    escopo = "selecao";
    if (!recentes.length) {
      return { perguntas: [], baseadoEm: 0, motivo: "nenhuma das notas informadas existe" };
    }
  } else {
    // listarTodas vem em ordem de criacao crescente
    recentes = todas.slice(-Math.max(1, Number(ultimas) || 20)).reverse();
    escopo = "recentes";
  }
  const chave = escopo + ":" + recentes.map((n) => n.id).join(",");

  if (!forcar && cacheSugestoes.chave === chave && cacheSugestoes.dados) {
    return { ...cacheSugestoes.dados, doCache: true, geradoEm: cacheSugestoes.em };
  }

  const instrucao = `Voce ajuda alguem a interrogar a propria base de notas.
A pessoa nao sabe o que perguntar; seu trabalho e propor perguntas que valham a pena.

Regras:
- Cada pergunta precisa ser ANCORADA no conteudo real das notas abaixo. Se citar um tema,
  esse tema tem que existir nas notas. Proibido pergunta generica que serviria pra qualquer base
  ("quais sao meus objetivos?", "o que aprendi?").
- Varie o tipo: pergunta que cruza duas areas distintas, pergunta que expoe contradicao,
  pergunta que projeta uma decisao pra frente, pergunta que procura o que esta faltando.
- Cada pergunta deve caber numa linha e ser especifica o bastante pra render uma resposta densa.
- Portugues do Brasil, direto, sem enrolacao.

Responda SOMENTE com JSON:
{ "perguntas": [ { "pergunta": string, "porque": string } ] }   // exatamente 10 itens
"porque" = uma frase curta explicando o que essa pergunta pode revelar.`;

  // Aqui mandamos resumo + tags em vez do texto inteiro das 20 notas: o resumo
  // ja carrega a essencia e isso corta perto da metade dos tokens. So caimos no
  // texto (cortado) quando a nota nao tem resumo.
  const linha = (n, i) => {
    const miolo = n.resumo || String(n.texto_original || "").slice(0, 200);
    return `${i + 1}. [${n.area || "sem area"}] ${miolo}` +
      ((n.tags || []).length ? ` (tags: ${n.tags.join(", ")})` : "");
  };

  const cabecalho = escopo === "selecao"
    ? `Notas que a pessoa esta investigando agora (${recentes.length}), vindas de uma
pesquisa por tema. As perguntas devem sair DESTE recorte, nao da base inteira:`
    : `Notas mais recentes desta pessoa (${recentes.length}):`;

  const prompt = `${cabecalho}
${recentes.map(linha).join("\n")}

Areas presentes: ${[...new Set(recentes.map((n) => n.area || "sem area"))].join(", ")}`;

  let dados = null;

  if (temGemini()) {
    try {
      dados = await gerarJSON(instrucao, prompt, { temperatura: 0.9, maxTokens: 4096 });
      console.log("[sugestoes] geradas pelo Gemini.");
    } catch (err) {
      console.error("[sugestoes] Gemini falhou, caindo no Groq:", err.message);
    }
  }
  if (!dados) {
    try {
      dados = await chatJSON(instrucao, prompt);
      console.log("[sugestoes] geradas pelo Groq (ultimo recurso).");
    } catch (err) {
      console.error("[sugestoes] Groq tambem falhou:", err.message);
      throw new Error("Nao consegui gerar sugestoes agora.");
    }
  }

  const perguntas = (dados.perguntas || [])
    .filter((p) => p && (typeof p === "string" || p.pergunta))
    .map((p) => (typeof p === "string" ? { pergunta: p, porque: "" } : { pergunta: p.pergunta, porque: p.porque || "" }))
    .slice(0, 10);

  const resultado = { perguntas, baseadoEm: recentes.length, escopo };
  cacheSugestoes = { chave, dados: resultado, em: new Date().toISOString() };
  return { ...resultado, doCache: false, geradoEm: cacheSugestoes.em };
}
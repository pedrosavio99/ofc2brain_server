import { v4 as uuid } from "uuid";
import * as db from "./db.js";
import { gerarJSON, gerarJSONDetalhado, temGemini } from "./geminiClient.js";
import { chatJSON, chatJSONDetalhado } from "./groqClient.js";
import { gerarEmbedding, MODELO_EMBEDDING } from "./embeddings.js";
import {
  instrucaoDoFormato,
  montarBlocos,
  textoDosBlocos,
  resolverAngulo,
  resolverTamanho,
  resolverAtalho,
  instrucaoSugerirFormato,
  normalizarSugestao,
  INSTRUCAO_CONTINUAR,
  ANGULO_PADRAO,
  TAMANHO_PADRAO,
} from "./insightFormatos.js";

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
export async function pesquisar(query, { comInsight = false, limite = 5, angulo = null, tamanho = null } = {}) {
  const embeddingQuery = await gerarEmbedding(query);

  const ranking = await db.topKSimilares(embeddingQuery, { k: limite, piso: 0 });
  const resultados = [];
  for (const r of ranking) {
    const o = await db.buscarPorId(r.id);
    if (o) resultados.push({ ...semExpoerEmbedding(o), score: Number(r.score.toFixed(4)) });
  }

  if (resultados.length === 0) {
    return { resultados: [], insight: null, insight_blocos: null, insight_meta: null };
  }

  let insight = null;
  let insightBlocos = null;
  let insightMeta = null;
  if (comInsight) {
    const ins = await gerarInsight(query, resultados, { angulo, tamanho });
    if (ins) {
      insight = ins.texto;
      insightBlocos = ins.blocos;
      insightMeta = ins.meta;
    }
  }

  return { resultados, insight, insight_blocos: insightBlocos, insight_meta: insightMeta };
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

/**
 * Gera o insight sobre um conjunto de notas.
 * @param {string|null} query  tema/frase/pergunta de base. Pode ser null: nesse
 *        caso o insight nao tem um tema, ele so le o conjunto de notas do recorte
 *        (area/periodo) e diz o que elas revelam juntas.
 * @param {object[]} resultados notas ja selecionadas (com ou sem score).
 * @param {object} [opcoes] { escopoTexto } descricao do recorte (ex: "area:
 *        negocios, ultimos 30 dias"), usada no prompt quando nao ha tema.
 * @returns {Promise<{ texto: string, meta: object }|null>}
 */
async function gerarInsight(query, resultados, opcoes = {}) {
  const temTema = !!(query && String(query).trim());
  const escopoTexto = opcoes.escopoTexto || null;

  // Sem tema (insight por area/periodo): todas as notas do recorte contam como
  // material forte, porque foram escolhidas de proposito, nao por semelhanca.
  const fortes = temTema
    ? resultados.filter((r) => (r.score ?? 0) >= LIMIAR_RELEVANTE)
    : resultados;
  const fracos = temTema
    ? resultados.filter((r) => (r.score ?? 0) < LIMIAR_RELEVANTE)
    : [];

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

  // O formato (angulo x tamanho) decide o esqueleto do JSON, o papel do modelo
  // e o orcamento de frases. Ver src/insightFormatos.js.
  const formato = { angulo: opcoes.angulo, tamanho: opcoes.tamanho, temTema };
  const tam = resolverTamanho(opcoes.tamanho);
  const ang = resolverAngulo(opcoes.angulo);
  const instrucao = instrucaoDoFormato({ ...formato, temMaterial });

  // Cabecalho do prompt: com tema e uma pesquisa; sem tema e um recorte
  // (area/periodo) que a pessoa mandou analisar por inteiro.
  const cabecalho = temTema
    ? `Tema pesquisado: "${query}"`
    : `Recorte de notas para analisar${escopoTexto ? ` (${escopoTexto})` : ""}.
Nao ha tema: leia o conjunto e diga o que ele revela.`;

  const blocoMaterial = temTema
    ? (temMaterial
        ? `Notas REALMENTE relacionadas ao tema (use como materia-prima principal):
${formatar(fortes)}`
        : `A base NAO tem nenhuma nota realmente proxima deste tema.
As notas abaixo apareceram na busca por eliminacao, com proximidade baixa: NAO force conexao
entre elas e o tema, e NAO diga apenas que nao ha relacao. Use-as apenas para entender quem e
esta pessoa (o que ela faz, o que a interessa, em que momento esta) e entao trabalhe o tema
"${query}" de forma sob medida para ela, com profundidade e recomendacoes concretas suas.`)
    : `Notas deste recorte (${resultados.length}), use todas como materia-prima:
${formatar(resultados)}`;

  const blocoContexto = temTema && temMaterial && fracos.length
    ? `Notas de proximidade baixa (contexto de fundo, use com parcimonia):
${formatar(fracos.slice(0, 5))}`
    : (temTema && !temMaterial
        ? `Notas para inferir o perfil da pessoa:
${formatar(resultados.slice(0, 8))}`
        : "");

  const prompt = `${panorama}

${cabecalho}

${blocoMaterial}

${blocoContexto}`;

  // Empacota a resposta do modelo junto com a fonte (provedor/modelo/chave) e
  // quantas notas entraram, pra UI conseguir mostrar de onde saiu o insight.
  const empacotar = (dados, metaLLM) => {
    const blocos = montarBlocos(formato, dados);
    const texto = textoDosBlocos(blocos);
    if (!texto) return null;
    return {
      texto,
      blocos,
      meta: {
        ...(metaLLM || {}),
        notasConsideradas: resultados.length,
        notasFortes: fortes.length,
        temTema,
        escopo: escopoTexto,
        angulo: ang.id,
        anguloRotulo: ang.rotulo,
        tamanho: tam.id,
      },
    };
  };

  const viaGemini = async () => {
    if (!temGemini()) return null;
    try {
      const { dados, meta } = await gerarJSONDetalhado(instrucao, prompt, {
        temperatura: tam.temperatura,
        maxTokens: tam.maxTokens,
      });
      const pronto = empacotar(dados, meta);
      if (pronto) {
        console.log(`[insight] ${ang.id}/${tam.id} pelo Gemini (${meta.modelo}, chave ${meta.chave}/${meta.totalChaves}).`);
        return pronto;
      }
    } catch (err) {
      console.error("[insight] Gemini falhou:", err.message);
    }
    return null;
  };

  const viaGroq = async () => {
    // Da pra desligar o Groq como reserva com GROQ_FALLBACK_INSIGHT=false: as
    // vezes e melhor a tela dizer "tente em 1 minuto" do que entregar um insight
    // fraco e queimar a confianca na ferramenta. No tamanho CURTO o Groq nao e
    // reserva, e a escolha principal, entao a chave nao vale.
    if (!tam.preferirGroq && process.env.GROQ_FALLBACK_INSIGHT === "false") {
      console.warn("[insight] Gemini indisponivel e o fallback do Groq esta desligado.");
      return null;
    }
    try {
      const { dados, meta } = await chatJSONDetalhado(
        `${instrucao}\n\nSe nao conseguir preencher um campo, use null.`,
        prompt
      );
      const pronto = empacotar(dados, meta);
      if (pronto) {
        console.log(`[insight] ${ang.id}/${tam.id} pelo Groq (${meta.modelo}, chave ${meta.chave}/${meta.totalChaves}).`);
        return pronto;
      }
    } catch (err) {
      console.error("[insight] Groq falhou:", err.message);
    }
    return null;
  };

  // A ordem depende do tamanho: no curto o que importa e responder rapido
  // (Groq primeiro); no medio e no longo importa a qualidade do raciocinio.
  const ordem = tam.preferirGroq ? [viaGroq, viaGemini] : [viaGemini, viaGroq];
  for (const tentar of ordem) {
    const pronto = await tentar();
    if (pronto) return pronto;
  }
  return null;
}

/* ============================================================
   Insight avancado: por area, por periodo, com frase/pergunta de base ou
   sem nada. Diferente do /pesquisa, aqui o recorte das notas vem de FILTRO
   (area + intervalo de datas), nao de similaridade. A frase de base (quando
   existe) so reordena o recorte por relevancia; sem frase, entram as mais
   recentes do recorte.
   ============================================================ */

// Traduz periodo curto (7d, 30d...) em data de corte. "tudo" = sem corte.
function periodoParaDesde(periodo) {
  const dias = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[periodo];
  if (!dias) return null;
  return new Date(Date.now() - dias * 86400000).toISOString();
}

// Monta a descricao humana do recorte, usada no prompt e devolvida pra UI.
function montarEscopoTexto({ area, periodo, desde, ate, tema }) {
  const partes = [];
  partes.push(area ? `area: ${area}` : "todas as areas");
  if (periodo && periodo !== "tudo") {
    const rot = { "1d": "hoje", "7d": "ultimos 7 dias", "30d": "ultimos 30 dias", "90d": "ultimos 90 dias", "365d": "ultimo ano" }[periodo];
    partes.push(rot || `periodo ${periodo}`);
  } else if (desde || ate) {
    if (desde && ate) partes.push(`de ${String(desde).slice(0, 10)} a ${String(ate).slice(0, 10)}`);
    else if (desde) partes.push(`a partir de ${String(desde).slice(0, 10)}`);
    else partes.push(`ate ${String(ate).slice(0, 10)}`);
  } else {
    partes.push("todo o periodo");
  }
  if (tema) partes.push(`foco: "${tema}"`);
  return partes.join(", ");
}

/**
 * Gera um insight sobre um recorte da base.
 * @param {object} opts
 *   q       frase/pergunta de base (opcional; vazio = insight livre do recorte)
 *   area    filtra por area (opcional)
 *   periodo atalho de intervalo: "1d" | "7d" | "30d" | "90d" | "365d" | "tudo"
 *   desde   ISO/AAAA-MM-DD (usado quando nao ha "periodo")
 *   ate     ISO/AAAA-MM-DD
 *   limite  quantas notas no maximo entram no insight (padrao 20, teto 60)
 */
/* Seleciona o recorte de notas (area + periodo) e, se houver frase, reordena
   por relevancia. Nao chama o LLM: e a base comum do insight e do preview. */
async function selecionarRecorte({ q = null, area = null, periodo = null, desde = null, ate = null, limite = 20 } = {}) {
  const tema = q && String(q).trim() ? String(q).trim() : null;
  const lim = Math.max(1, Math.min(Number(limite) || 20, 60));

  // periodo curto tem prioridade sobre desde/ate soltos
  let desdeEfetivo = desde;
  if (periodo && periodo !== "tudo") {
    const d = periodoParaDesde(periodo);
    if (d) desdeEfetivo = d;
  }

  const escopo = {
    area: area || null,
    periodo: periodo || null,
    desde: desdeEfetivo || null,
    ate: ate || null,
    tema,
    limite: lim,
  };
  const escopoTexto = montarEscopoTexto({ area, periodo, desde: desdeEfetivo, ate, tema });

  // recorte por filtro (area + datas), reaproveitando a listagem existente
  const base = await listarIdeias({
    area: area || undefined,
    desde: desdeEfetivo || undefined,
    ate: ate || undefined,
  });

  if (base.length === 0) {
    return { tema, lim, escopo, escopoTexto, base, selecionadas: [] };
  }

  let selecionadas;
  if (tema) {
    // com frase de base: embeda a frase e reordena o recorte por relevancia
    const emb = await gerarEmbedding(tema);
    const ranking = await db.topKSimilares(emb, { k: Math.max(lim * 3, 30), piso: 0 });
    const idsBase = new Set(base.map((n) => n.id));
    const noBase = new Map(base.map((n) => [n.id, n]));
    selecionadas = ranking
      .filter((r) => idsBase.has(r.id))
      .slice(0, lim)
      .map((r) => ({ ...noBase.get(r.id), score: Number(r.score.toFixed(4)) }));
    // se por algum motivo o ranking nao cobriu o recorte, cai nas mais recentes
    if (selecionadas.length === 0) {
      selecionadas = base.slice(-lim).reverse();
    }
  } else {
    // sem frase: as mais recentes do recorte (listarIdeias vem crescente por data)
    selecionadas = base.slice(-lim).reverse();
  }

  return { tema, lim, escopo, escopoTexto, base, selecionadas };
}

export async function insightAvancado(args = {}) {
  const { tema, escopo, escopoTexto, base, selecionadas } = await selecionarRecorte(args);

  if (base.length === 0) {
    return { insight: null, insight_blocos: null, insight_meta: null, usou: 0, escopo, escopoTexto, motivo: "nenhuma nota neste recorte" };
  }

  const ins = await gerarInsight(tema, selecionadas, {
    escopoTexto,
    angulo: args.angulo || null,
    tamanho: args.tamanho || null,
  });
  if (!ins) {
    return { insight: null, insight_blocos: null, insight_meta: null, usou: selecionadas.length, escopo, escopoTexto, motivo: "modelo indisponivel agora" };
  }

  return {
    insight: ins.texto,
    insight_blocos: ins.blocos,
    insight_meta: ins.meta,
    usou: selecionadas.length,
    escopo,
    escopoTexto,
    notas: selecionadas.map((n) => ({ id: n.id, resumo: n.resumo, area: n.area, score: n.score ?? null })),
  };
}

/* ============================================================
   Sugestao automatica de formato
   ============================================================
   Roda ANTES da geracao e custa uma chamada de LLM pequena, zero embedding:
   reaproveita os ids que a tela ja tem em mao em vez de refazer a selecao.
   Regra de ouro: isto e um ajudante. Se falhar, NUNCA derruba a geracao;
   devolve o padrao marcado como fallback e a vida segue.
   ============================================================ */

// Cache em memoria por recorte: ir e voltar na mesma tela nao paga duas vezes.
const cacheFormato = new Map();

export async function sugerirFormato({
  ids = [],
  q = null,
  area = null,
  periodo = null,
  desde = null,
  ate = null,
  limite = 20,
} = {}) {
  const tema = q && String(q).trim() ? String(q).trim() : null;

  let notas = [];
  let escopoTexto = null;
  if (Array.isArray(ids) && ids.length) {
    // caminho barato: a tela ja sabe quais notas entram
    for (const id of ids.slice(0, 40)) {
      const n = await db.buscarPorId(id);
      if (n) notas.push(n);
    }
  } else {
    const r = await selecionarRecorte({ q, area, periodo, desde, ate, limite });
    notas = r.selecionadas;
    escopoTexto = r.escopoTexto;
  }

  const padrao = {
    angulo: ANGULO_PADRAO,
    anguloRotulo: "Panorama",
    tamanho: TAMANHO_PADRAO,
    tamanhoRotulo: "Médio",
    motivo: null,
    fallback: true,
    notasConsideradas: notas.length,
  };

  if (!notas.length) return { ...padrao, motivo: "nenhuma nota neste recorte" };

  const chave = (tema || "") + "|" + notas.map((n) => n.id).join(",");
  if (cacheFormato.has(chave)) return { ...cacheFormato.get(chave), doCache: true };

  const areas = [...new Set(notas.map((n) => n.area || "sem area"))];
  const linhas = notas
    .slice(0, 30)
    .map((n, i) => `${i + 1}. [${n.area || "sem area"}] ${n.resumo || String(n.texto_original || "").slice(0, 140)}`)
    .join("\n");

  const prompt = `Frase/pergunta de base: ${tema ? `"${tema}"` : "(nenhuma, a pessoa nao escreveu nada)"}
Recorte: ${escopoTexto || "sem descricao"}
Quantidade de notas: ${notas.length}
Areas presentes (${areas.length}): ${areas.join(", ")}

Resumos das notas:
${linhas}`;

  try {
    // Modelo PEQUENO de proposito: isto e classificacao, nao raciocinio. Gastar
    // um modelo grande aqui atrasaria justamente a parte que precisa ser rapida.
    const dados = await chatJSON(instrucaoSugerirFormato(), prompt, {
      modelo: process.env.GROQ_MODEL_FORMATO || "llama-3.1-8b-instant",
    });
    const sug = { ...normalizarSugestao(dados), fallback: false, notasConsideradas: notas.length };
    cacheFormato.set(chave, sug);
    if (cacheFormato.size > 40) cacheFormato.delete(cacheFormato.keys().next().value);
    console.log(`[formato] sugerido ${sug.angulo}/${sug.tamanho} para ${notas.length} nota(s).`);
    return sug;
  } catch (err) {
    console.error("[formato] nao consegui sugerir, seguindo no padrao:", err.message);
    return padrao;
  }
}

/* ============================================================
   Continuidade: um pedido em cima de um insight ja gerado
   ============================================================
   Sem estado no servidor. O front devolve o insight anterior e os ids das notas
   que o alimentaram; aqui a gente RECARREGA essas notas do banco, porque deixar
   o modelo continuar so em cima do proprio texto e o caminho curto pra ele
   inventar. Custo: 1 chamada de LLM, zero embedding. */

export async function continuarInsight({
  pedido = null,
  atalho = null,
  anterior = null,
  historico = [],
  ids = [],
  foco = null,
  tamanho = null,
} = {}) {
  const atalhoObj = resolverAtalho(atalho);
  const oQueFazer = (pedido && String(pedido).trim()) || (atalhoObj && atalhoObj.pedido) || null;
  if (!oQueFazer) throw new Error("Diga o que voce quer que eu faca com esse insight.");
  if (!anterior || !String(anterior).trim()) {
    throw new Error("Nao ha insight anterior pra continuar.");
  }

  const tam = resolverTamanho(tamanho);

  const notas = [];
  for (const id of (Array.isArray(ids) ? ids : []).slice(0, 40)) {
    const n = await db.buscarPorId(id);
    if (n) notas.push(n);
  }

  const corta = (t, n) => {
    const s = String(t || "");
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

  const blocoNotas = notas.length
    ? `Notas que sustentam este insight (${notas.length}):
${notas.map((n, i) => `${i + 1}. [${n.area || "sem area"}] ${n.resumo || "(sem resumo)"}
   texto: ${corta(n.texto_original, 400)}`).join("\n")}`
    : "As notas originais nao foram informadas: trabalhe apenas sobre o insight anterior e diga quando algo for conhecimento seu.";

  // So as 2 ultimas rodadas: sem esse teto o prompt cresce sem limite a cada
  // follow-up, e o custo junto.
  const blocoHistorico = Array.isArray(historico) && historico.length
    ? `\nRodadas anteriores desta conversa:
${historico.slice(-2).map((h) => `- pediram: ${corta(h.pedido, 200)}
  voce respondeu: ${corta(h.resposta, 700)}`).join("\n")}`
    : "";

  const blocoFoco = foco && String(foco).trim()
    ? `\nO pedido e sobre ESTE ponto especifico do insight, ignore o resto:
"""
${corta(foco, 600)}
"""`
    : "";

  const prompt = `${blocoNotas}

Insight anterior (nao repita, trabalhe em cima dele):
"""
${corta(anterior, 6000)}
"""${blocoHistorico}${blocoFoco}

Pedido da pessoa:
"""
${corta(oQueFazer, 800)}
"""`;

  const empacotar = (dados, metaLLM) => {
    const resposta = typeof dados === "string" ? dados : (dados && (dados.resposta || dados.texto));
    const limpo = resposta ? String(resposta).trim() : "";
    if (!limpo) return null;
    return {
      resposta: limpo,
      meta: { ...(metaLLM || {}), notasConsideradas: notas.length, tamanho: tam.id, atalho: atalhoObj ? atalhoObj.id : null },
    };
  };

  const viaGemini = async () => {
    if (!temGemini()) return null;
    try {
      const { dados, meta } = await gerarJSONDetalhado(INSTRUCAO_CONTINUAR, prompt, {
        temperatura: 0.8,
        maxTokens: tam.maxTokens,
      });
      return empacotar(dados, meta);
    } catch (err) {
      console.error("[continuar] Gemini falhou:", err.message);
      return null;
    }
  };

  const viaGroq = async () => {
    try {
      const { dados, meta } = await chatJSONDetalhado(INSTRUCAO_CONTINUAR, prompt);
      return empacotar(dados, meta);
    } catch (err) {
      console.error("[continuar] Groq falhou:", err.message);
      return null;
    }
  };

  const ordem = tam.preferirGroq ? [viaGroq, viaGemini] : [viaGemini, viaGroq];
  for (const tentar of ordem) {
    const pronto = await tentar();
    if (pronto) return pronto;
  }
  throw new Error("Nao consegui continuar agora. Tente de novo em um minuto.");
}

/* Preview do recorte: mesmas notas que o insight usaria, SEM chamar o LLM.
   Serve pro modal mostrar ao vivo o que sera considerado. Com frase custa 1
   embedding + 1 busca vetorial; sem frase nem embedding. Nada de LLM. */
export async function previewRecorte(args = {}) {
  const { escopo, escopoTexto, base, selecionadas } = await selecionarRecorte(args);
  return {
    usou: selecionadas.length,
    total: base.length,
    escopo,
    escopoTexto,
    notas: selecionadas.map((n) => ({ id: n.id, resumo: n.resumo, area: n.area, score: n.score ?? null })),
  };
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
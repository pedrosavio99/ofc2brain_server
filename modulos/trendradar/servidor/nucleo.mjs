/**
 * Nucleo do TrendRadar: configuracao, cache, monitor de cotas, guardas HTTP e as
 * duas portas de entrada de um alvo novo (pesquisa e CSV). Tudo que aparece na tela
 * e dado coletado: nao existe mais catalogo fixo nem estimativa.
 */

import { gerarHipoteses } from "./ia.mjs";
import { buscarNoticias, contarJanelas, filtrarRelevantes, normalizarChave } from "./vivo.mjs";
import { gravarPulso, gravarAlvo, atualizarDescoberta, buscarDescoberta } from "./radar-banco.mjs";

/* ==========================================================================
   1. CLASSE DE ERRO HTTP PADRONIZADA
   ========================================================================== */
export class ErroHttp extends Error {
  constructor(status, message, dica = "") {
    super(message);
    this.name = "ErroHttp";
    this.status = Number(status || 500);
    this.message = String(message || "Erro no modulo TrendRadar.");
    this.dica = String(dica || "");
  }
}

/* ==========================================================================
   2. RESOLUCAO DE DIRETORIO E CONFIGURACAO DO ECOSSISTEMA 2BRAIN
   ========================================================================== */
export function obterConfig() {
  return {
    readOnly: process.env.READ_ONLY === "1",
    mock: false,
    cacheMs: Number(process.env.CACHE_TTL_MS || 120000),
    tokenAcesso: "",
    geminiKey: process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "",
    groqKey: process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || "",
    groqModel: process.env.GROQ_CHAT_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    serpApiKey: process.env.SERPAPI_KEY || "",
    newsApiKey: process.env.NEWSAPI_KEY || "",
    gnewsApiKey: process.env.GNEWS_API_KEY || "",
    redditUserAgent: process.env.REDDIT_USER_AGENT || "TrendRadarAI/1.0",
    databaseUrl: "",
    limiteCotaSerpApi: Number(process.env.QUOTA_LIMIT_SERPAPI || 100),
    limiteCotaNewsApi: Number(process.env.QUOTA_LIMIT_NEWSAPI || 100),
    limiteCotaGemini: Number(process.env.QUOTA_LIMIT_GEMINI || 1500),
    limiteCotaHn: Number(process.env.QUOTA_LIMIT_HN || 1000)
  };
}

/* ==========================================================================
   3. MONITOR DE COTAS DE API E ALERTAS DE LIMITE (RATE LIMIT / QUOTA)
   ========================================================================== */
const estadoCotas = {
  gemini: { usado: 0, bloqueadoPorLimite: false, ultimoErro: "", atualizadoEm: 0 },
  serpapi: { usado: 0, bloqueadoPorLimite: false, ultimoErro: "", atualizadoEm: 0 },
  newsapi: { usado: 0, bloqueadoPorLimite: false, ultimoErro: "", atualizadoEm: 0 },
  hackernews: { usado: 0, bloqueadoPorLimite: false, ultimoErro: "", atualizadoEm: 0 }
};

export function registrarUsoCota(provedor, incrementar = 1) {
  const item = estadoCotas[provedor];
  if (!item) return;
  item.usado += incrementar;
  item.atualizadoEm = Date.now();
}

export function registrarLimiteCota(provedor, statusHttp, detalhe = "") {
  const item = estadoCotas[provedor];
  if (!item) return;
  if (statusHttp === 429 || statusHttp === 402 || statusHttp === 403) {
    item.bloqueadoPorLimite = true;
    item.ultimoErro =
      detalhe ||
      "Limite de cota da API atingido (HTTP " +
        statusHttp +
        "). O sistema ativou automaticamente o fallback local.";
    item.atualizadoEm = Date.now();
  }
}

export function simularAlertaCota(provedor = "serpapi", nivel = "critico") {
  const cfg = obterConfig();
  const limites = {
    gemini: cfg.limiteCotaGemini,
    serpapi: cfg.limiteCotaSerpApi,
    newsapi: cfg.limiteCotaNewsApi,
    hackernews: cfg.limiteCotaHn
  };
  const alvo = estadoCotas[provedor] || estadoCotas.serpapi;
  const max = limites[provedor] || 100;

  if (nivel === "resetar") {
    for (const k of Object.keys(estadoCotas)) {
      estadoCotas[k].usado = 0;
      estadoCotas[k].bloqueadoPorLimite = false;
      estadoCotas[k].ultimoErro = "";
    }
    return obterResumoCotas();
  }

  if (nivel === "esgotado") {
    alvo.usado = max;
    alvo.bloqueadoPorLimite = true;
    alvo.ultimoErro = "Cota mensal/diaria de " + provedor.toUpperCase() + " chegou a 100% (HTTP 429). Usando cache e motor local.";
  } else {
    alvo.usado = Math.ceil(max * 0.85);
    alvo.bloqueadoPorLimite = false;
    alvo.ultimoErro = "Atencao: " + provedor.toUpperCase() + " atingiu 85% da cota disponivel.";
  }
  alvo.atualizadoEm = Date.now();
  return obterResumoCotas();
}

export function obterResumoCotas() {
  const cfg = obterConfig();
  const provedores = [
    {
      id: "gemini",
      nome: "Gemini / IA",
      configurado: Boolean(cfg.geminiKey || cfg.groqKey),
      usado: estadoCotas.gemini.usado,
      limite: cfg.limiteCotaGemini,
      bloqueado: estadoCotas.gemini.bloqueadoPorLimite,
      ultimoErro: estadoCotas.gemini.ultimoErro
    },
    {
      id: "serpapi",
      nome: "Google Trends (SerpApi)",
      configurado: Boolean(cfg.serpApiKey),
      usado: estadoCotas.serpapi.usado,
      limite: cfg.limiteCotaSerpApi,
      bloqueado: estadoCotas.serpapi.bloqueadoPorLimite,
      ultimoErro: estadoCotas.serpapi.ultimoErro
    },
    {
      id: "newsapi",
      nome: "NewsAPI / GNews",
      configurado: Boolean(cfg.newsApiKey || cfg.gnewsApiKey),
      usado: estadoCotas.newsapi.usado,
      limite: cfg.limiteCotaNewsApi,
      bloqueado: estadoCotas.newsapi.bloqueadoPorLimite,
      ultimoErro: estadoCotas.newsapi.ultimoErro
    },
    {
      id: "hackernews",
      nome: "Comunidades / HN",
      configurado: true,
      usado: estadoCotas.hackernews.usado,
      limite: cfg.limiteCotaHn,
      bloqueado: estadoCotas.hackernews.bloqueadoPorLimite,
      ultimoErro: estadoCotas.hackernews.ultimoErro
    }
  ].map((p) => {
    const pct = p.limite > 0 ? Math.min(100, Math.round((p.usado / p.limite) * 100)) : 0;
    let nivel = "normal";
    if (p.bloqueado || pct >= 100) {
      nivel = "esgotado";
    } else if (pct >= 80) {
      nivel = "atencao";
    }
    return {
      ...p,
      percentual: pct,
      nivel
    };
  });

  const alertas = [];
  for (const p of provedores) {
    if (p.nivel === "esgotado") {
      alertas.push({
        provedor: p.nome,
        nivel: "esgotado",
        mensagem:
          p.ultimoErro ||
          "Cota de " + p.nome + " atingiu 100% (" + p.usado + "/" + p.limite + "). Fallback local ativado para nao interromper sua operacao."
      });
    } else if (p.nivel === "atencao") {
      alertas.push({
        provedor: p.nome,
        nivel: "atencao",
        mensagem:
          "Aviso de limite proximo: " +
          p.nome +
          " consumiu " +
          p.percentual +
          "% da cota (" +
          p.usado +
          "/" +
          p.limite +
          " requisicoes). Priorize leituras em cache."
      });
    }
  }

  return {
    provedores,
    alertas,
    possuiAlerta: alertas.length > 0
  };
}

/* ==========================================================================
   4. SISTEMA DE CACHE COM TTL E METADADOS DE FRESCOR
   ========================================================================== */
const cacheMemoria = new Map();

export async function comCacheTtl(chave, ttlMs, produzir) {
  const agora = Date.now();
  const entrada = cacheMemoria.get(chave);

  if (entrada && agora - entrada.em < ttlMs) {
    return {
      ...entrada.valor,
      cache: true,
      carregadoEm: entrada.em
    };
  }

  const produzido = await produzir();
  const momento = Date.now();
  const valorArmazenado = {
    ...produzido,
    carregadoEm: momento
  };
  cacheMemoria.set(chave, { em: momento, valor: valorArmazenado });

  return {
    ...valorArmazenado,
    cache: false,
    carregadoEm: momento
  };
}

export async function comCache(chave, produzir) {
  const cfg = obterConfig();
  return comCacheTtl(chave, cfg.cacheMs, produzir);
}

export function limparCacheModulo() {
  cacheMemoria.clear();
}

/* ==========================================================================
   5. SEGURANCA DE LEITURA, GUARDA DE ESCRITA E LEITURA DE CORPO
   ========================================================================== */
export function exigirToken(req) {
  const cfg = obterConfig();
  if (cfg.mock) {
    return { autenticado: true, modo: "mock" };
  }

  if (cfg.tokenAcesso) {
    const headerToken =
      req?.headers?.["x-pin"] ||
      req?.headers?.["x-acesso"] ||
      req?.headers?.["x-api-token"] ||
      (req?.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();

    if (headerToken && headerToken !== cfg.tokenAcesso) {
      throw new ErroHttp(
        401,
        "Token de acesso invalido para o modulo TrendRadar.",
        "Verifique o valor de TRENDRADAR_TOKEN no arquivo .env."
      );
    }
  }

  return { autenticado: true, modo: "ao_vivo" };
}

export function guardaDeEscrita(req) {
  const cfg = obterConfig();

  if (cfg.readOnly) {
    throw new ErroHttp(
      403,
      "Modo somente leitura ativo (READ_ONLY=1). Escritas estao desabilitadas.",
      "Altere READ_ONLY=0 no arquivo .env para permitir importar CSV ou pesquisar novos alvos."
    );
  }

  // Requisicao autenticada com PIN correto passa direto na guarda de escrita
  const pinEnviado =
    req?.headers?.["x-pin"] ||
    req?.headers?.["x-acesso"] ||
    req?.headers?.["x-api-token"] ||
    (req?.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const pinCorreto = String(process.env.PIN_ACESSO || process.env.TRENDRADAR_TOKEN || "").trim();
  if (pinCorreto && pinEnviado === pinCorreto) {
    return true;
  }

  const origin = req?.headers?.origin;
  if (!origin) {
    return true;
  }

  try {
    const urlOrigin = new URL(origin);
    const hostOrigin = urlOrigin.hostname;
    if (hostOrigin === "localhost" || hostOrigin === "127.0.0.1") {
      return true;
    }

    const hostReq = String(req?.headers?.host || "").split(":")[0];
    const hostFwd = String(req?.headers?.["x-forwarded-host"] || "").split(":")[0];
    if ((hostReq && hostOrigin === hostReq) || (hostFwd && hostOrigin === hostFwd)) {
      return true;
    }
  } catch (_err) {
    // Origin malformado cai no bloqueio 403 abaixo
  }

  throw new ErroHttp(
    403,
    "Origem da requisicao bloqueada pela guarda de seguranca.",
    "Execute a operacao a partir da propria interface local ou do mesmo dominio do servidor."
  );
}

export async function lerCorpo(req) {
  if (req && req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return req.body;
  }
  if (req && typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_err) {
      throw new ErroHttp(400, "JSON invalido no corpo da requisicao.", "Envie um objeto JSON valido.");
    }
  }

  return new Promise((resolve, reject) => {
    let bruto = "";
    req.on("data", (chunk) => {
      bruto += chunk;
      if (bruto.length > 1048576) {
        reject(new ErroHttp(413, "Corpo da requisicao excede 1MB.", "Reduza o tamanho do arquivo CSV ou payload."));
      }
    });
    req.on("end", () => {
      if (!bruto.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(bruto));
      } catch (_err) {
        reject(new ErroHttp(400, "JSON invalido no corpo da requisicao.", "Verifique a formatacao do JSON enviado."));
      }
    });
    req.on("error", () => {
      reject(new ErroHttp(400, "Falha ao ler o corpo da requisicao.", "Tente novamente."));
    });
  });
}

/* ==========================================================================
   8. MOTOR MATEMATICO DE ANALISE DE SERIES TEMPORAIS (CONSISTENCIA VS PICO)
   ========================================================================== */
export function analisarSerieTemporal(serie = []) {
  const pontos = Array.isArray(serie)
    ? serie
        .map((p) => ({
          data: String(p.data || "").trim(),
          valor: Math.max(0, Number(p.valor || 0))
        }))
        .filter((p) => p.data && !Number.isNaN(p.valor))
    : [];

  if (pontos.length < 2) {
    return {
      crescimentoPct: 0,
      consistenciaScore: 50,
      classificacaoCurva: "Dados Insuficientes",
      corHex: "#5856d6",
      pontuacao: 50
    };
  }

  const metade = Math.max(1, Math.floor(pontos.length / 2));
  const inicio = pontos.slice(0, metade);
  const fim = pontos.slice(pontos.length - metade);

  const mediaInicio = inicio.reduce((acc, x) => acc + x.valor, 0) / inicio.length;
  const mediaFim = fim.reduce((acc, x) => acc + x.valor, 0) / fim.length;

  const base = Math.max(5, mediaInicio);
  const crescimentoPct = Math.round(((mediaFim - base) / base) * 100);

  let passosPositivos = 0;
  for (let i = 1; i < pontos.length; i++) {
    if (pontos[i].valor >= pontos[i - 1].valor * 0.94) {
      passosPositivos++;
    }
  }
  const proporcaoSubida = passosPositivos / (pontos.length - 1);

  const maiorValor = Math.max(...pontos.map((p) => p.valor), 1);
  const ultimoValor = pontos[pontos.length - 1].valor;
  const retencaoPosPico = ultimoValor / maiorValor;

  const consistenciaScore = Math.max(
    15,
    Math.min(98, Math.round(proporcaoSubida * 65 + retencaoPosPico * 35))
  );

  let classificacaoCurva = "Estavel Consolidado";
  let corHex = "#5856d6";

  if (crescimentoPct >= 35 && consistenciaScore >= 75) {
    classificacaoCurva = "Crescimento Consistente";
    corHex = "#34c759";
  } else if (crescimentoPct >= 80 && consistenciaScore >= 65) {
    classificacaoCurva = "Emergente Acelerado";
    corHex = "#ff9500";
  } else if (consistenciaScore < 58 || retencaoPosPico < 0.62) {
    classificacaoCurva = "Pico Sazonal / Hype";
    corHex = "#ff3b30";
  }

  const pontuacao = Math.max(
    25,
    Math.min(
      98,
      Math.round(consistenciaScore * 0.6 + Math.min(160, Math.max(0, crescimentoPct)) * 0.25)
    )
  );

  return {
    crescimentoPct,
    consistenciaScore,
    classificacaoCurva,
    corHex,
    pontuacao
  };
}

/* ==========================================================================
   ENTRADAS DE UM ALVO NOVO: o que voce pesquisa e o que voce importa
   Ambas viram uma linha de radar_descobertas (mesma lista da tela).
   ========================================================================== */
const diaDeHoje = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const capitalizar = (t) => String(t || "").trim().replace(/^./, (c) => c.toUpperCase());
const sinalDe = (m) => ({ titulo: m.titulo, fonte: m.fonte, url: m.url, data: m.data });

/** Google Trends (SerpApi), SO se voce configurou a chave. Serie real ou null. */
async function serieRealTrends(termo, cfg) {
  if (!cfg.serpApiKey || estadoCotas.serpapi.bloqueadoPorLimite) return null;
  try {
    registrarUsoCota("serpapi", 1);
    const r = await fetch("https://serpapi.com/search.json?engine=google_trends&q=" + encodeURIComponent(termo) +
      "&data_type=TIMESERIES&geo=BR&api_key=" + encodeURIComponent(cfg.serpApiKey));
    if (r.status === 429 || r.status === 402 || r.status === 403) { registrarLimiteCota("serpapi", r.status); return null; }
    if (!r.ok) return null;
    const j = await r.json();
    const t = j?.interest_over_time?.timeline_data || [];
    const serie = t.slice(-26).map((p) => ({ data: String(p.date || "").slice(0, 24), valor: Number(p.values?.[0]?.extracted_value) }))
      .filter((p) => p.data && Number.isFinite(p.valor));
    return serie.length >= 4 ? serie : null;
  } catch (_e) { return null; }
}

/** Regioes REAIS (SerpApi, por estado). Sem chave ou sem resposta: null. Nunca completa com estimativa. */
export async function coletarRegioesReais(termo, cfg) {
  if (!cfg.serpApiKey || estadoCotas.serpapi.bloqueadoPorLimite) return null;
  try {
    registrarUsoCota("serpapi", 1);
    const r = await fetch("https://serpapi.com/search.json?engine=google_trends&q=" + encodeURIComponent(termo) +
      "&data_type=GEO_MAP_0&geo=BR&inc_low_vol=true&api_key=" + encodeURIComponent(cfg.serpApiKey));
    if (r.status === 429 || r.status === 402 || r.status === 403) { registrarLimiteCota("serpapi", r.status); return null; }
    if (!r.ok) return null;
    const j = await r.json();
    const lista = (Array.isArray(j?.interest_by_region) ? j.interest_by_region : [])
      .map((x) => ({ regiao: String(x.location || x.geo || ""), indice: Number(x.extracted_value) }))
      .filter((x) => x.regiao && Number.isFinite(x.indice) && x.indice > 0)
      .sort((a, b) => b.indice - a.indice).slice(0, 10);
    return lista.length ? lista : null;
  } catch (_e) { return null; }
}

/**
 * Pesquisa um alvo: imprensa real (Google Noticias), serie e regioes reais SE
 * houver chave do SerpApi, e hipoteses da IA ancoradas nas manchetes. Grava em
 * radar_descobertas. Se `descobertaId` vier, atualiza aquela linha em vez de criar.
 */
export async function investigarTermoMultiFonte(payload = {}) {
  const termo = String(payload.termo || payload.nome || "").trim();
  if (termo.length < 3) {
    throw new ErroHttp(400, "Informe o assunto, empresa ou dor para pesquisar.", "Ex.: 'glosas médicas', 'reforma tributária', 'Totvs'.");
  }
  const cfg = obterConfig();

  let janelas = null;
  try {
    const noticias = await buscarNoticias(termo, { dias: 14 });
    janelas = contarJanelas(filtrarRelevantes(noticias, termo), new Date(), termo);
  } catch (_e) { /* sem imprensa agora: a tela diz que nao mediu, nao inventa */ }

  const [serie, regioes] = await Promise.all([serieRealTrends(termo, cfg), coletarRegioesReais(termo, cfg)]);
  const manchetes = janelas ? janelas.manchetes : [];
  const hip = await gerarHipoteses({ termo, manchetes, dor: payload.dor || "" });

  const dossie = hip ? {
    quemPaga: hip.quemPaga, dores: hip.dores, concorrentesProvaveis: hip.concorrentesProvaveis,
    testeRapido: hip.testeRapido, validar: hip.validar, geradoPor: hip.geradoPor, geradoEm: hip.geradoEm,
  } : null;
  const campos = {
    status: "investigada",
    dossie, serie, regioes,
    sinais: manchetes.map(sinalDe),
  };

  let linha;
  if (payload.descobertaId) {
    const atual = await buscarDescoberta(String(payload.descobertaId));
    if (!atual) throw new ErroHttp(404, "Descoberta nao encontrada.", "Atualize a tela e tente de novo.");
    // mantem as manchetes que sustentaram a descoberta e soma as novas, sem repetir
    const vistos = new Set();
    const sinais = [...(atual.sinais || []), ...campos.sinais].filter((s) => {
      const k = normalizarChave(s.titulo).slice(0, 70);
      if (!k || vistos.has(k)) return false; vistos.add(k); return true;
    }).slice(0, 8);
    await atualizarDescoberta(atual.id, { ...campos, sinais });
    linha = { ...atual, ...campos, sinais };
  } else {
    linha = await gravarAlvo({
      chave: normalizarChave(termo),
      titulo: hip ? hip.nome : capitalizar(termo),
      frente: (hip && hip.frente) || "outras",
      termo,
      dor: hip ? `Quem paga: ${hip.quemPaga}. ${hip.dores[0]}` : null,
      porque_agora: null,
      afinidade: null,
      origem: "pesquisa",
      ...campos,
    });
  }

  if (janelas) {
    await gravarPulso([{
      item_id: "c:" + normalizarChave(termo), dia: diaDeHoje(),
      mencoes_7d: janelas.sete, mencoes_prev_7d: janelas.anteriores,
      manchetes: janelas.manchetes, coletado_em: new Date().toISOString(),
    }]).catch(() => {});
  }
  return { id: linha.id, titulo: linha.titulo, comIa: Boolean(hip), comImprensa: Boolean(janelas && (janelas.sete || janelas.anteriores)) };
}

/** Le o CSV do Google Trends (AAAA-MM[-DD],valor). Pura. */
export function lerCsvTrends(csvBruto, nomePedido = "") {
  let nome = String(nomePedido || "").trim();
  const serie = [];
  for (const linha of String(csvBruto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (linha.startsWith("#")) continue;
    const partes = linha.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (partes.length < 2) continue;
    const [colData, colValor] = partes;
    if (!nome && /^(semana|mes|mês|data|day|week|month)$/i.test(colData)) {
      nome = colValor.replace(/:\s*\(.*\)$/, "").trim();
      continue;
    }
    const v = colValor === "<1" ? 1 : Number(colValor);
    if (Number.isFinite(v) && /\d{4}/.test(colData)) serie.push({ data: colData, valor: Math.max(0, Math.min(100, v)) });
  }
  return { nome, serie };
}

/** Importa uma serie do Google Trends que VOCE exportou: dado seu, entra como alvo. */
export async function importarCsvGoogleTrends(payload = {}) {
  const csv = String(payload.csv || "").trim();
  if (!csv) throw new ErroHttp(400, "Conteudo CSV vazio.", "Cole o CSV exportado do Google Trends (Data,Valor).");
  const { nome, serie } = lerCsvTrends(csv, payload.nome);
  if (serie.length < 2) {
    throw new ErroHttp(400, "Nao achei pelo menos 2 periodos validos no CSV.", "Use linhas no formato AAAA-MM,valor (ex.: 2026-05,45).");
  }
  const termo = nome || "Tendência importada";
  const frente = String(payload.frente || "outras").trim() || "outras";
  const linha = await gravarAlvo({
    chave: normalizarChave(termo), titulo: capitalizar(termo), frente, termo,
    dor: null, porque_agora: null, sinais: [], afinidade: null, dossie: null, regioes: null,
    status: "investigada", origem: "csv", serie: serie.slice(-52),
  });
  return { id: linha.id, titulo: linha.titulo, periodos: serie.length };
}

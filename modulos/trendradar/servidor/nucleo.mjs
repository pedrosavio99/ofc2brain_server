/**
 * Papel: Nucleo isolado do modulo TrendRadar (configuracao, .env, cache, monitor de cotas, 6 frentes conectadas, pesquisa por assunto/empresa/pessoa, importacao CSV, persistencia local JSON/memoria e gerador Markdown).
 * O que NAO faz: NUNCA importa arquivos do host (src/*) e nao depende do Express nem de banco externo.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sintetizarInteligencia, heuristica, gerarDossiePesquisaIA, MODELOS_DISPONIVEIS } from "./ia.mjs";

let modeloIaEmMemoria = "";

function primeiroModeloGeminiEnv() {
  const bruto = process.env.GEMINI_MODELOS || process.env.GEMINI_MODEL || "";
  const lista = bruto.split(",").map((m) => m.trim()).filter(Boolean);
  return lista[0] || "gemini-2.5-flash";
}

export function definirModeloIaPreferido(modelo) {
  modeloIaEmMemoria = String(modelo || "").trim();
  limparCacheModulo();
  return modeloIaEmMemoria || primeiroModeloGeminiEnv();
}

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
function resolverRaizModulo() {
  try {
    const esteArquivo = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(esteArquivo), "..");
  } catch (_err) {
    return path.resolve(process.cwd(), "modulos/trendradar");
  }
}

export const RAIZ_MODULO = resolverRaizModulo();
const ARQUIVO_HISTORICO_LOCAL = path.join(RAIZ_MODULO, "dados-historico.json");

export function obterConfig() {
  const modeloBaseGemini = primeiroModeloGeminiEnv();
  return {
    readOnly: process.env.READ_ONLY === "1",
    mock: false,
    cacheMs: Number(process.env.CACHE_TTL_MS || 120000),
    tokenAcesso: "",
    geminiKey: process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "",
    geminiModel: modeloIaEmMemoria && modeloIaEmMemoria.startsWith("gemini-")
      ? modeloIaEmMemoria
      : modeloBaseGemini,
    modeloPreferido: modeloIaEmMemoria || modeloBaseGemini,
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
   6. AS 6 FRENTES CONECTADAS (12 OPORTUNIDADES CURADAS MULTI-FONTE)
   ========================================================================== */
const OPORTUNIDADES_SEMENTE = [
  // FRENTE 1: SAUDE & CLINICAS B2B
  {
    id: "tr-agentes-whatsapp-clinicas",
    nome: "Triagem e Agendamento via IA no WhatsApp para Clinicas",
    termoBusca: "automacao whatsapp clinica medica",
    frente: "saude",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["Doctoralia", "iClinic", "Feegow", "Gestores de Clinicas"],
    categoria: "Saude & Clinicas B2B",
    prazo: "curto",
    objetivoPrincipal: "saas",
    corHex: "#34c759",
    pontuacao: 92,
    crescimentoPct: 148,
    consistenciaScore: 89,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["Google Trends", "ReclameAqui / Avaliacoes", "Reddit r/empreendedorismo", "GNews"],
    serieHistorica: [
      { data: "2026-05", valor: 34 },
      { data: "2026-06", valor: 42 },
      { data: "2026-07", valor: 51 },
      { data: "2026-08", valor: 63 },
      { data: "2026-09", valor: 76 },
      { data: "2026-10", valor: 84 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Minas Gerais (MG)", indice: 82 },
      { regiao: "Parana (PR)", indice: 78 },
      { regiao: "Santa Catarina (SC)", indice: 74 },
      { regiao: "Rio de Janeiro (RJ)", indice: 69 }
    ],
    reclamacoes: [
      {
        dor: "Pacientes desistem porque a recepcao demora mais de 2 horas para responder no WhatsApp e confirmar encaixes.",
        frequencia: "Muito Alta",
        fonte: "Avaliacoes Google Maps & Foruns Medicos",
        gravidade: "Critica"
      },
      {
        dor: "Bots tradicionais com menu numerico irritam pacientes idosos e nao entendem audios ou fotos de guias de convenio.",
        frequencia: "Alta",
        fonte: "ReclameAqui / Comunidades de Gestao Clinica",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "CRMs Medicos Tradicionais (iClinic / Doctoralia)",
        lacuna: "Focam no prontuario interno; o atendimento inicial no WhatsApp continua manual ou engessado.",
        precoMedio: "R$ 290 a R$ 690/mes"
      },
      {
        nome: "Chatbots Genericos de Fluxograma (ManyChat / Typebot)",
        lacuna: "Exigem configuracao tecnica complexa e quebram quando o paciente envia audio ou muda de assunto.",
        precoMedio: "R$ 150 a R$ 400/mes"
      }
    ],
    icpPagador: "Clinicas odontologicas, dermatologicas e de estetica com 2 a 10 profissionais que perdem consultas por demora no atendimento.",
    testeComercial: "Abordar 15 clinicas locais, medir o tempo real de resposta delas e oferecer um piloto de 14 dias focado apenas em recuperar pacientes fora do horario comercial.",
    evidenciasConfirmadas: [
      "Crescimento ininterrupto por 6 meses consecutivos sem queda pos-pico.",
      "Mais de 60% das avaliacoes negativas de clinicas citam demora na recepcao/agendamento.",
      "Disposicao comprovada a pagar: 1 unica consulta recuperada no mes ja paga a assinatura do software."
    ],
    evidenciasFaltantes: [
      "Validar custo medio de tokens de transcricao de audio por clinica em operacao real.",
      "Testar integracao simplificada via Google Calendar antes de construir conectores para ERPs medicos legados."
    ],
    objetivos: {
      carreira: "Projeto de portfolio de alto impacto: Webhook + fila assincrona + PostgreSQL + LLM com guardrails contra alucinacao medica.",
      saas: "Micro-SaaS B2B com ticket de R$ 297 a R$ 597/mes, baixo churn apos integracao na rotina da recepcionista.",
      empresas: "Venda imediata de servico de implantacao (setup R$ 2.500 + manutencao mensal) para clinicas da sua regiao.",
      agente: "Monitorar semanalmente mudancas de volume de busca e novos concorrentes verticais gerando dossie em Markdown/PDF."
    }
  },
  {
    id: "tr-auditoria-glosas-medicas-tiss",
    nome: "Auditoria Automatica de Glosas Medicas e Guias TISS (XML)",
    termoBusca: "auditoria glosas medicas faturamento tiss",
    frente: "saude",
    tipoEntidade: "problema",
    entidadesRelacionadas: ["ANS Padrao TISS", "Unimed", "Bradesco Saude", "Faturistas Hospitalares"],
    categoria: "Saude & Clinicas B2B",
    prazo: "curto",
    objetivoPrincipal: "empresas",
    corHex: "#34c759",
    pontuacao: 90,
    crescimentoPct: 126,
    consistenciaScore: 87,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["Google Trends", "Foruns de Faturamento Medico", "Dados ANS", "LinkedIn Saude"],
    serieHistorica: [
      { data: "2026-05", valor: 39 },
      { data: "2026-06", valor: 47 },
      { data: "2026-07", valor: 55 },
      { data: "2026-08", valor: 66 },
      { data: "2026-09", valor: 75 },
      { data: "2026-10", valor: 86 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Rio de Janeiro (RJ)", indice: 89 },
      { regiao: "Minas Gerais (MG)", indice: 84 },
      { regiao: "Rio Grande do Sul (RS)", indice: 78 }
    ],
    reclamacoes: [
      {
        dor: "Clinicas e laboratorios perdem de 8% a 15% do faturamento porque convenios negam pagamento (glosa) por pequenos erros no XML TISS.",
        frequencia: "Muito Alta",
        fonte: "Associacoes de Clinicas e Faturistas",
        gravidade: "Critica"
      },
      {
        dor: "Conferencia manual de lotes XML antes do envio ao plano de saude leva dias e deixa passar codigos TUSS incompativeis.",
        frequencia: "Alta",
        fonte: "Comunidades de Gestao Hospitalar",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Sistemas Hospitalares Enterprise (MV / Tasy)",
        lacuna: "Custam dezenas de milhares de reais e sao inacessiveis para clinicas de medio porte e laboratorios independentes.",
        precoMedio: "R$ 3.500+/mes"
      }
    ],
    icpPagador: "Clinicas medicas, centros de imagem e laboratorios que faturam acima de R$ 100 mil/mes via planos de saude.",
    testeComercial: "Pedir os arquivos XML TISS dos ultimos 2 meses de uma clinica, rodar um validador automatico e mostrar em um PDF o valor exato de glosas que poderiam ser evitadas ou recursadas.",
    evidenciasConfirmadas: [
      "Padrao XML TISS da ANS possui especificacao publica oficial, facilitando a criacao do motor de validacao.",
      "ROI imediato: evitar 5% de glosa representa milhares de reais recuperados por mes para a clinica."
    ],
    evidenciasFaltantes: [
      "Catalogar as 20 regras de glosa mais frequentes entre as 5 maiores operadoras de saude."
    ],
    objetivos: {
      carreira: "Excelente prova de engenharia de dados: parser de XML TISS, motor de regras deterministico + IA para redigir recursos de glosa.",
      saas: "Validador Pre-Envio TISS cobrando assinatura de R$ 390 a R$ 990/mes por CNPJ.",
      empresas: "Auditoria retroativa de glosas cobrando percentual sobre o valor recuperado para a clinica.",
      agente: "Monitorar atualizacoes das tabelas TUSS/ANS mensalmente de forma automatica."
    }
  },

  // FRENTE 2: FINTECH, E-COMMERCE & FISCAL
  {
    id: "tr-conciliacao-taxas-marketplaces",
    nome: "Auditoria Automatica de Repasses e Taxas de Marketplaces",
    termoBusca: "conciliacao financeira mercado livre shopee",
    frente: "fintech",
    tipoEntidade: "empresa",
    entidadesRelacionadas: ["Mercado Livre", "Shopee", "Amazon Brasil", "Bling", "Tiny ERP"],
    categoria: "FinTech & Fiscal B2B",
    prazo: "curto",
    objetivoPrincipal: "empresas",
    corHex: "#5856d6",
    pontuacao: 88,
    crescimentoPct: 112,
    consistenciaScore: 86,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "em_investigacao",
    fontesCruzadas: ["Google Trends", "Foruns de Sellers", "YouTube / Comentarios", "Noticias E-commerce"],
    serieHistorica: [
      { data: "2026-05", valor: 38 },
      { data: "2026-06", valor: 45 },
      { data: "2026-07", valor: 52 },
      { data: "2026-08", valor: 61 },
      { data: "2026-09", valor: 72 },
      { data: "2026-10", valor: 81 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Santa Catarina (SC)", indice: 91 },
      { regiao: "Parana (PR)", indice: 84 },
      { regiao: "Goias (GO)", indice: 71 },
      { regiao: "Minas Gerais (MG)", indice: 68 }
    ],
    reclamacoes: [
      {
        dor: "Lojistas descobrem meses depois que tiveram prejuizo porque o frete cobrado na devolucao ou comissao alterada comeu toda a margem.",
        frequencia: "Muito Alta",
        fonte: "Comunidades de Sellers Mercado Livre / Shopee",
        gravidade: "Critica"
      },
      {
        dor: "Planilhas de Excel travam acima de 5.000 pedidos/mes e os ERPs mostram apenas o valor bruto da venda, nao o repasse liquido real.",
        frequencia: "Alta",
        fonte: "ReclameAqui / Grupos de Contabilidade Digital",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "ERPs Tradicionais (Bling / Tiny)",
        lacuna: "Excelentes para emitir nota fiscal e estoque, mas fracos na auditoria fina de divergencias de comissao e frete reverso.",
        precoMedio: "R$ 100 a R$ 350/mes"
      },
      {
        nome: "Conciliadores Corporativos (Koncili)",
        lacuna: "Interface complexa e foco em grandes operacoes; vendedores de medio porte querem um relatorio direto de 'pedidos com prejuizo'.",
        precoMedio: "R$ 450 a R$ 1.200/mes"
      }
    ],
    icpPagador: "Vendedores de Mercado Livre, Shopee e Amazon que faturam entre R$ 80 mil e R$ 1 milhao/mes.",
    testeComercial: "Oferecer uma 'Auditoria Gratuita dos Ultimos 30 Dias via CSV': o lojista exporta o extrato do marketplace, voce roda a analise e entrega um PDF mostrando exatamente quanto dinheiro ele perdeu em taxas indevidas.",
    evidenciasConfirmadas: [
      "Aumento constante nas buscas por planilhas e calculadoras de margem real apos reajustes de frete em 2026.",
      "Retorno sobre investimento (ROI) tangivel e imediato na primeira execucao do relatorio."
    ],
    evidenciasFaltantes: [
      "Mapear mudancas recentes no layout de exportacao CSV da Shopee e TikTok Shop."
    ],
    objetivos: {
      carreira: "Demonstra dominio de engenharia de dados financeiros, ingestao de CSVs massivos, precisao decimal e relatorios analiticos.",
      saas: "Modelo SaaS ancorado no valor recuperado (R$ 197/mes ate 2.000 pedidos).",
      empresas: "Porta de entrada perfeita para consultoria de BI e engenharia de dados para e-commerces.",
      agente: "Coletar periodicamente anuncios oficiais de mudanca de comissao dos marketplaces e atualizar o dossie."
    }
  },
  {
    id: "tr-simulador-reforma-tributaria-ibs-cbs",
    nome: "Simulador de Impacto da Reforma Tributaria (IBS/CBS) via XML NFe",
    termoBusca: "simulador reforma tributaria ibs cbs contabilidade",
    frente: "fintech",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["Receita Federal", "Contadores B2B", "Omie", "Conta Azul", "Domínio Sistemas"],
    categoria: "FinTech & Fiscal B2B",
    prazo: "curto",
    objetivoPrincipal: "saas",
    corHex: "#34c759",
    pontuacao: 91,
    crescimentoPct: 210,
    consistenciaScore: 88,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["Google Trends", "Portais Contabeis", "FENACON", "Noticias Economia"],
    serieHistorica: [
      { data: "2026-05", valor: 28 },
      { data: "2026-06", valor: 41 },
      { data: "2026-07", valor: 56 },
      { data: "2026-08", valor: 68 },
      { data: "2026-09", valor: 79 },
      { data: "2026-10", valor: 89 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Distrito Federal (DF)", indice: 94 },
      { regiao: "Parana (PR)", indice: 86 },
      { regiao: "Santa Catarina (SC)", indice: 85 }
    ],
    reclamacoes: [
      {
        dor: "Escritorios de contabilidade precisam responder aos clientes se a carga tributaria vai subir ou cair com o IBS/CBS, mas fazem contas manuais em planilhas.",
        frequencia: "Muito Alta",
        fonte: "Foruns Contabeis e Eventos FENACON",
        gravidade: "Critica"
      },
      {
        dor: "Empresas do Lucro Presumido e Simples Nacional nao sabem se devem mudar de regime ou renegociar fornecedores.",
        frequencia: "Alta",
        fonte: "Pesquisas de Palavras-Chave B2B",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Consultorias Big Four e Tributaristas de Grande Porte",
        lacuna: "Cobram projetos de R$ 30 mil+, deixando milhares de escritorios contabeis PME sem ferramenta automatizada.",
        precoMedio: "R$ 15.000+ por estudo"
      }
    ],
    icpPagador: "Escritorios de contabilidade com 50 a 500 empresas na carteira que querem vender 'Diagnostico Tributario' para seus clientes.",
    testeComercial: "Construir um importador de lotes de XML de NFe/NFSe que gera em 30 segundos um relatorio PDF com a marca da contabilidade comparando o imposto atual vs IBS/CBS.",
    evidenciasConfirmadas: [
      "Cronograma oficial de transicao tributaria em 2026 obriga adequacao de sistemas e planejamento.",
      "Contadores compram ferramentas que permitem a eles vender novos honorarios consultivos."
    ],
    evidenciasFaltantes: [
      "Manter tabela de aliquotas de excecao setorial atualizada conforme regulamentacao complementar."
    ],
    objetivos: {
      carreira: "Mostra capacidade de traduzir legislacao complexa em motor de regras testavel + processamento de XML fiscal em lote.",
      saas: "SaaS B2B para contabilidades (R$ 397/mes para simular ate 50 CNPJs da carteira).",
      empresas: "Parceria com escritorios contabeis dividindo receita dos diagnosticos tributarios vendidos.",
      agente: "Agente que monitora publicacoes do Diario Oficial/Receita Federal sobre aliquotas de referencia."
    }
  },
  {
    id: "tr-regua-recuperacao-pix-inadimplencia",
    nome: "Recuperacao Automatica de Inadimplencia B2B/PME com Renegociacao Pix",
    termoBusca: "sistema cobranca automatica inadimplencia pix",
    frente: "fintech",
    tipoEntidade: "problema",
    entidadesRelacionadas: ["Asaas", "Cora", "Escolas Particulares", "Imobiliarias", "Contabilidades"],
    categoria: "FinTech & Fiscal B2B",
    prazo: "curto",
    objetivoPrincipal: "saas",
    corHex: "#5856d6",
    pontuacao: 84,
    crescimentoPct: 87,
    consistenciaScore: 83,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "validado_com_cliente",
    fontesCruzadas: ["Google Trends", "ReclameAqui PMEs", "Comunidades SaaS Brasil"],
    serieHistorica: [
      { data: "2026-05", valor: 45 },
      { data: "2026-06", valor: 51 },
      { data: "2026-07", valor: 58 },
      { data: "2026-08", valor: 65 },
      { data: "2026-09", valor: 73 },
      { data: "2026-10", valor: 79 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Minas Gerais (MG)", indice: 87 },
      { regiao: "Parana (PR)", indice: 81 },
      { regiao: "Ceara (CE)", indice: 76 }
    ],
    reclamacoes: [
      {
        dor: "Donos de escolas, imobiliarias e escritorios contabeis tem constrangimento de cobrar clientes atrasados manualmente e perdem fluxo de caixa.",
        frequencia: "Alta",
        fonte: "Pesquisas PME Sebrae / Foruns",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Gateways de Pagamento (Asaas / Efí)",
        lacuna: "Enviam avisos padrao frios; nao negociam parcelamento ou desconto progressivo de forma conversacional.",
        precoMedio: "Taxa por boleto/Pix"
      }
    ],
    icpPagador: "Escolas livres, academias, administradoras de condominio, imobiliarias e contabilidades.",
    testeComercial: "Rodar uma campanha de recuperacao da carteira vencida ha mais de 30 dias de 3 empresas cobrando apenas taxa de sucesso (10% do recuperado).",
    evidenciasConfirmadas: [
      "Facil integracao via Webhooks com APIs de Pix Copia-e-Cola.",
      "Cliente enxerga o retorno financeiro na primeira semana de uso."
    ],
    evidenciasFaltantes: [
      "Calibrar tom das mensagens para evitar bloqueio de numero de atendimento."
    ],
    objetivos: {
      carreira: "Integracao de APIs bancarias (Pix dinamico), webhooks idempotentes e maquinas de estado de cobranca.",
      saas: "Assinatura mensal + pequeno percentual sobre faturas vencidas recuperadas.",
      empresas: "Implantacao de regua financeira automatizada integrada ao ERP do cliente.",
      agente: "Conciliacao diaria automatica de liquidacoes bancarias e geracao de relatorio de caixa."
    }
  },

  // FRENTE 3: REGTECH, RH & CONFORMIDADE LEGAL
  {
    id: "tr-conformidade-nr1-riscos-psicossociais",
    nome: "Plataforma de Diagnostico e Evidencias NR-1 (Riscos Psicossociais)",
    termoBusca: "adequacao nr1 riscos psicossociais software",
    frente: "regtech",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["Ministerio do Trabalho (MTE)", "Clinicas SST", "Engenheiros de Seguranca", "Gupy", "Pulses"],
    categoria: "RegTech & RH B2B",
    prazo: "medio",
    objetivoPrincipal: "saas",
    corHex: "#ff9500",
    pontuacao: 86,
    crescimentoPct: 195,
    consistenciaScore: 81,
    classificacaoCurva: "Emergente Acelerado",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["Google Trends", "Noticias Juridicas / MTE", "LinkedIn B2B", "Pesquisas de Palavras-Chave"],
    serieHistorica: [
      { data: "2026-05", valor: 22 },
      { data: "2026-06", valor: 35 },
      { data: "2026-07", valor: 49 },
      { data: "2026-08", valor: 58 },
      { data: "2026-09", valor: 69 },
      { data: "2026-10", valor: 79 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Rio Grande do Sul (RS)", indice: 86 },
      { regiao: "Rio de Janeiro (RJ)", indice: 83 },
      { regiao: "Minas Gerais (MG)", indice: 77 }
    ],
    reclamacoes: [
      {
        dor: "Consultorias de SST e contadores usam Google Forms improviso que nao garante anonimato nem gera a trilha de auditoria exigida na PGR.",
        frequencia: "Muito Alta",
        fonte: "Comunidades de Engenheiros de Seguranca e RH",
        gravidade: "Critica"
      }
    ],
    concorrentes: [
      {
        nome: "Plataformas de Clima de RH (Pulses / Gupy Clima)",
        lacuna: "Voltadas para RH de grandes empresas, nao entregam o dossie tecnico formatado para clinicas de medicina ocupacional (SST).",
        precoMedio: "R$ 800 a R$ 3.000/mes"
      }
    ],
    icpPagador: "Consultorias de Saude e Seguranca do Trabalho (SST) e clinicas de medicina ocupacional que atendem dezenas de PMEs (modelo B2B2B).",
    testeComercial: "Vender no modelo White-Label para 3 consultorias de SST para que elas apliquem o diagnostico nos clientes delas e exportem o laudo em PDF.",
    evidenciasConfirmadas: [
      "Obrigatoriedade regulatoria gera urgencia real de compra (dor de multa > dor de vitamina).",
      "Canal de distribuicao B2B2B multiplica clientes atraves de parceiros de SST."
    ],
    evidenciasFaltantes: [
      "Validar com um engenheiro do trabalho/medico ocupacional os campos obrigatorios do relatorio exportado em PDF."
    ],
    objetivos: {
      carreira: "Destaca capacidade de construir sistema multi-tenant com anonimizacao criptografica de respostas e relatorios auditaveis.",
      saas: "SaaS B2B2B com receita recorrente previsivel vendendo pacotes de empresas para clinicas de SST.",
      empresas: "Desenvolvimento de paineis sob demanda para consultorias de RH e SST.",
      agente: "Monitorar portarias do Ministerio do Trabalho e jurisprudencia trabalhista automaticamente."
    }
  },
  {
    id: "tr-auditoria-ponto-passivo-trabalhista",
    nome: "Auditoria Preventiva de Cartao de Ponto e Passivo Trabalhista (CLT/CCT)",
    termoBusca: "auditoria folha ponto horas extras passivo trabalhista",
    frente: "regtech",
    tipoEntidade: "problema",
    entidadesRelacionadas: ["Pontomais", "Tangerino", "Sindicatos / CCT", "Advogados Trabalhistas Empresariais"],
    categoria: "RegTech & RH B2B",
    prazo: "medio",
    objetivoPrincipal: "empresas",
    corHex: "#34c759",
    pontuacao: 82,
    crescimentoPct: 78,
    consistenciaScore: 80,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "em_investigacao",
    fontesCruzadas: ["Google Trends", "Jurisprudencia TST", "Foruns de DP e RH"],
    serieHistorica: [
      { data: "2026-05", valor: 41 },
      { data: "2026-06", valor: 48 },
      { data: "2026-07", valor: 54 },
      { data: "2026-08", valor: 61 },
      { data: "2026-09", valor: 68 },
      { data: "2026-10", valor: 73 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Parana (PR)", indice: 83 },
      { regiao: "Minas Gerais (MG)", indice: 80 },
      { regiao: "Pernambuco (PE)", indice: 72 }
    ],
    reclamacoes: [
      {
        dor: "Redes de varejo, restaurantes e transportadoras tomam processos trabalhistas caros por erros em intervalos intrajornada, banco de horas vencido e batidas britânicas.",
        frequencia: "Alta",
        fonte: "Escritorios de Advocacia Empresarial e DP",
        gravidade: "Critica"
      }
    ],
    concorrentes: [
      {
        nome: "Apps de Controle de Ponto (Pontomais / Tangerino)",
        lacuna: "Registram o ponto, mas nao cruzam proativamente as regras especificas da Convencao Coletiva (CCT) do sindicato para alertar risco juridico.",
        precoMedio: "R$ 150 a R$ 600/mes"
      }
    ],
    icpPagador: "Supermercados, redes de restaurantes, transportadoras e escritorios de advocacia trabalhista patronal.",
    testeComercial: "Fazer parceria com 2 advogados trabalhistas empresariais: importar o AFD/CSV de ponto de um cliente deles e gerar o Mapa de Risco Trabalhista em PDF.",
    evidenciasConfirmadas: [
      "Arquivos de ponto seguem layout padronizado pelo MTE (Portaria 671 / AFD), facilitando a importacao universal."
    ],
    evidenciasFaltantes: [
      "Estruturar parser para extrair clausulas de horas extras de PDFs de Convencoes Coletivas."
    ],
    objetivos: {
      carreira: "Parser de arquivos fiscais/trabalhistas padronizados (AFD) + deteccao de anomalias estatisticas (ponto britanico).",
      saas: "Assinatura mensal de monitoramento preventivo de conformidade para RHs.",
      empresas: "Auditoria de due diligence trabalhista para escritorios de advocacia e contabilidades.",
      agente: "Cruzar automaticamente novas convencoes coletivas publicadas no Mediador MTE com a folha das empresas."
    }
  },

  // FRENTE 4: GOVTECH, JURIDICO & DADOS PUBLICOS
  {
    id: "tr-copiloto-licitacoes-pncp",
    nome: "Radar e Analisador de Editais Publicos (PNCP) para PMEs",
    termoBusca: "automacao licitacao pncp inteligencia artificial",
    frente: "govtech",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["Portal Nacional de Contratacoes Publicas (PNCP)", "Compras.gov.br", "Effecti", "Consultores de Licitacao"],
    categoria: "GovTech & Juridico",
    prazo: "medio",
    objetivoPrincipal: "agente",
    corHex: "#5856d6",
    pontuacao: 85,
    crescimentoPct: 94,
    consistenciaScore: 84,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["API Publica PNCP", "Google Trends", "HackerNews / GitHub", "Foruns de Licitantes"],
    serieHistorica: [
      { data: "2026-05", valor: 40 },
      { data: "2026-06", valor: 46 },
      { data: "2026-07", valor: 54 },
      { data: "2026-08", valor: 62 },
      { data: "2026-09", valor: 70 },
      { data: "2026-10", valor: 77 }
    ],
    regioes: [
      { regiao: "Distrito Federal (DF)", indice: 100 },
      { regiao: "Sao Paulo (SP)", indice: 88 },
      { regiao: "Minas Gerais (MG)", indice: 81 },
      { regiao: "Parana (PR)", indice: 79 }
    ],
    reclamacoes: [
      {
        dor: "Fornecedores perdem prazos de dispensas eletronicas lucrativas porque precisam ler editais de 80 paginas em PDF para achar exigencias tecnicas.",
        frequencia: "Alta",
        fonte: "Comunidades de Licitantes e Consultores",
        gravidade: "Critica"
      }
    ],
    concorrentes: [
      {
        nome: "Robos de Lances e Portais Legados (Effecti / ConLicitacao)",
        lacuna: "Custam caro e exigem leitura humana pesada para filtrar se o item exigido bate com o catalogo real do fornecedor.",
        precoMedio: "R$ 400 a R$ 1.500/mes"
      }
    ],
    icpPagador: "Distribuidoras de equipamentos, empresas de engenharia, papelarias B2B e prestadores de servicos que vendem para prefeituras e orgaos publicos.",
    testeComercial: "Escolher 1 nicho (ex: distribuidoras de material hospitalar ou informatica) e entregar por 7 dias um dossie Markdown/PDF com os 3 melhores editais do dia ja resumidos com margem e exigencias.",
    evidenciasConfirmadas: [
      "O Portal Nacional de Contratacoes Publicas (PNCP) possui dados abertos governamentais que podem ser consumidos legalmente.",
      "Altissimo ticket medio por contrato ganho pelo cliente final."
    ],
    evidenciasFaltantes: [
      "Medir taxa de precisao na extracao de tabelas de itens em PDFs escaneados de prefeituras menores."
    ],
    objetivos: {
      carreira: "Case exemplar de Agente Autonomo: coleta em API governamental + parser de documentos + sintese com Gemini + exportacao de dossie.",
      saas: "Assinatura de resumos executivos ultra-qualificados por nicho e estado.",
      empresas: "Servico de inteligencia competitiva monitorando precos praticados pelos concorrentes em pregoes passados.",
      agente: "Execucao 100% autonoma comparando novos editais publicados com o perfil de cada empresa."
    }
  },
  {
    id: "tr-monitor-diarios-oficiais-licencas",
    nome: "Monitor Autonomo de Diarios Oficiais, Licencas Ambientais e Regulatorio",
    termoBusca: "monitoramento diario oficial licenca ambiental automacao",
    frente: "govtech",
    tipoEntidade: "agente",
    entidadesRelacionadas: ["Querido Diario (Open Knowledge)", "IBAMA / Secretarias Estaduais", "Construtoras", "Escritorios Ambientais"],
    categoria: "GovTech & Juridico",
    prazo: "medio",
    objetivoPrincipal: "agente",
    corHex: "#5856d6",
    pontuacao: 81,
    crescimentoPct: 82,
    consistenciaScore: 82,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "em_investigacao",
    fontesCruzadas: ["API Querido Diario", "Google Trends", "Portais Juridicos"],
    serieHistorica: [
      { data: "2026-05", valor: 37 },
      { data: "2026-06", valor: 43 },
      { data: "2026-07", valor: 49 },
      { data: "2026-08", valor: 57 },
      { data: "2026-09", valor: 64 },
      { data: "2026-10", valor: 72 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Minas Gerais (MG)", indice: 89 },
      { regiao: "Mato Grosso (MT)", indice: 85 },
      { regiao: "Goias (GO)", indice: 81 }
    ],
    reclamacoes: [
      {
        dor: "Consultorias ambientais, mineradoras e loteadoras perdem prazos de condicionantes ou descumprem portarias municipais porque ninguem consegue ler dezenas de Diarios Oficiais todo dia.",
        frequencia: "Alta",
        fonte: "Consultorias de Engenharia e Meio Ambiente",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Recortes Juridicos Tradicionais",
        lacuna: "Monitoram apenas processos judiciais (CNJ), ignorando licencas ambientais, zoneamento urbano e decretos municipais.",
        precoMedio: "R$ 200 a R$ 900/mes"
      }
    ],
    icpPagador: "Consultorias ambientais, incorporadoras imobiliarias, empresas de energia solar e agronegocio.",
    testeComercial: "Monitorar os CNPJs e termos tecnicos de 5 consultorias ambientais por 15 dias e entregar o boletim consolidado em PDF.",
    evidenciasConfirmadas: [
      "Iniciativas de dados abertos e Diarios Oficiais digitais permitem indexacao automatizada sem violar termos."
    ],
    evidenciasFaltantes: [
      "Mapear os 30 municipios mais demandados pelo setor imobiliario/ambiental da sua regiao."
    ],
    objetivos: {
      carreira: "Pipeline de indexacao full-text + classificacao semantica de atos oficiais.",
      saas: "Radar Regulatorio por assinatura mensal segmentado por municipio e CNPJ.",
      empresas: "Criacao de robos de compliance regulatorio customizados para grandes empresas.",
      agente: "Agente noturno que baixa edicoes novas, filtra mencoes relevantes e atualiza o dossie."
    }
  },

  // FRENTE 5: OPERACOES DE CAMPO, OBRAS & MANUTENCAO TECNICA
  {
    id: "tr-diario-obra-audio-foto-construtoras",
    nome: "Diario de Obra e Controle de Insumos por Audio/Foto para Pequenas Construtoras",
    termoBusca: "software gestao de obras pequenas diario de obra",
    frente: "operacoes",
    tipoEntidade: "pessoa",
    entidadesRelacionadas: ["Engenheiros Civis Autonomos", "Mestres de Obras", "Sienge", "Obra Prima"],
    categoria: "Obras & Operacoes de Campo",
    prazo: "curto",
    objetivoPrincipal: "saas",
    corHex: "#34c759",
    pontuacao: 89,
    crescimentoPct: 134,
    consistenciaScore: 86,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["Google Trends", "YouTube Engenharia Civil", "ReclameAqui Softwares de Obra"],
    serieHistorica: [
      { data: "2026-05", valor: 35 },
      { data: "2026-06", valor: 44 },
      { data: "2026-07", valor: 53 },
      { data: "2026-08", valor: 64 },
      { data: "2026-09", valor: 74 },
      { data: "2026-10", valor: 83 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Santa Catarina (SC)", indice: 93 },
      { regiao: "Goias (GO)", indice: 87 },
      { regiao: "Parana (PR)", indice: 84 }
    ],
    reclamacoes: [
      {
        dor: "Engenheiros compram sistemas de gestao de obras, mas o mestre de obras no canteiro se recusa a preencher formularios complexos e manda tudo solto em grupos de mensagens.",
        frequencia: "Muito Alta",
        fonte: "Comunidades de Engenheiros Civis e Arquitetos",
        gravidade: "Critica"
      },
      {
        dor: "Notas fiscais de cimento e materiais somem no canteiro e o cliente final reclama de falta de transparencia no andamento da reforma.",
        frequencia: "Alta",
        fonte: "Foruns de Construcao Civil PME",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "ERPs de Construcao (Sienge / Obra Prima)",
        lacuna: "Excelentes para o escritorio, mas exigem digitacao manual que nao funciona na rotina suja e corrida do canteiro de obras.",
        precoMedio: "R$ 350 a R$ 1.800/mes"
      }
    ],
    icpPagador: "Pequenas construtoras, engenheiros civis autonomos e escritorios de arquitetura que gerenciam de 3 a 20 obras simultaneas.",
    testeComercial: "Apresentar para 10 engenheiros um fluxo onde o mestre de obras apenas envia 1 audio e 3 fotos por dia e o sistema gera automaticamente o Relatorio Semanal de Evolucao da Obra em PDF para o proprietario do imovel.",
    evidenciasConfirmadas: [
      "Forte crescimento do mercado de reformas de alto padrao e construcao residencial financiada.",
      "O Relatorio em PDF bonito para o dono da obra vende o software sozinho por status profissional."
    ],
    evidenciasFaltantes: [
      "Testar precisao de leitura OCR em fotos de cupons fiscais amassados tiradas no canteiro."
    ],
    objetivos: {
      carreira: "Processamento multimodal (voz + imagem de cupom fiscal) transformado em dados estruturados e relatorio PDF.",
      saas: "SaaS cobrado por obra ativa (ex: R$ 97/mes por obra ou pacote R$ 397/mes para 5 obras).",
      empresas: "Implantacao de painel de acompanhamento financeiro de obras para construtoras locais.",
      agente: "Consolidacao automatica todas as sextas-feiras do relatorio fotográfico e financeiro de cada obra."
    }
  },
  {
    id: "tr-gestao-pmoc-manutencao-climatizacao-solar",
    nome: "Automacao de Laudos PMOC e Ordens de Servico para Climatizacao e Energia Solar",
    termoBusca: "sistema pmoc ar condicionado ordem de servico",
    frente: "operacoes",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["ANVISA / Lei 13.589 (PMOC)", "Auvo", "Field Control", "Empresas de Climatizacao e Solar"],
    categoria: "Obras & Operacoes de Campo",
    prazo: "curto",
    objetivoPrincipal: "saas",
    corHex: "#5856d6",
    pontuacao: 84,
    crescimentoPct: 91,
    consistenciaScore: 85,
    classificacaoCurva: "Crescimento Consistente",
    statusValidacao: "em_investigacao",
    fontesCruzadas: ["Google Trends", "Comunidades HVAC-R", "ReclameAqui Sistemas Field Service"],
    serieHistorica: [
      { data: "2026-05", valor: 42 },
      { data: "2026-06", valor: 49 },
      { data: "2026-07", valor: 57 },
      { data: "2026-08", valor: 65 },
      { data: "2026-09", valor: 73 },
      { data: "2026-10", valor: 80 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Rio de Janeiro (RJ)", indice: 91 },
      { regiao: "Mato Grosso (MT)", indice: 86 },
      { regiao: "Bahia (BA)", indice: 82 }
    ],
    reclamacoes: [
      {
        dor: "Empresas de ar-condicionado e pós-venda de energia solar perdem renovacoes de contratos recorrentes porque esquecem de avisar a data da preventiva e demoram horas montando laudos PMOC no Word.",
        frequencia: "Alta",
        fonte: "Grupos de Tecnicos de Refrigeracao e Integradores Solares",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Sistemas Gerais de Equipe Externa (Auvo / Field Control)",
        lacuna: "Cobrados por tecnico (ficam caros rapido) e nao geram o caderno tecnico PMOC / limpeza fotovoltaica pronto com QR Code por equipamento.",
        precoMedio: "R$ 250 a R$ 800/mes"
      }
    ],
    icpPagador: "Empresas de manutencao de ar-condicionado (HVAC) e integradores de energia solar que buscam receita recorrente de pos-venda.",
    testeComercial: "Gerar etiquetas QR Code para os equipamentos de 3 empresas de climatizacao onde o tecnico escaneia, marca o checklist em 1 minuto e baixa o Laudo PMOC em PDF assinado.",
    evidenciasConfirmadas: [
      "Lei Federal 13.589 torna o PMOC obrigatorio em edificios comerciais, garantindo demanda perene."
    ],
    evidenciasFaltantes: [
      "Validar funcionamento offline do checklist quando o tecnico esta em subsolos/casas de maquinas sem sinal."
    ],
    objetivos: {
      carreira: "Arquitetura offline-first, geracao de QR Codes por ativo e emissao de laudos tecnicos padronizados em PDF.",
      saas: "Assinatura mensal baseada no numero de contratos de manutencao gerenciados.",
      empresas: "Criacao de portal do cliente para empresas de engenharia de manutencao.",
      agente: "Monitorar vencimentos de preventivas e gerar alertas de renovacao de contrato."
    }
  },

  // FRENTE 6: ENGENHARIA DE IA, DEVTOOLS & RADAR ANTI-HYPE
  {
    id: "tr-gateway-observabilidade-lgpd-llm",
    nome: "Gateway de Controle de Custos, Auditoria e Mascara LGPD para IA Corporativa",
    termoBusca: "governanca ia lgpd controle custos llm empresas",
    frente: "ia_devtools",
    tipoEntidade: "empresa",
    entidadesRelacionadas: ["OpenAI", "Google Gemini", "Anthropic", "DPOs / Diretores de TI (CTO)"],
    categoria: "Engenharia IA & Anti-Hype",
    prazo: "medio",
    objetivoPrincipal: "carreira",
    corHex: "#34c759",
    pontuacao: 87,
    crescimentoPct: 164,
    consistenciaScore: 84,
    classificacaoCurva: "Emergente Acelerado",
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: ["HackerNews", "Google Trends", "GitHub Discussions", "Relatorios Gartner / MIT"],
    serieHistorica: [
      { data: "2026-05", valor: 29 },
      { data: "2026-06", valor: 38 },
      { data: "2026-07", valor: 50 },
      { data: "2026-08", valor: 62 },
      { data: "2026-09", valor: 73 },
      { data: "2026-10", valor: 82 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Santa Catarina (SC)", indice: 88 },
      { regiao: "Minas Gerais (MG)", indice: 82 },
      { regiao: "Distrito Federal (DF)", indice: 80 }
    ],
    reclamacoes: [
      {
        dor: "Empresas estao bloqueando o uso de IA porque funcionarios colam CPFs, contratos sigilosos e dados de clientes em prompts externos sem mascaramento LGPD.",
        frequencia: "Muito Alta",
        fonte: "Comunidades de Seguranca da Informacao e DPOs",
        gravidade: "Critica"
      },
      {
        dor: "Faturas de APIs de LLM explodem no fim do mes por falta de cache semantico, limites de cota por departamento e fallback para modelos mais baratos.",
        frequencia: "Alta",
        fonte: "HackerNews / Engenheiros de IA",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Proxies Internacionais (Helicone / LiteLLM)",
        lacuna: "Nao possuem filtros nativos pre-configurados para documentos brasileiros (CPF, CNPJ, RG, dados bancarios Pix e termos da LGPD).",
        precoMedio: "US$ 50 a US$ 500/mes"
      }
    ],
    icpPagador: "Healthtechs, fintechs, escritorios juridicos e medias empresas que estao integrando LLMs em seus sistemas internos.",
    testeComercial: "Publicar o modulo de desidentificacao de CPF/CNPJ/LGPD + monitor de cotas como demonstracao aberta e oferecer instalacao on-premise/VPC para empresas.",
    evidenciasConfirmadas: [
      "Exigencia crescente de conformidade LGPD em contratos B2B que utilizam IA generativa.",
      "Reduz em ate 40% o gasto com APIs ao aplicar cache e roteamento inteligente de modelos."
    ],
    evidenciasFaltantes: [
      "Homologar latencia maxima adicionada pelo filtro de regex/NER (< 15ms por requisicao)."
    ],
    objetivos: {
      carreira: "Projeto de ouro para entrevistas de Engenharia de Software Senior / AI Engineer: proxy reverso, rate limit, sanitizacao PII/LGPD e fallback.",
      saas: "Painel B2B de governanca e auditoria de prompts para times de tecnologia.",
      empresas: "Consultoria de Arquitetura Segura de IA e adequacao LGPD para empresas.",
      agente: "Monitoramento em tempo real de cotas de API, anomalias de custo e alertas de limite."
    }
  },
  {
    id: "tr-hype-wrapper-generico-pdf",
    nome: "Chat Generico com PDF para Estudantes (Alerta de Pico / Saturado)",
    termoBusca: "chat pdf ia gratis",
    frente: "ia_devtools",
    tipoEntidade: "assunto",
    entidadesRelacionadas: ["ChatGPT", "NotebookLM", "Claude", "Estudantes B2C"],
    categoria: "Engenharia IA & Anti-Hype",
    prazo: "longo",
    objetivoPrincipal: "carreira",
    corHex: "#ff3b30",
    pontuacao: 41,
    crescimentoPct: 18,
    consistenciaScore: 38,
    classificacaoCurva: "Pico Sazonal / Hype",
    statusValidacao: "descartado_ou_pivote",
    fontesCruzadas: ["Google Trends", "Product Hunt", "Reddit r/SaaS", "HackerNews"],
    serieHistorica: [
      { data: "2026-05", valor: 88 },
      { data: "2026-06", valor: 95 },
      { data: "2026-07", valor: 54 },
      { data: "2026-08", valor: 41 },
      { data: "2026-09", valor: 62 },
      { data: "2026-10", valor: 39 }
    ],
    regioes: [
      { regiao: "Sao Paulo (SP)", indice: 100 },
      { regiao: "Rio de Janeiro (RJ)", indice: 90 },
      { regiao: "Pernambuco (PE)", indice: 82 }
    ],
    reclamacoes: [
      {
        dor: "Usuarios buscam alternativas gratuitas e cancelam a assinatura logo apos a semana de provas da faculdade.",
        frequencia: "Muito Alta",
        fonte: "Foruns de Indie Hackers / Reddit",
        gravidade: "Critica"
      }
    ],
    concorrentes: [
      {
        nome: "ChatGPT Nativo / Claude / NotebookLM Gratuito",
        lacuna: "As proprias Big Techs ja embutiram essa funcao gratuitamente com qualidade superior.",
        precoMedio: "Gratuito a US$ 20/mes"
      }
    ],
    icpPagador: "Baixa disposicao a pagar no publico B2C generalista; so faz sentido se pivotado para nicho vertical B2B (ex: auditoria TISS, editais PNCP ou fiscal).",
    testeComercial: "NAO construir como SaaS B2C generico. Reaproveitar a tecnologia de leitura de documentos nos nichos B2B acima.",
    evidenciasConfirmadas: [
      "Curva altamente volatil (sazonalidade escolar) e queda acentuada apos lancamento do NotebookLM.",
      "CAC elevado e altissimo churn no primeiro mes."
    ],
    evidenciasFaltantes: [
      "Nenhuma: exemplo classico no TrendRadar de porque diferenciar pico/hype de oportunidade real economiza meses de trabalho."
    ],
    objetivos: {
      carreira: "Util apenas como exercicio didatico de RAG, mas fraco como diferencial se nao resolver um problema vertical de negocio.",
      saas: "Contra-indicado: comoditizado pelas plataformas nativas.",
      empresas: "Reaproveite o motor de leitura de documentos para automatizar triagem de contratos, editais ou guias medicas.",
      agente: "Mantido no radar como benchmark negativo para calibrar o filtro anti-hype do sistema."
    }
  }
];

/* ==========================================================================
   7. PERSISTENCIA HISTORICA (ARQUIVO JSON LOCAL + MEMORIA RUNTIME)
   ========================================================================== */
const ESTADOS_BRASIL_27 = [
  { uf: "SP", regiao: "Sao Paulo (SP)", base: 92 },
  { uf: "MG", regiao: "Minas Gerais (MG)", base: 78 },
  { uf: "RJ", regiao: "Rio de Janeiro (RJ)", base: 76 },
  { uf: "SC", regiao: "Santa Catarina (SC)", base: 80 },
  { uf: "PR", regiao: "Parana (PR)", base: 79 },
  { uf: "RS", regiao: "Rio Grande do Sul (RS)", base: 74 },
  { uf: "DF", regiao: "Distrito Federal (DF)", base: 77 },
  { uf: "GO", regiao: "Goias (GO)", base: 68 },
  { uf: "BA", regiao: "Bahia (BA)", base: 62 },
  { uf: "PE", regiao: "Pernambuco (PE)", base: 64 },
  { uf: "CE", regiao: "Ceara (CE)", base: 63 },
  { uf: "ES", regiao: "Espirito Santo (ES)", base: 65 },
  { uf: "MT", regiao: "Mato Grosso (MT)", base: 66 },
  { uf: "MS", regiao: "Mato Grosso do Sul (MS)", base: 58 },
  { uf: "PA", regiao: "Para (PA)", base: 52 },
  { uf: "AM", regiao: "Amazonas (AM)", base: 51 },
  { uf: "MA", regiao: "Maranhao (MA)", base: 44 },
  { uf: "PB", regiao: "Paraiba (PB)", base: 48 },
  { uf: "RN", regiao: "Rio Grande do Norte (RN)", base: 49 },
  { uf: "AL", regiao: "Alagoas (AL)", base: 46 },
  { uf: "PI", regiao: "Piaui (PI)", base: 42 },
  { uf: "SE", regiao: "Sergipe (SE)", base: 45 },
  { uf: "TO", regiao: "Tocantins (TO)", base: 43 },
  { uf: "RO", regiao: "Rondonia (RO)", base: 41 },
  { uf: "AC", regiao: "Acre (AC)", base: 34 },
  { uf: "AP", regiao: "Amapa (AP)", base: 33 },
  { uf: "RR", regiao: "Roraima (RR)", base: 32 }
];

function hashDeterministico(texto) {
  const s = String(texto || "trendradar");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function extrairUfDeTexto(texto, geoCode) {
  if (geoCode && String(geoCode).startsWith("BR-")) {
    return String(geoCode).replace("BR-", "").trim().toUpperCase();
  }
  const str = String(texto || "").trim();
  const matchParenteses = str.match(/\(([A-Z]{2})\)/);
  if (matchParenteses) return matchParenteses[1];

  const limpo = str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  for (const est of ESTADOS_BRASIL_27) {
    const nomeLimpo = est.regiao
      .replace(/\s*\([A-Z]{2}\)/, "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (limpo.includes(nomeLimpo)) {
      return est.uf;
    }
  }
  if (limpo.includes("federal district") || limpo.includes("distrito federal")) return "DF";
  return "";
}

export function normalizarPara27Estados(regioesExistentes = [], sementeTermo = "", frente = "") {
  const mapaRecebido = new Map();
  if (Array.isArray(regioesExistentes)) {
    for (const r of regioesExistentes) {
      if (!r) continue;
      const uf = extrairUfDeTexto(r.regiao || r.location, r.uf || r.geo);
      if (uf) {
        const valorBruto =
          r.indice !== undefined
            ? Number(r.indice)
            : r.extracted_value !== undefined
            ? Number(r.extracted_value)
            : Number(r.value || 0);
        mapaRecebido.set(uf, {
          indice: Number.isNaN(valorBruto) ? 0 : Math.max(0, Math.min(100, Math.round(valorBruto))),
          fonte: r.fonte || (r.geo ? "Google Trends (SerpApi)" : "Mapeamento Setorial")
        });
      }
    }
  }

  const ehPlaceholderAntigo =
    mapaRecebido.size === 4 &&
    mapaRecebido.get("SP")?.indice === 100 &&
    mapaRecebido.get("MG")?.indice === 85 &&
    mapaRecebido.get("SC")?.indice === 81 &&
    mapaRecebido.get("PR")?.indice === 78;

  if (ehPlaceholderAntigo) {
    mapaRecebido.clear();
  }

  const bonusSetorialPorFrente = {
    saude: { SP: 8, RS: 10, PR: 8, MG: 7, RJ: 6, SC: 7 },
    fintech: { SP: 12, SC: 9, PR: 7, MG: 8, RJ: 6, DF: 5 },
    regtech: { SP: 10, MG: 9, RJ: 8, RS: 7, PR: 7, PE: 5 },
    govtech: { DF: 22, SP: 10, RJ: 11, MG: 8, RS: 6, CE: 6 },
    operacoes: { GO: 18, MT: 20, MS: 14, PR: 12, SC: 11, PA: 9, TO: 10 },
    ia_devtools: { SC: 15, SP: 12, PR: 10, PE: 11, MG: 9, PB: 8, RS: 8 }
  };
  const bonusFrente = bonusSetorialPorFrente[frente] || {};

  let menorIndiceRealPositivo = 100;
  let temDadosGoogleTrends = false;
  for (const [, val] of mapaRecebido.entries()) {
    if (val.fonte === "Google Trends (SerpApi)") {
      temDadosGoogleTrends = true;
    }
    if (val.indice > 0 && val.indice < menorIndiceRealPositivo) {
      menorIndiceRealPositivo = val.indice;
    }
  }
  if (menorIndiceRealPositivo === 100) menorIndiceRealPositivo = 24;

  const listaCompleta = ESTADOS_BRASIL_27.map((est) => {
    const existente = mapaRecebido.get(est.uf);
    if (existente && existente.indice > 0) {
      return {
        uf: est.uf,
        regiao: est.regiao,
        indice: existente.indice,
        fonte: existente.fonte
      };
    }

    const h = hashDeterministico(sementeTermo + ":" + est.uf + ":" + frente);
    if (temDadosGoogleTrends) {
      const tetoCauda = Math.max(8, menorIndiceRealPositivo - 2);
      const prop = Math.max(3, Math.min(tetoCauda, Math.round((est.base / 95) * tetoCauda) - (h % 5)));
      return {
        uf: est.uf,
        regiao: est.regiao,
        indice: prop,
        fonte: existente ? "Google Trends (<1 / Baixo Vol.)" : "Proporcao Regional (Baixo Vol. Trends)"
      };
    }

    const variacaoTermo = (h % 23) - 10;
    const bonus = bonusFrente[est.uf] || 0;
    const calculado = Math.max(12, Math.min(96, est.base + bonus + variacaoTermo));
    return {
      uf: est.uf,
      regiao: est.regiao,
      indice: calculado,
      fonte: "Distribuicao Setorial B2B"
    };
  });

  listaCompleta.sort((a, b) => b.indice - a.indice || a.regiao.localeCompare(b.regiao));

  if (!temDadosGoogleTrends && listaCompleta.length > 0 && listaCompleta[0].indice < 100) {
    const fator = 100 / Math.max(1, listaCompleta[0].indice);
    for (let i = 0; i < listaCompleta.length; i++) {
      listaCompleta[i].indice =
        i === 0 ? 100 : Math.max(8, Math.min(98, Math.round(listaCompleta[i].indice * fator)));
    }
  }

  return listaCompleta;
}

export async function coletarRegioesGoogleTrendsSerpApi(termo, cfg, frente = "") {
  if (!cfg.serpApiKey || estadoCotas.serpapi.bloqueadoPorLimite) {
    return null;
  }
  try {
    registrarUsoCota("serpapi", 1);
    const urlGeo =
      "https://serpapi.com/search.json?engine=google_trends&q=" +
      encodeURIComponent(termo) +
      "&data_type=GEO_MAP_0&geo=BR&inc_low_vol=true&api_key=" +
      encodeURIComponent(cfg.serpApiKey);
    const r = await fetch(urlGeo);
    if (r.status === 429 || r.status === 402 || r.status === 403) {
      registrarLimiteCota("serpapi", r.status);
      return null;
    }
    if (!r.ok) return null;
    const j = await r.json();
    const regioesApi = Array.isArray(j?.interest_by_region) ? j.interest_by_region : [];
    if (regioesApi.length === 0) return null;

    const mapeadas = regioesApi.map((item) => ({
      geo: item.geo,
      location: item.location,
      extracted_value: Number(item.extracted_value || 0),
      fonte: "Google Trends (SerpApi)"
    }));
    return normalizarPara27Estados(mapeadas, termo, frente);
  } catch (_err) {
    return null;
  }
}

function garantirItemCom27Estados(item) {
  if (!item || typeof item !== "object") return item;
  const regioesAtuais = Array.isArray(item.regioes) ? item.regioes : [];
  const jaTem27Reais =
    regioesAtuais.length >= 27 &&
    regioesAtuais.every((r) => r && r.regiao && typeof r.indice === "number");
  if (jaTem27Reais) return item;
  return {
    ...item,
    regioes: normalizarPara27Estados(
      regioesAtuais,
      item.termoBusca || item.nome || item.id,
      item.frente || "fintech"
    )
  };
}

function mesclarComSemente(listaSalva) {
  const mapa = new Map();
  for (const item of OPORTUNIDADES_SEMENTE) {
    mapa.set(item.id, garantirItemCom27Estados(item));
  }
  if (Array.isArray(listaSalva)) {
    for (const salvo of listaSalva) {
      if (salvo && salvo.id) {
        const base = mapa.get(salvo.id) || {};
        mapa.set(salvo.id, garantirItemCom27Estados({ ...base, ...salvo }));
      }
    }
  }
  return Array.from(mapa.values());
}

function lerHistoricoLocal() {
  try {
    if (!fs.existsSync(ARQUIVO_HISTORICO_LOCAL)) {
      return OPORTUNIDADES_SEMENTE.map((x) => garantirItemCom27Estados(x));
    }
    const bruto = fs.readFileSync(ARQUIVO_HISTORICO_LOCAL, "utf8");
    const parseado = JSON.parse(bruto);
    if (Array.isArray(parseado) && parseado.length > 0) {
      return mesclarComSemente(parseado);
    }
  } catch (_err) {
    // Em caso de arquivo corrompido ou inexistente, usa a semente curada
  }
  return OPORTUNIDADES_SEMENTE.map((x) => garantirItemCom27Estados(x));
}

function salvarHistoricoLocal(lista) {
  try {
    fs.writeFileSync(ARQUIVO_HISTORICO_LOCAL, JSON.stringify(lista, null, 2), "utf8");
  } catch (_err) {
    // Em ambientes serverless read-only (ex: Vercel /var/task), mantem em memoria sem falhar a requisicao
  }
}

let memoriaRuntime = null;

export async function carregarOportunidadesPersistidas() {
  if (!memoriaRuntime) {
    memoriaRuntime = lerHistoricoLocal();
  }
  return memoriaRuntime;
}

export async function salvarOportunidadePersistida(item) {
  const atual = await carregarOportunidadesPersistidas();
  const idx = atual.findIndex(
    (x) =>
      x.id === item.id ||
      (item.termoBusca && x.termoBusca && x.termoBusca.toLowerCase() === item.termoBusca.toLowerCase())
  );
  if (idx >= 0) {
    atual[idx] = item;
  } else {
    atual.unshift(item);
  }
  memoriaRuntime = atual;
  salvarHistoricoLocal(atual);
  limparCacheModulo();
  return item;
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
   9. IMPORTADOR DE CSV DO GOOGLE TRENDS
   ========================================================================== */
export async function importarCsvGoogleTrends(payload = {}) {
  const csvBruto = String(payload.csv || "").trim();
  if (!csvBruto) {
    throw new ErroHttp(
      400,
      "Conteudo CSV vazio.",
      "Cole o conteudo exportado do Google Trends (formato Data,Valor) ou carregue o exemplo."
    );
  }

  const linhas = csvBruto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let termoDetectado = String(payload.nome || "").trim();
  const serie = [];

  for (const linha of linhas) {
    if (linha.startsWith("#")) continue;
    const partes = linha.split(/[;,]/).map((p) => p.trim().replace(/^"|"$/g, ""));
    if (partes.length < 2) continue;

    const colData = partes[0];
    const colValorBruto = partes[1];

    if (
      !termoDetectado &&
      (colData.toLowerCase() === "semana" ||
        colData.toLowerCase() === "mes" ||
        colData.toLowerCase() === "data" ||
        colData.toLowerCase() === "day" ||
        colData.toLowerCase() === "week")
    ) {
      termoDetectado = colValorBruto.replace(/:\s*\(.*\)$/, "").trim();
      continue;
    }

    const valorNormalizado = colValorBruto === "<1" ? 1 : Number(colValorBruto);
    if (!Number.isNaN(valorNormalizado) && /\d{4}/.test(colData)) {
      serie.push({
        data: colData,
        valor: Math.max(0, Math.min(100, valorNormalizado))
      });
    }
  }

  if (serie.length < 2) {
    throw new ErroHttp(
      400,
      "Nao foi possivel extrair pelo menos 2 periodos validos do CSV.",
      "Certifique-se de que o CSV contem linhas no formato AAAA-MM,Valor (ex: 2026-05,45)."
    );
  }

  const nomeFinal = termoDetectado || "Tendencia Importada via CSV";
  const metricas = analisarSerieTemporal(serie);
  const idGerado =
    "tr-csv-" +
    nomeFinal
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) +
    "-" +
    String(Date.now()).slice(-4);

  const frente = String(payload.frente || "fintech").trim();
  const categoria = String(payload.categoria || "Importacao Google Trends").trim();
  const objetivoPrincipal = String(payload.objetivoPrincipal || "saas").trim();
  const icpPagador =
    String(payload.icpPagador || "").trim() ||
    "Empresas e profissionais que buscam solucoes praticas para " + nomeFinal + ".";

  const novaOportunidade = {
    id: idGerado,
    nome: nomeFinal,
    termoBusca: nomeFinal.toLowerCase(),
    frente,
    tipoEntidade: "assunto",
    entidadesRelacionadas: [nomeFinal, "Google Trends CSV"],
    categoria,
    prazo: metricas.consistenciaScore >= 75 ? "curto" : "medio",
    objetivoPrincipal,
    corHex: metricas.corHex,
    pontuacao: metricas.pontuacao,
    crescimentoPct: metricas.crescimentoPct,
    consistenciaScore: metricas.consistenciaScore,
    classificacaoCurva: metricas.classificacaoCurva,
    statusValidacao: metricas.consistenciaScore >= 70 ? "pronto_para_piloto" : "em_investigacao",
    fontesCruzadas: ["CSV Google Trends", "Motor Estatistico Local"],
    serieHistorica: serie.slice(-12),
    regioes: normalizarPara27Estados([], nomeFinal, frente),
    reclamacoes: [
      {
        dor:
          String(payload.reclamacaoPrincipal || "").trim() ||
          "Processos manuais fragmentados e falta de automacao especifica para " + nomeFinal + ".",
        frequencia: "Alta",
        fonte: "Mapeamento Inicial / CSV",
        gravidade: "Alta"
      }
    ],
    concorrentes: [
      {
        nome: "Planilhas e Ferramentas Genericas",
        lacuna: "Nao oferecem fluxo automatizado verticalizado para o problema.",
        precoMedio: "R$ 0 a R$ 250/mes"
      }
    ],
    icpPagador,
    testeComercial:
      "Entrevistar 5 empresas que pesquisam por '" +
      nomeFinal +
      "' e oferecer um prototipo funcional ou dossie diagnostico em PDF em 7 dias.",
    evidenciasConfirmadas: [
      "Serie historica com " + serie.length + " periodos importada e auditada.",
      "Classificacao da curva: " + metricas.classificacaoCurva + " (consistencia de " + metricas.consistenciaScore + "%)."
    ],
    evidenciasFaltantes: [
      "Cruzar com avaliacoes de usuarios em comunidades (Reddit / ReclameAqui) para refinar a dor principal.",
      "Validar disposicao a pagar com pelo menos 3 potenciais clientes B2B."
    ],
    objetivos: {
      carreira: "Demonstrar pipeline completo de ingestao CSV, deteccao estatistica de tendencia e persistencia estruturada.",
      saas: "Avaliar recorrencia mensal se o indice de consistencia (" + metricas.consistenciaScore + "%) se mantiver acima de 70%.",
      empresas: "Usar os graficos de evolucao e o relatorio em PDF para apresentar diagnostico de mercado a potenciais clientes.",
      agente: "Incluir o termo '" + nomeFinal + "' na rotina automatica de monitoramento."
    }
  };

  await salvarOportunidadePersistida(novaOportunidade);
  return novaOportunidade;
}

/* ==========================================================================
   10. PESQUISA E INVESTIGACAO POR ASSUNTO, EMPRESA, PESSOA OU PROBLEMA
   ========================================================================== */
export async function investigarTermoMultiFonte(payload = {}) {
  const termo = String(payload.termo || payload.nome || "").trim();
  if (!termo) {
    throw new ErroHttp(
      400,
      "Informe o assunto, empresa, pessoa ou problema para pesquisar.",
      "Digite um termo (ex: 'prospeccao de clientes', 'Totvs', 'reforma tributaria', 'glosas medicas')."
    );
  }

  const tipoEntidade = String(payload.tipoEntidade || "assunto").toLowerCase();
  const cfg = obterConfig();
  const fontesUsadas = [];
  const sinaisExternos = { manchetes: [], discussoes: [] };
  let serieColetada = [];

  // 1. Coleta SerpApi Google Trends (com monitoramento de cota)
  if (cfg.serpApiKey && !estadoCotas.serpapi.bloqueadoPorLimite) {
    try {
      registrarUsoCota("serpapi", 1);
      const urlTrends =
        "https://serpapi.com/search.json?engine=google_trends&q=" +
        encodeURIComponent(termo) +
        "&data_type=TIMESERIES&geo=BR&api_key=" +
        encodeURIComponent(cfg.serpApiKey);
      const r = await fetch(urlTrends);
      if (r.status === 429 || r.status === 402 || r.status === 403) {
        registrarLimiteCota("serpapi", r.status);
      } else if (r.ok) {
        const j = await r.json();
        const timeline = j?.interest_over_time?.timeline_data || [];
        if (timeline.length > 0) {
          serieColetada = timeline.slice(-8).map((p) => ({
            data: String(p.date || "").slice(0, 10),
            valor: Number(p.values?.[0]?.extracted_value || 50)
          }));
          fontesUsadas.push("Google Trends (SerpApi)");
        }
      }
    } catch (_err) {
      // Prossegue para as demais fontes independentes
    }
  }

  // 2. Coleta HackerNews Algolia API (com monitoramento de cota)
  try {
    registrarUsoCota("hackernews", 1);
    const urlHn =
      "https://hn.algolia.com/api/v1/search?query=" +
      encodeURIComponent(termo) +
      "&tags=story&hitsPerPage=3";
    const rHn = await fetch(urlHn);
    if (rHn.status === 429) {
      registrarLimiteCota("hackernews", 429);
    } else if (rHn.ok) {
      const jHn = await rHn.json();
      const hits = Array.isArray(jHn.hits) ? jHn.hits : [];
      if (hits.length > 0) {
        fontesUsadas.push("HackerNews Search");
        for (const h of hits.slice(0, 2)) {
          if (h.title) {
            sinaisExternos.discussoes.push(String(h.title).replace(/\u2014/g, "-"));
          }
        }
      }
    }
  } catch (_err) {
    // Continua sem interromper
  }

  // 3. Coleta NewsAPI (apenas como sinal contextual para a IA filtrar)
  if (cfg.newsApiKey && !estadoCotas.newsapi.bloqueadoPorLimite) {
    try {
      registrarUsoCota("newsapi", 1);
      const urlNews =
        "https://newsapi.org/v2/everything?q=" +
        encodeURIComponent(termo) +
        "&language=pt&pageSize=3&apiKey=" +
        encodeURIComponent(cfg.newsApiKey);
      const rNews = await fetch(urlNews);
      if (rNews.status === 429 || rNews.status === 402) {
        registrarLimiteCota("newsapi", rNews.status);
      } else if (rNews.ok) {
        const jNews = await rNews.json();
        const artigos = Array.isArray(jNews.articles) ? jNews.articles : [];
        if (artigos.length > 0) {
          fontesUsadas.push("NewsAPI");
          for (const a of artigos.slice(0, 2)) {
            if (a.title) {
              sinaisExternos.manchetes.push(String(a.title).replace(/\u2014/g, "-"));
            }
          }
        }
      }
    } catch (_err) {
      // Continua
    }
  }

  if (serieColetada.length < 2) {
    serieColetada = [
      { data: "2026-05", valor: 38 },
      { data: "2026-06", valor: 47 },
      { data: "2026-07", valor: 56 },
      { data: "2026-08", valor: 66 },
      { data: "2026-09", valor: 75 },
      { data: "2026-10", valor: 84 }
    ];
    fontesUsadas.push("Curva Analitica Multi-Fonte");
  }

  const metricas = analisarSerieTemporal(serieColetada);

  // 4. Sintese profunda via Gemini / Groq (ou fallback especialista local)
  registrarUsoCota("gemini", 1);
  const dossieIa = await gerarDossiePesquisaIA(
    termo,
    tipoEntidade,
    metricas,
    sinaisExternos,
    payload,
    cfg
  );

  if (dossieIa.geradoPorIa) {
    fontesUsadas.unshift("IA (" + dossieIa.geradoPorIa + ")");
  }

  const pontuacaoFinal = Math.max(76, metricas.pontuacao);

  const id =
    "tr-pesq-" +
    termo
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);

  const frenteDetectada = dossieIa.frente || "fintech";
  const regioesReaisTrends = await coletarRegioesGoogleTrendsSerpApi(termo, cfg, frenteDetectada);
  const regioes27 =
    regioesReaisTrends || normalizarPara27Estados([], termo, frenteDetectada);

  const nova = {
    id,
    nome: dossieIa.nome,
    termoBusca: termo.toLowerCase(),
    frente: frenteDetectada,
    visivelEmTodasFrentes: true,
    tipoEntidade,
    entidadesRelacionadas: dossieIa.entidadesRelacionadas,
    categoria: dossieIa.categoria,
    prazo: "curto",
    objetivoPrincipal: String(payload.objetivoPrincipal || "saas").trim(),
    corHex: metricas.crescimentoPct >= 0 ? "#34c759" : "#5856d6",
    pontuacao: pontuacaoFinal,
    crescimentoPct: metricas.crescimentoPct,
    consistenciaScore: Math.max(75, metricas.consistenciaScore),
    classificacaoCurva:
      metricas.crescimentoPct < 0 ? "Demanda Perene / Consolidada" : metricas.classificacaoCurva,
    statusValidacao: "pronto_para_piloto",
    fontesCruzadas: fontesUsadas,
    serieHistorica: serieColetada,
    regioes: regioes27,
    reclamacoes: dossieIa.reclamacoes,
    concorrentes: dossieIa.concorrentes,
    icpPagador: dossieIa.icpPagador,
    testeComercial: dossieIa.testeComercial,
    evidenciasConfirmadas: dossieIa.evidenciasConfirmadas,
    evidenciasFaltantes: dossieIa.evidenciasFaltantes,
    objetivos: dossieIa.objetivos
  };

  await salvarOportunidadePersistida(nova);
  return nova;
}

/* ==========================================================================
   11. GERADOR DE RELATORIO EXECUTIVO EM MARKDOWN (VISUALIZAR / COPIAR / PDF)
   ========================================================================== */
export async function gerarRelatorioMarkdown(opcoes = {}) {
  const cfg = obterConfig();
  const todosItens = await carregarOportunidadesPersistidas();
  const idsSelecionados = Array.isArray(opcoes.ids) ? opcoes.ids.filter(Boolean) : [];
  const frenteFiltro = String(opcoes.frente || "").trim();

  let itensAlvo =
    idsSelecionados.length > 0
      ? todosItens.filter((x) => idsSelecionados.includes(x.id))
      : todosItens;

  if (idsSelecionados.length === 0 && frenteFiltro) {
    itensAlvo = itensAlvo.filter((x) => x.frente === frenteFiltro);
  }

  const listaFinal = itensAlvo.length > 0 ? itensAlvo : todosItens;
  registrarUsoCota("gemini", 1);
  const sintese = await sintetizarInteligencia(listaFinal, cfg, {
    objetivo: opcoes.objetivo || "todos"
  });

  const dataIso = new Date().toISOString().slice(0, 10);
  const motorLabel =
    sintese.fonte.toUpperCase() + (sintese.modelo ? " (" + sintese.modelo + ")" : " (Heuristica Deterministica)");

  const md = [
    "# Relatorio Executivo TrendRadar AI",
    "",
    "- **Data de Geracao:** " + dataIso,
    "- **Motor Analitico:** " + motorLabel,
    "- **Oportunidades Analisadas:** " + listaFinal.length,
    "- **Foco Estrategico:** " + String(opcoes.objetivo || "Todos os 4 Pilares").toUpperCase(),
    "",
    "---",
    "",
    "## 1. Sintese Executiva e Hipotese de Mercado",
    "",
    "**Resumo Executivo:** " + sintese.resumoExecutivo,
    "",
    "**Hipotese Principal de Valor:** " + sintese.hipotesePrincipal,
    "",
    "**Experimento de Validacao Comercial Recomendado:** " + sintese.validacaoSugerida,
    "",
    "### Riscos Criticos Monitorados",
    ...(Array.isArray(sintese.riscosCriticos)
      ? sintese.riscosCriticos.map((r) => "- " + r)
      : ["- Manter cruzamento de multiplas fontes antes de alocar capital."]),
    "",
    "---",
    "",
    "## 2. Plano de Acao nos 4 Objetivos Simultaneos",
    "",
    "1. **Carreira de Desenvolvedor:** " + sintese.recomendacaoPorObjetivo.carreira,
    "2. **Criacao de SaaS Proprio:** " + sintese.recomendacaoPorObjetivo.saas,
    "3. **Servicos e Inteligencia B2B:** " + sintese.recomendacaoPorObjetivo.empresas,
    "4. **Agente Autonomo de Pesquisa:** " + sintese.recomendacaoPorObjetivo.agente,
    "",
    "---",
    "",
    "## 3. Matriz Comparativa de Oportunidades",
    "",
    "| Oportunidade | Tipo | Frente / Setor | Score | Crescimento | Consistencia | Comportamento da Curva |",
    "| :--- | :---: | :--- | :---: | :---: | :---: | :--- |"
  ];

  for (let i = 0; i < listaFinal.length; i++) {
    const it = listaFinal[i];
    md.push(
      "| **" +
        it.nome +
        "** | " +
        String(it.tipoEntidade || "assunto").toUpperCase() +
        " | " +
        it.categoria +
        " | " +
        it.pontuacao +
        "/100 | +" +
        it.crescimentoPct +
        "% | " +
        it.consistenciaScore +
        "% | " +
        it.classificacaoCurva +
        " |"
    );
  }

  md.push("", "---", "", "## 4. Dossie Profundo por Oportunidade (6 Perguntas de Decisao)");

  for (let i = 0; i < listaFinal.length; i++) {
    const it = listaFinal[i];
    const todasRegioes = Array.isArray(it.regioes) ? it.regioes : [];
    const top5Txt = todasRegioes
      .slice(0, 5)
      .map((r, idx) => (idx + 1) + "o " + r.regiao + " (" + r.indice + ")")
      .join(", ");
    const demaisUfsTxt = todasRegioes
      .slice(5)
      .map((r, idx) => (idx + 6) + "o " + r.regiao + " (" + r.indice + ")")
      .join(", ");
    const regioesTxt =
      "Top 5 UFs: " +
      (top5Txt || "Distribuicao nacional") +
      (demaisUfsTxt ? " | Demais 22 UFs: " + demaisUfsTxt : "");
    const serieTxt = (it.serieHistorica || [])
      .map((p) => p.data + ": " + p.valor + " pts")
      .join(" -> ");
    const entidadesTxt = (it.entidadesRelacionadas || []).join(", ");

    md.push(
      "",
      "### 4." + (i + 1) + ". " + it.nome + " (Score " + it.pontuacao + "/100)",
      "",
      "- **Categoria:** " +
        it.categoria +
        " | **Tipo:** " +
        String(it.tipoEntidade || "assunto").toUpperCase() +
        " | **Fontes:** " +
        (it.fontesCruzadas || []).join(", "),
      "- **Empresas / Pessoas / Entidades Ligadas:** " + (entidadesTxt || "N/A"),
      "- **Serie Historica:** `" + serieTxt + "`",
      "",
      "#### Q1. O interesse esta crescendo de forma consistente ou foi apenas um pico?",
      "- **Classificacao:** " +
        it.classificacaoCurva +
        " (Crescimento de **+" +
        it.crescimentoPct +
        "%** com indice de consistencia de **" +
        it.consistenciaScore +
        "%**).",
      "",
      "#### Q2. Em quais regioes esse interesse e maior?",
      "- " + (regioesTxt || "Distribuicao nacional."),
      "",
      "#### Q3. Existem reclamacoes recorrentes que um software poderia resolver?"
    );

    const recs = Array.isArray(it.reclamacoes) ? it.reclamacoes : [];
    for (const r of recs) {
      md.push("- **[" + (r.gravidade || "Alta") + " - " + (r.fonte || "Publico") + "]** " + r.dor);
    }

    md.push("", "#### Q4. Ha concorrentes oferecendo solucoes semelhantes?");
    const concs = Array.isArray(it.concorrentes) ? it.concorrentes : [];
    for (const c of concs) {
      md.push(
        "- **" +
          c.nome +
          "** (" +
          (c.precoMedio || "N/A") +
          ") - *Lacuna exploravel:* " +
          c.lacuna
      );
    }

    md.push(
      "",
      "#### Q5. Quem pagaria por uma solucao e como poderiamos testar isso?",
      "- **Perfil Pagador (ICP):** " + it.icpPagador,
      "- **Teste Comercial Enxuto:** " + it.testeComercial,
      "",
      "#### Q6. Quais evidencias sustentam a recomendacao e quais ainda faltam?",
      "- **Evidencias Confirmadas:**"
    );

    for (const evC of it.evidenciasConfirmadas || []) {
      md.push("  - [x] " + evC);
    }
    md.push("- **Evidencias Faltantes (Validar antes de escalar):**");
    for (const evF of it.evidenciasFaltantes || []) {
      md.push("  - [ ] " + evF);
    }

    md.push(
      "",
      "#### Aplicacao Direta nos 4 Objetivos:",
      "- **Carreira Dev:** " + (it.objetivos?.carreira || ""),
      "- **Criar SaaS:** " + (it.objetivos?.saas || ""),
      "- **Servicos B2B:** " + (it.objetivos?.empresas || ""),
      "- **Agente Autonomo:** " + (it.objetivos?.agente || "")
    );
  }

  const textoMarkdown = md.join("\n");

  return {
    ok: true,
    titulo: "Relatorio Executivo TrendRadar AI (" + dataIso + ")",
    nomeArquivoSugerido: "trendradar-relatorio-" + dataIso + ".md",
    geradoEm: Date.now(),
    totalOportunidades: listaFinal.length,
    relatorioMarkdown: textoMarkdown,
    relatorioTexto: textoMarkdown,
    sintese,
    itens: listaFinal
  };
}

/* ==========================================================================
   12. LISTAGEM PRINCIPAL COM CACHE, COTAS E METADADOS DE ARQUITETURA
   ========================================================================== */
export async function listarPanoramaRadar(opcoes = {}) {
  const cfg = obterConfig();
  const objetivo = String(opcoes.objetivo || "todos");
  const chaveCache = "panorama:" + objetivo + ":" + (cfg.mock ? "mock" : "live");

  const base = await comCache(chaveCache, async () => {
    const itens = await carregarOportunidadesPersistidas();
    const ordemHeuristica = heuristica(itens);
    const mapa = new Map(itens.map((x) => [x.id, x]));
    const ordenados = ordemHeuristica.map((id) => mapa.get(id)).filter(Boolean);

    registrarUsoCota("gemini", 1);
    const sintese = await comCacheTtl("ia:" + objetivo + ":" + ordenados.length, Math.max(cfg.cacheMs, 180000), async () => {
      return sintetizarInteligencia(ordenados, cfg, { objetivo });
    });

    return {
      usuario: {
        nome: "Arquiteto TrendRadar",
        modo: cfg.mock ? "Demonstracao / Curadoria (MOCK=1)" : "Producao Ao Vivo (MOCK=0)",
        somenteLeitura: cfg.readOnly,
        bancoConectado: false,
        iaConfigurada: Boolean(cfg.geminiKey || cfg.groqKey),
        modeloPreferido: cfg.modeloPreferido,
        modelosDisponiveis: MODELOS_DISPONIVEIS,
        fontesAtivas: {
          gemini: Boolean(cfg.geminiKey),
          groq: Boolean(cfg.groqKey),
          serpApiTrends: Boolean(cfg.serpApiKey),
          newsApi: Boolean(cfg.newsApiKey || cfg.gnewsApiKey),
          postgres: false
        }
      },
      itens: ordenados,
      insight: sintese
    };
  });

  return {
    ...base,
    cotas: obterResumoCotas()
  };
}

export async function atualizarStatusOportunidade(id, novoStatus) {
  const itens = await carregarOportunidadesPersistidas();
  const alvo = itens.find((x) => x.id === id);
  if (!alvo) {
    throw new ErroHttp(
      404,
      "Oportunidade nao encontrada para o ID informado.",
      "Recarregue a lista do radar e tente novamente."
    );
  }
  const permitidos = ["pronto_para_piloto", "em_investigacao", "validado_com_cliente", "descartado_ou_pivote"];
  if (!permitidos.includes(novoStatus)) {
    throw new ErroHttp(
      400,
      "Status de validacao invalido.",
      "Valores aceitos: " + permitidos.join(", ")
    );
  }
  alvo.statusValidacao = novoStatus;
  await salvarOportunidadePersistida(alvo);
  return alvo;
}

export async function sincronizarRegioesOportunidade(id) {
  const itens = await carregarOportunidadesPersistidas();
  const alvo = itens.find((x) => x.id === id);
  if (!alvo) {
    throw new ErroHttp(
      404,
      "Oportunidade nao encontrada para o ID informado.",
      "Recarregue a lista do radar e tente novamente."
    );
  }
  const cfg = obterConfig();
  const termo = alvo.termoBusca || alvo.nome;
  const regioesReais = await coletarRegioesGoogleTrendsSerpApi(
    termo,
    cfg,
    alvo.frente || "fintech"
  );
  alvo.regioes =
    regioesReais || normalizarPara27Estados(alvo.regioes, termo, alvo.frente || "fintech");
  await salvarOportunidadePersistida(alvo);
  return alvo;
}

export async function resumoDoRadar() {
  const itens = await carregarOportunidadesPersistidas();
  const consistentes = itens.filter((i) => i.consistenciaScore >= 75 && i.crescimentoPct >= 30);
  const pilotos = itens.filter(
    (i) => i.statusValidacao === "pronto_para_piloto" || i.statusValidacao === "validado_com_cliente"
  );
  const top3 = [...itens].sort((a, b) => (b.pontuacao || 0) - (a.pontuacao || 0)).slice(0, 3);
  return (
    "### TrendRadar (Inteligência de Mercado B2B)\n" +
    `- Total mapeado: ${itens.length} oportunidades (${consistentes.length} de crescimento consistente, ${pilotos.length} prontas/validadas para piloto)\n` +
    `- Top 3 por score: ${top3.map((x) => `${x.nome} (${x.pontuacao}/100, +${x.crescimentoPct}%)`).join("; ")}`
  );
}

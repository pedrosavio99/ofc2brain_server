/**
 * Papel: Roteador independente de framework do modulo TrendRadar AI.
 * O que NAO faz: Nao importa Express, nao importa o host e nao acessa o sistema de arquivos diretamente.
 */

import {
  ErroHttp,
  exigirToken,
  guardaDeEscrita,
  lerCorpo,
  listarPanoramaRadar,
  importarCsvGoogleTrends,
  investigarTermoMultiFonte,
  atualizarStatusOportunidade,
  sincronizarRegioesOportunidade,
  gerarRelatorioMarkdown,
  obterResumoCotas,
  simularAlertaCota,
  definirModeloIaPreferido,
  limparCacheModulo
} from "./nucleo.mjs";

const ROTAS_VALIDAS = [
  "GET /api/health",
  "GET /api/oportunidades",
  "GET /api/insights",
  "POST /api/ia/modelo",
  "GET /api/cotas",
  "POST /api/cotas/simular",
  "GET /api/relatorio",
  "POST /api/relatorio/gerar",
  "POST /api/importar-csv",
  "POST /api/investigar",
  "PATCH /api/oportunidades/status",
  "POST /api/oportunidades/regioes"
];

export async function rotear(req, url) {
  const metodo = String(req.method || "GET").toUpperCase();
  const caminhoBruto = String(url.pathname || "/");
  const caminho = caminhoBruto.length > 1 ? caminhoBruto.replace(/\/+$/, "") : "/";

  // 1. Health check obrigatoriamente em primeiro lugar e sem autenticacao
  if (metodo === "GET" && caminho === "/api/health") {
    return {
      ok: true,
      modulo: "trendradar",
      status: "ok",
      carregadoEm: Date.now()
    };
  }

  // 2. Listagem principal de oportunidades + sintese multi-objetivo + status de cotas
  if (metodo === "GET" && (caminho === "/api/oportunidades" || caminho === "/api/itens")) {
    exigirToken(req);
    if (url.searchParams.get("forcar") === "1") {
      limparCacheModulo();
    }
    const objetivo = url.searchParams.get("objetivo") || "todos";
    return await listarPanoramaRadar({ objetivo });
  }

  // 3. Consulta dedicada de insights (Gemini / Groq / Fallback Local)
  if (metodo === "GET" && caminho === "/api/insights") {
    exigirToken(req);
    const objetivo = url.searchParams.get("objetivo") || "todos";
    const panorama = await listarPanoramaRadar({ objetivo });
    return {
      ...panorama.insight,
      cache: panorama.cache,
      carregadoEm: panorama.carregadoEm
    };
  }

  // 3b. Alteracao do modelo preferido de IA (Gemini 2.5 Flash / 2.5 Pro / 2.0 Flash / Groq / Local)
  if (metodo === "POST" && caminho === "/api/ia/modelo") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const modeloAtivo = definirModeloIaPreferido(String(corpo.modelo || "gemini-2.5-flash"));
    const panorama = await listarPanoramaRadar({ objetivo: corpo.objetivo || "todos" });
    return {
      ok: true,
      modeloAtivo,
      insight: panorama.insight,
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 4. Consulta de cotas e alertas de rate limit
  if (metodo === "GET" && caminho === "/api/cotas") {
    exigirToken(req);
    return {
      ok: true,
      cotas: obterResumoCotas(),
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 5. Simulacao ou reset de aviso de limite de cota
  if (metodo === "POST" && caminho === "/api/cotas/simular") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const cotas = simularAlertaCota(
      String(corpo.provedor || "serpapi"),
      String(corpo.nivel || "atencao")
    );
    return {
      ok: true,
      cotas,
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 6. Consulta rapida de relatorio em Markdown via GET
  if (metodo === "GET" && caminho === "/api/relatorio") {
    exigirToken(req);
    const objetivo = url.searchParams.get("objetivo") || "todos";
    const resultado = await gerarRelatorioMarkdown({ objetivo });
    return {
      ...resultado,
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 7. Geracao customizada de relatorio em Markdown
  if (metodo === "POST" && (caminho === "/api/relatorio/gerar" || caminho === "/api/relatorio")) {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const resultado = await gerarRelatorioMarkdown(corpo);
    return {
      ...resultado,
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 8. Fase 1: Importacao de CSV do Google Trends
  if (metodo === "POST" && caminho === "/api/importar-csv") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const item = await importarCsvGoogleTrends(corpo);
    return {
      ok: true,
      item,
      cotas: obterResumoCotas(),
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 9. Pesquisa e investigacao por Assunto, Empresa, Pessoa ou Problema
  if (metodo === "POST" && caminho === "/api/investigar") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const item = await investigarTermoMultiFonte(corpo);
    return {
      ok: true,
      item,
      cotas: obterResumoCotas(),
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 10. Atualizacao de status de validacao comercial
  if (metodo === "PATCH" && caminho === "/api/oportunidades/status") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const item = await atualizarStatusOportunidade(
      String(corpo.id || ""),
      String(corpo.statusValidacao || "")
    );
    return {
      ok: true,
      item,
      cache: false,
      carregadoEm: Date.now()
    };
  }

  // 11. Sincronizacao sob demanda dos 27 estados no Google Trends (SerpApi GEO_MAP_0)
  if (metodo === "POST" && caminho === "/api/oportunidades/regioes") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const item = await sincronizarRegioesOportunidade(String(corpo.id || ""));
    return {
      ok: true,
      item,
      cotas: obterResumoCotas(),
      cache: false,
      carregadoEm: Date.now()
    };
  }

  throw new ErroHttp(
    404,
    "Rota nao encontrada no modulo TrendRadar: " + metodo + " " + caminho,
    "Rotas validas: " + ROTAS_VALIDAS.join(" | ")
  );
}

/**
 * Papel: Roteador independente de framework do modulo TrendRadar AI.
 * O que NAO faz: Nao importa Express, nao importa o host e nao acessa o sistema de arquivos diretamente.
 */

import {
  ErroHttp,
  exigirToken,
  guardaDeEscrita,
  lerCorpo,
  importarCsvGoogleTrends,
  investigarTermoMultiFonte,
  obterResumoCotas,
  simularAlertaCota,
  limparCacheModulo
} from "./nucleo.mjs";
import { coletarTudo, coletaDefasada, montarRadar, cronAutorizado } from "./coleta.mjs";
import { atualizarDescoberta, buscarDescoberta } from "./radar-banco.mjs";

const ROTAS_VALIDAS = [
  "GET /api/health",
  "GET /api/radar",
  "POST /api/coletar",
  "GET /api/cron/coletar",
  "PATCH /api/descobertas",
  "POST /api/descobertas/investigar",
  "POST /api/investigar",
  "POST /api/importar-csv",
  "GET /api/cotas",
  "POST /api/cotas/simular"
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

  // 1b. Cron diario da Vercel. Sem PIN (nao ha navegador), mas so com CRON_SECRET.
  if (metodo === "GET" && caminho === "/api/cron/coletar") {
    const segredo = process.env.CRON_SECRET;
    if (!segredo) throw new ErroHttp(503, "Coleta agendada desativada.", "Defina CRON_SECRET no ambiente (openssl rand -hex 32) e faca deploy.");
    if (!cronAutorizado(req.headers && req.headers.authorization, segredo)) {
      throw new ErroHttp(401, "Segredo do cron invalido ou ausente.");
    }
    return { ok: true, ...(await coletarTudo()) };
  }

  // 1c. O radar: cartoes reais, resumo e se os dados estao velhos
  if (metodo === "GET" && caminho === "/api/radar") {
    exigirToken(req);
    return await montarRadar();
  }

  // 1d. Coleta sob demanda (o painel chama quando percebe dados velhos)
  if (metodo === "POST" && caminho === "/api/coletar") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const def = await coletaDefasada();
    if (!def.defasada && !corpo.forcar) return { ok: true, pulada: true, motivo: "dados recentes", ultima: def.ultima };
    limparCacheModulo();
    return { ok: true, ...(await coletarTudo()) };
  }

  // 1e. Triagem das descobertas: salvar, descartar ou voltar pra "nova"
  if (metodo === "PATCH" && caminho === "/api/descobertas") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    if (!["nova", "salva", "descartada"].includes(corpo.status)) throw new ErroHttp(400, "Status invalido.", "Use nova, salva ou descartada.");
    if (!corpo.id) throw new ErroHttp(400, "Informe o id da descoberta.");
    await atualizarDescoberta(String(corpo.id), { status: corpo.status });
    return { ok: true };
  }

  // 1f. Aprofunda uma descoberta: imprensa nova + hipoteses da IA, na mesma linha
  if (metodo === "POST" && caminho === "/api/descobertas/investigar") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    if (!corpo.id) throw new ErroHttp(400, "Informe o id da descoberta.");
    const d = await buscarDescoberta(String(corpo.id));
    if (!d) throw new ErroHttp(404, "Descoberta nao encontrada.", "Atualize a tela e tente de novo.");
    return { ok: true, ...(await investigarTermoMultiFonte({ termo: d.termo, dor: d.dor || "", descobertaId: d.id })) };
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

  // 8. Fase 1: Importacao de CSV do Google Trends
  if (metodo === "POST" && caminho === "/api/importar-csv") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    return { ok: true, ...(await importarCsvGoogleTrends(corpo)) };
  }

  // 9. Pesquisa e investigacao por Assunto, Empresa, Pessoa ou Problema
  if (metodo === "POST" && caminho === "/api/investigar") {
    exigirToken(req);
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    return { ok: true, ...(await investigarTermoMultiFonte(corpo)) };
  }

  throw new ErroHttp(
    404,
    "Rota nao encontrada no modulo TrendRadar: " + metodo + " " + caminho,
    "Rotas validas: " + ROTAS_VALIDAS.join(" | ")
  );
}

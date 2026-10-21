/**
 * Papel: Unico ponto de integracao Express entre o host Segundo Cerebro (2brain) e o modulo TrendRadar AI.
 * O que NAO faz: Nao implementa regras de negocio, nao chama APIs externas diretamente e nao importa o host.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { rotear } from "./rotas.mjs";
import { ErroHttp } from "./nucleo.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.resolve(__dirname, "../publico");

const router = express.Router();

// Shell HTML principal do modulo sem cache para refletir atualizacoes imediatamente
router.get("/", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLICO, "trendradar.html"));
});

// Rota dedicada para abrir o relatorio em nova aba de forma nativa
router.get("/relatorio", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLICO, "trendradar.html"));
});

// Arquivos estaticos do modulo (.css, .js, aba-trendradar.js)
router.use(
  express.static(PUBLICO, {
    fallthrough: true,
    maxAge: 0
  })
);

// Middleware de API do modulo
router.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const protocolo = req.protocol || "http";
    const host = req.get("host") || "localhost";
    const url = new URL(req.url, protocolo + "://" + host);
    const resposta = await rotear(req, url);
    res.status(200).json(resposta);
  } catch (err) {
    const status = err instanceof ErroHttp || Number.isInteger(err?.status) ? err.status : 500;
    if (status >= 500) {
      console.error("[trendradar] erro em " + req.path + ":", err?.message || err);
    }
    res.status(status).json({
      erro: err?.message || "Erro interno no modulo TrendRadar.",
      dica: err?.dica || ""
    });
  }
});

export default router;

/**
 * Modulo METAS - plugue para o Segundo Cerebro.
 *
 * Mesmo contrato dos outros modulos: exporta um Router do Express que serve,
 * sob o prefixo onde for montado:
 *
 *   GET  /balao-metas.js|.css   o balao flutuante (publico/)
 *   GET  /api/health
 *   GET  /api/hoje              as metas do dia, ja verificadas
 *
 * Nao tem pagina propria: o balao entra por uma linha de <script> no index.
 * Para tirar do ar, comente as linhas dele no src/app.js e no index.html.
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { metasDeHoje } from "./registro.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");

const router = express.Router();

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0 }));

router.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ status: "ok", modulo: "metas" });
});

router.get("/api/hoje", async (_req, res) => {
  // estado do dia muda a qualquer momento: nada de cache no navegador
  res.set("Cache-Control", "no-store");
  try {
    res.json(await metasDeHoje());
  } catch (err) {
    // o registro ja isola cada meta; chegar aqui e falha do proprio registro
    console.error("[metas] /api/hoje: " + err.message);
    res.status(500).json({ erro: "Não consegui montar as metas de hoje." });
  }
});

export default router;

/**
 * Modulo FDSFLIX.
 *
 * Mesmo contrato dos demais modulos do Segundo Cerebro: exporta um Router do
 * Express que serve, sob o prefixo onde for montado (/fdsflix):
 *
 *   GET  /                 a tela (publico/fdsflix.html)
 *   GET  /fdsflix.css|.js  os estaticos
 *   GET  /vendor/hls.min.js  o hls.js local (sem depender de CDN)
 *
 * Este modulo NAO tem API propria: a busca, o stream e as legendas vem do
 * servico externo https://fdsflix.onrender.com (Render gratuito, que dorme e
 * leva ate ~40 s para acordar). A tela fala com ele direto do navegador, entao
 * o PIN do 2brain nunca viaja para la (o /pin.js so carimba chamada da casa).
 *
 * Para tirar do ar, comente a linha no src/app.js. Nada mais depende.
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");
const PAGINA = path.join(PUBLICO, "fdsflix.html");

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(PAGINA);
});

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0, index: false }));

export default router;

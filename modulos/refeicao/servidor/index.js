/**
 * Modulo REFEICAO.
 *
 * Mesmo contrato dos modulos do Segundo Cerebro (trabalho, conversa, treino):
 * exporta um Router do Express que serve, sob o prefixo onde for montado:
 *
 *   GET  /                      a tela (publico/refeicao.html)
 *   GET  /refeicao.css|.js      os estaticos
 *   *    /api/...               as rotas de dados (ver servidor/rotas.mjs)
 *
 * Aqui ele roda sozinho, montado pelo src/app.js deste projeto. Para levar pro
 * 2brain: copie modulos/refeicao e src/ia, e monte com app.use("/refeicao").
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { ErroHttp } from "./banco.mjs";
import { rotear } from "./rotas.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");
const PAGINA = path.join(PUBLICO, "refeicao.html");

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(PAGINA);
});

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0, index: false }));

/* Dados. Tudo que comecar com /api cai no roteador do modulo. A medicao leva
   segundos (IA forte), entao nada de cache em lugar nenhum. */
router.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) return next();

  const url = new URL(req.url, "http://modulo.local");
  // a rota que o rotear() enxerga e o caminho SEM o /api
  const rota = url.pathname.replace(/^\/api/, "") || "/";
  try {
    res.set("Cache-Control", "no-store");
    res.status(200).json(await rotear(req, res, rota, url));
  } catch (err) {
    const status = err instanceof ErroHttp ? err.status : 500;
    if (status >= 500) console.error("[refeicao] erro em " + url.pathname + ": " + err.message);
    // 500 nao vaza detalhe interno pra tela; ErroHttp e mensagem pensada pra voce ler
    const mensagem = err instanceof ErroHttp ? err.message : "Erro interno. Veja o log do servidor.";
    res.status(status).json({ erro: mensagem, dica: err.dica || "" });
  }
});

export default router;

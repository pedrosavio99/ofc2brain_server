/**
 * Modulo TRABALHO - plugue para o Segundo Cerebro.
 *
 * Este e o UNICO arquivo que o app principal precisa conhecer. Ele exporta um
 * Router do Express que serve, sob o prefixo onde for montado:
 *
 *   GET  /                        a tela do modulo (publico/trabalho.html)
 *   GET  /trabalho.css|.js        os estaticos do modulo
 *   GET  /aba-trabalho.js         o script que injeta a aba no Segundo Cerebro
 *   *    /api/...                 as rotas de dados (ver servidor/rotas.mjs)
 *
 * No src/app.js do Segundo Cerebro basta:
 *   import trabalhoRouter from "../modulos/trabalho/servidor/index.js";
 *   app.use("/trabalho", trabalhoRouter);
 *
 * Para tirar o modulo do ar, comente essa linha. Nada mais no app depende dele.
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { ErroHttp } from "./clickup.mjs";
import { rotear } from "./rotas.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");
const PAGINA = path.join(PUBLICO, "trabalho.html");

const router = express.Router();

// A tela. Sem cache: e um shell pequeno, e assim uma alteracao aparece na hora.
router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(PAGINA);
});

// Estaticos do modulo. Ficam dentro da pasta do modulo de proposito: o
// Segundo Cerebro nao precisa saber que eles existem.
router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0 }));

// Dados. Tudo que sobrar e comecar com /api cai no roteador do modulo.
router.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) return next();

  const url = new URL(req.url, "http://modulo.local");
  try {
    res.set("Cache-Control", "no-store");
    res.status(200).json(await rotear(req, url));
  } catch (err) {
    const status = err instanceof ErroHttp ? err.status : 500;
    if (status >= 500) console.error("[trabalho] erro em " + url.pathname + ": " + err.message);
    res.status(status).json({ erro: err.message, dica: err.dica || "" });
  }
});

export default router;

/**
 * Modulo TREINO - plugue para o Segundo Cerebro.
 *
 * Mesmo contrato dos modulos trabalho e conversa: exporta um Router do Express
 * que serve, sob o prefixo onde for montado:
 *
 *   GET  /                 a tela do modulo (publico/treino.html)
 *   GET  /treino.css|.js   os estaticos do modulo
 *   GET  /aba-treino.js    o script que injeta a aba no Segundo Cerebro
 *   *    /api/...          as rotas de dados (ver servidor/rotas.mjs)
 *
 * Para tirar do ar, comente as duas linhas no src/app.js. Nada mais depende.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { ErroHttp } from "./banco.mjs";
import { rotear } from "./rotas.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");
const PAGINA = path.join(PUBLICO, "treino.html");

const router = express.Router();

/* A tela so chega mais pra frente. Enquanto o arquivo nao existir, devolve um
   aviso em vez de estourar 500: a API ja funciona por curl antes de haver tela,
   e um 500 aqui faria parecer que o modulo inteiro esta quebrado. */
router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!fs.existsSync(PAGINA)) {
    return res
      .status(200)
      .type("text/plain")
      .send("Modulo treino: API no ar em /treino/api. A tela ainda nao foi instalada.");
  }
  res.sendFile(PAGINA);
});

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0 }));

/* Dados. Tudo que comecar com /api cai no roteador do modulo. As rotas de LLM
   levam segundos, entao nada de cache em lugar nenhum. */
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
    if (status >= 500) console.error("[treino] erro em " + url.pathname + ": " + err.message);
    res.status(status).json({ erro: err.message, dica: err.dica || "" });
  }
});

export default router;

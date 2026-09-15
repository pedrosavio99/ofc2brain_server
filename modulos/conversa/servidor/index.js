/**
 * Modulo CONVERSA - plugue para o Segundo Cerebro.
 *
 * Mesmo contrato do modulo trabalho: exporta um Router do Express que serve,
 * sob o prefixo onde for montado:
 *
 *   GET  /                    a tela do modulo (publico/conversa.html)
 *   GET  /conversa.css|.js    os estaticos do modulo
 *   GET  /aba-conversa.js     o script que injeta a aba no Segundo Cerebro
 *   *    /api/...             as rotas de dados (ver servidor/rotas.mjs)
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
const PAGINA = path.join(PUBLICO, "conversa.html");

const router = express.Router();

/* A tela so chega no proximo bloco. Enquanto o arquivo nao existir, devolve um
   aviso em vez de estourar 500: a API ja funciona por curl antes de haver tela,
   e um 500 aqui faria parecer que o modulo inteiro esta quebrado. */
router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  if (!fs.existsSync(PAGINA)) {
    return res
      .status(200)
      .type("text/plain")
      .send("Modulo conversa: API no ar em /conversa/api. A tela ainda nao foi instalada.");
  }
  res.sendFile(PAGINA);
});

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0 }));

/* Dados. Tudo que comecar com /api cai no roteador do modulo. As rotas de LLM
   levam segundos, entao nada de cache em lugar nenhum. */
router.use(async (req, res, next) => {
  if (!req.path.startsWith("/api")) return next();

  const url = new URL(req.url, "http://modulo.local");
  try {
    res.set("Cache-Control", "no-store");
    res.status(200).json(await rotear(req, url));
  } catch (err) {
    const status = err instanceof ErroHttp ? err.status : 500;
    if (status >= 500) console.error("[conversa] erro em " + url.pathname + ": " + err.message);
    res.status(status).json({ erro: err.message, dica: err.dica || "" });
  }
});

export default router;

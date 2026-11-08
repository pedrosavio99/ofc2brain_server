/**
 * Modulo REFEICAO (somente API).
 *
 * A tela saiu: a Alimentacao agora vive dentro do modal do Treino
 * (modulos/treino/publico/alimentacao.js), que fala com as mesmas rotas daqui.
 * O que este modulo ainda serve, sob o prefixo onde for montado (/refeicao):
 *
 *   GET  /        redireciona para /treino#alimentacao (links e favoritos antigos)
 *   *    /api/... as rotas de dados (ver servidor/rotas.mjs)
 *
 * O Treino, a Conversa e o Metas continuam consumindo /refeicao/api.
 */
import express from "express";
import { ErroHttp } from "./banco.mjs";
import { rotear } from "./rotas.mjs";

const router = express.Router();

/* Link antigo da tela: abre o modal de alimentacao dentro do Treino. */
router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.redirect(302, "/treino#alimentacao");
});

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

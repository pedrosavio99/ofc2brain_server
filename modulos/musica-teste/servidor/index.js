/**
 * TESTE, descartavel. So existe pra responder uma pergunta:
 * o servidor do 2brain consegue falar com a API do modulo-playlist, ou o
 * Cloudflare do Sua Musica barra por ser IP de datacenter?
 *
 * O navegador ja consegue (o player funciona). O que nao sabemos e o
 * SERVIDOR, que e o que importa pra um modulo de musica aqui dentro.
 *
 * Pra remover: apague esta pasta e as 2 linhas no src/app.js.
 */
import express from "express";

/* Duas pontas, porque respondem coisas diferentes:
   - WORKER: e quem realmente fala com o Sua Musica (o player usa ele).
     Sem senha e com CORS *, ninguem precisa liberar nada. A duvida e se o
     Sua Musica barra quando o pedido nasce num datacenter.
   - VERCEL: hoje devolve 404 no repassador dela, entao serve so de contraste. */
const WORKER = process.env.MUSICA_WORKER || "https://teste-sm.pedro-sarmento-455.workers.dev";
const VERCEL = process.env.MUSICA_API || "https://modulo-playlist.vercel.app";
const API = WORKER;
const PRAZO_MS = 15000;

import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLICO = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "publico");

const router = express.Router();

// o botao e o modal saem daqui; no-store porque e teste e muda toda hora
router.use(express.static(PUBLICO, { setHeaders: (res) => res.set("Cache-Control", "no-store") }));

/** Uma chamada, com tempo e status. Bloqueio costuma virar 403 ou espera. */
async function chamar(caminho, base = API) {
  const inicio = Date.now();
  try {
    const r = await fetch(base + caminho, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PRAZO_MS),
    });
    const texto = await r.text();
    let corpo = null;
    try { corpo = JSON.parse(texto); } catch { corpo = texto.slice(0, 300); }
    return { ok: r.ok, status: r.status, ms: Date.now() - inicio, corpo };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - inicio, erro: e.name === "TimeoutError" ? "tempo esgotado" : e.message };
  }
}

/* GET /musica-teste/api/teste -> o diagnostico completo, numa chamada */
router.get("/api/teste", async (req, res) => {
  const cd = String(req.query.cd || "").trim();
  const [saude, inicio, umCd, vercel] = await Promise.all([
    chamar("/api/saude"),
    chamar("/api/inicio"),
    cd ? chamar("/api/cd?link=" + encodeURIComponent(cd)) : Promise.resolve(null),
    // contraste: a mesma chamada na Vercel, pra ver a diferenca entre as duas
    chamar("/api/inicio", VERCEL),
  ]);
  const destaques = (inicio.corpo && inicio.corpo.destaques) || [];
  res.set("cache-control", "no-store");
  return res.json({
    api: API,
    // o veredito: se o servidor passou, da pra ter modulo de musica aqui
    passou: !!(inicio.ok && destaques.length),
    saude, inicio: { ...inicio, corpo: { destaques: destaques.length } }, cd: umCd,
    vercel: { ...vercel, corpo: (vercel.corpo && vercel.corpo.erro) || ((vercel.corpo && vercel.corpo.destaques || []).length) },
    destaques: destaques.slice(0, 12),
  });
});

/* GET /musica-teste/api/<qualquer> -> repassa pra API e devolve como veio */
router.get("/api/*", async (req, res) => {
  const caminho = req.originalUrl.replace(/^.*?\/musica-teste\/api/, "/api");
  const r = await chamar(caminho);
  res.set("cache-control", "no-store");
  return res.status(r.ok ? 200 : 502).json(r);
});

export default router;

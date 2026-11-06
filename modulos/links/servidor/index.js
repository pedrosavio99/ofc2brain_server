/**
 * Modulo LINKS CURTOS - plugue para o Segundo Cerebro.
 *
 * Nao tem pagina propria: a tela e um modal aberto pelo menu "..." do inicio.
 * Sob o prefixo onde for montado, serve:
 *
 *   GET    /links.js|.css                 a tela do modal (publico/)
 *   GET    /api/health
 *   GET    /api/links                     lista
 *   POST   /api/links                     { urls: [], titulo? } adiciona
 *   PATCH  /api/links/:id                 { titulo? , url_curta? } edita / cola link curto feito fora
 *   POST   /api/links/:id/encurtar        { servico, alias? } gera (ou gera de novo) o link curto
 *   DELETE /api/links/:id
 *
 * No src/app.js:
 *   import linksRouter from "../modulos/links/servidor/index.js";
 *   app.use("/links", linksRouter);
 *
 * Para tirar do ar, comente essa linha e a do <script> no index.html.
 * A tabela vem de supabase/links.sql.
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import {
  ErroHttp, listar, buscarPorId, adicionar, atualizar, excluir,
} from "./banco.mjs";
import {
  SERVICOS, ErroEncurtar, encurtar, normalizarUrl, limparAlias, urlManual,
} from "./encurtar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");

const router = express.Router();

router.use(express.static(PUBLICO, { fallthrough: true, maxAge: 0 }));

router.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.get("/api/health", (_req, res) => res.json({ status: "ok", modulo: "links" }));

// Cada handler passa por aqui pra erro virar JSON com status certo.
const rota = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    const status = err instanceof ErroHttp || err instanceof ErroEncurtar ? err.status : 500;
    if (status >= 500 && !(err instanceof ErroEncurtar)) console.error("[links] " + err.message);
    res.status(status).json({ erro: err.message, dica: err.dica || "", manual: err.manual || "" });
  }
};

router.get("/api/links", rota(async () => ({ links: await listar() })));

router.post("/api/links", rota(async (req) => {
  const bruto = Array.isArray(req.body?.urls) ? req.body.urls : [req.body?.url];
  const validas = [];
  let invalidas = 0;
  for (const b of bruto.slice(0, 50)) {
    if (!String(b || "").trim()) continue;
    const u = normalizarUrl(b);
    u ? validas.push(u) : invalidas++;
  }
  if (!validas.length) throw new ErroHttp(400, "Nenhum link válido encontrado.");
  const titulo = String(req.body?.titulo || "").trim().slice(0, 120);
  const r = await adicionar(validas, titulo);
  return { ...r, invalidas };
}));

router.patch("/api/links/:id", rota(async (req) => {
  const campos = {};
  if (req.body?.titulo !== undefined) campos.titulo = String(req.body.titulo).trim().slice(0, 120);
  if (req.body?.url_curta !== undefined) {
    const curta = normalizarUrl(req.body.url_curta);
    if (!curta) throw new ErroHttp(400, "Link curto inválido.");
    Object.assign(campos, { url_curta: curta, servico: "manual", alias: null, curto_em: new Date().toISOString() });
  }
  if (!Object.keys(campos).length) throw new ErroHttp(400, "Nada para atualizar.");
  return { link: await atualizar(req.params.id, campos) };
}));

router.post("/api/links/:id/encurtar", rota(async (req) => {
  const servico = String(req.body?.servico || "");
  if (!SERVICOS[servico]) throw new ErroHttp(400, "Escolha is.gd, da.gd ou TinyURL.");
  const link = await buscarPorId(req.params.id);
  const alias = limparAlias(req.body?.alias);
  try {
    const curta = await encurtar(servico, link.url_longa, alias);
    // So troca o link curto DEPOIS de o novo existir: se falhar, o antigo fica.
    return {
      link: await atualizar(link.id, { url_curta: curta, servico, alias: alias || null, curto_em: new Date().toISOString() }),
    };
  } catch (err) {
    if (err instanceof ErroEncurtar) {
      // abre o site do servico ja preenchido; a pessoa cola o resultado.
      err.manual = urlManual(servico, link.url_longa, alias);
    }
    throw err;
  }
}));

router.delete("/api/links/:id", rota(async (req) => {
  await excluir(req.params.id);
  return { ok: true };
}));

export default router;

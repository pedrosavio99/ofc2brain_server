/**
 * Modulo MUSICA.
 *
 * Diferente dos outros modulos: aqui o SERVIDOR nao fala com a fonte de
 * dados. Ele so serve a tela.
 *
 * O porque esta medido, nao suposto:
 *   navegador -> Worker ....... passa (local e Vercel)
 *   servidor local -> Worker .. passa
 *   servidor Vercel -> Worker . BARRADO (502, o Sua Musica recusa datacenter)
 *
 * Entao a tela fala direto com o Worker da Cloudflare, igual ao player que ja
 * funciona. O audio tambem vem direto do CloudFront pro navegador.
 * Se um dia o servidor precisar entrar (sincronizar fila, favoritos), sera
 * contra o Supabase, nunca contra o Sua Musica.
 */
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(__dirname, "..", "publico");
const PAGINA = path.join(PUBLICO, "musica.html");

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(PAGINA);
});

// no-store e nao maxAge 0: maxAge 0 so pede revalidacao e o navegador as
// vezes nem pergunta, o que ja custou caro no modulo refeicao
router.use(express.static(PUBLICO, {
  fallthrough: true,
  index: false,
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.set("Cache-Control", "no-store"),
}));

export default router;

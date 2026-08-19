import { Router } from "express";
import express from "express";
import { exportarBackup, restaurarBackup, compactar, estatisticas } from "../db.js";

const router = Router();

// v2: o backup agora e JSON (o arquivo .bin nao existe mais; os dados vivem
// no Supabase). Upload continua chegando como corpo cru pra nao exigir
// dependencia de multipart.
const corpoBinario = express.raw({
  type: ["application/json", "application/octet-stream", "text/plain"],
  limit: process.env.LIMITE_UPLOAD || "50mb",
});

/** Baixa o backup: um JSON com todas as ideias (metadados + embeddings). */
router.get("/backup", async (_req, res) => {
  try {
    const buf = await exportarBackup();
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="2brain-${carimbo}.json"`);
    res.setHeader("Content-Length", buf.length);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * Sobe um backup JSON.
 *   ?modo=mesclar     (padrao) faz upsert, sem apagar o que ja existe.
 *   ?modo=substituir  limpa a tabela antes de importar.
 * Corpo: o JSON exportado por GET /backup.
 */
router.post("/restore", corpoBinario, async (req, res) => {
  try {
    const buf = req.body;
    if (!buf || !buf.length) {
      return res.status(400).json({
        erro: "Envie o JSON do backup no corpo (Content-Type: application/json).",
      });
    }
    const modo = String(req.query.modo || "mesclar");
    const relatorio = await restaurarBackup(buf, { modo });
    res.json({
      ok: true,
      mensagem: modo === "substituir" ? "Backup restaurado (substituicao)." : "Backup mesclado.",
      ...relatorio,
    });
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

/** No Postgres nao ha lixo de append-only; mantido por compatibilidade. */
router.post("/compactar", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await compactar()) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/** Estado do armazenamento. */
router.get("/armazenamento", async (_req, res) => {
  try {
    res.json(await estatisticas());
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

export default router;

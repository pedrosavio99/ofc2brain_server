// Seed: le o arquivo binario antigo (data/2brain.bin), regera os embeddings
// no Gemini (768d) e faz upsert no Supabase. Idempotente (upsert por id).
//
// Uso:
//   node scripts/seed-supabase.mjs
//   BIN=/caminho/2brain.bin node scripts/seed-supabase.mjs
//
// Precisa no .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY(S).
// Rode o supabase/schema.sql ANTES (cria a tabela + pgvector + match_ideias).

import "dotenv/config";
import fs from "fs";
import path from "path";
import { gerarEmbedding } from "../src/embeddings.js";
import { salvar, estatisticas } from "../src/db.supabase.js";

const ARQUIVO = process.env.BIN || path.join(process.cwd(), "data", "2brain.bin");
const PAUSA_MS = Number(process.env.SEED_PAUSA_MS || 250); // respira entre chamadas

const MAGIC = Buffer.from("2BRAINDB", "utf8");
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- parser do formato binario (igual ao db.file.js: header 16B, reg 9B) ----
function lerBin(buf) {
  if (!buf || buf.length < 16 || !buf.subarray(0, 8).equals(MAGIC)) {
    throw new Error("arquivo nao parece um 2brain.bin valido");
  }
  const mapa = new Map();
  let off = 16;
  while (off + 9 <= buf.length) {
    const tipo = buf.readUInt8(off);
    const tamMeta = buf.readUInt32LE(off + 1);
    const tamEmb = buf.readUInt32LE(off + 5);
    const fim = off + 9 + tamMeta + tamEmb;
    if (fim > buf.length) break; // registro truncado
    let meta;
    try {
      meta = JSON.parse(buf.subarray(off + 9, off + 9 + tamMeta).toString("utf8"));
    } catch {
      break;
    }
    if (tipo === 1) mapa.set(meta.id, meta); // UPSERT (embedding antigo ignorado)
    else if (tipo === 2) mapa.delete(meta.id); // TUMBA
    off = fim;
  }
  return [...mapa.values()];
}

async function main() {
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)) {
    console.error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env");
    process.exit(1);
  }
  if (!fs.existsSync(ARQUIVO)) {
    console.error(`Arquivo nao encontrado: ${ARQUIVO}`);
    process.exit(1);
  }

  const ideias = lerBin(fs.readFileSync(ARQUIVO));
  console.log(`[seed] ${ideias.length} ideia(s) no arquivo. Regerando embeddings no Gemini...`);

  let ok = 0;
  let falhas = 0;
  for (let i = 0; i < ideias.length; i++) {
    const it = ideias[i];
    const marca = `(${i + 1}/${ideias.length})`;
    try {
      const embedding = await gerarEmbedding(it.texto_original);
      await salvar({
        id: it.id,
        texto_original: it.texto_original,
        resumo: it.resumo ?? null,
        area: it.area ?? null,
        tags: it.tags ?? [],
        tipo: it.tipo ?? "ideia",
        data_evento: it.data_evento ?? null,
        // relacionados vieram do espaco antigo (384d): mantidos como anotacao.
        // Rode "npm run relink" depois se quiser reconstruir no espaco novo.
        relacionados: it.relacionados ?? [],
        criado_em: it.criado_em ?? new Date().toISOString(),
        embedding,
      });
      ok++;
      console.log(`[seed] ${marca} ok: ${(it.resumo || it.texto_original || "").slice(0, 60)}`);
    } catch (err) {
      falhas++;
      console.error(`[seed] ${marca} FALHOU (${it.id}): ${err.message}`);
    }
    await dormir(PAUSA_MS);
  }

  const stat = await estatisticas().catch(() => ({}));
  console.log(`\n[seed] concluido. gravadas: ${ok} | falhas: ${falhas} | total na base: ${stat.ideias ?? "?"}`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[seed] erro fatal:", err);
  process.exit(1);
});

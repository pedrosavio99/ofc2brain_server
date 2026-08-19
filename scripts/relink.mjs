// Relink LOCAL: reconstroi embeddings + relacoes no Supabase, sem limite de
// tempo (roda na sua maquina, apontando pro mesmo Supabase do .env).
// Em serverless (Vercel) a rota POST /relink retorna 501 de proposito.
//
// Uso: npm run relink   (ou: node scripts/relink.mjs)

import "dotenv/config";
import { reindexarTudo } from "../src/ideasService.js";

console.log("[relink] iniciando reconstrucao (embeddings + relacoes)...");
reindexarTudo((p) => {
  const fase = p.fase || "?";
  console.log(`[relink] fase=${fase} ${p.feito ?? 0}/${p.total ?? 0} falhas=${p.falhas ?? 0}`);
})
  .then((resumo) => {
    console.log("[relink] concluido:", JSON.stringify(resumo));
    process.exit(0);
  })
  .catch((err) => {
    console.error("[relink] falhou:", err);
    process.exit(1);
  });

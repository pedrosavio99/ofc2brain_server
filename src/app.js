// Monta e exporta o app Express (SEM app.listen).
// - Local: src/server.js importa isto e chama listen.
// - Vercel: api/index.js importa isto e exporta como funcao serverless.
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import ideiasRouter from "./routes/ideias.js";
import backupRouter from "./routes/backup.js";
import docsRouter from "./routes/docs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Healthcheck: responde rapido, sem tocar o banco.
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Front (mural). Na Vercel o CDN serve o public/ antes da funcao; isto aqui
// cobre o uso local. Inofensivo em serverless.
app.use(express.static(PUBLIC_DIR));

app.get("/api", (_req, res) => {
  res.json({
    nome: "Segundo Cerebro API",
    versao: 4,
    armazenamento: "supabase + pgvector",
    embedding: "gemini text-embedding-004 (768d)",
    endpoints: [
      "GET    /health",
      "POST   /ideias             { texto: string }",
      "POST   /extrair            { texto: string, maximo? } (garimpo: candidatas, nao salva)",
      "GET    /ideias             ?area=&tipo=&desde=&ate=",
      "GET    /ideias/:id",
      "DELETE /ideias/:id",
      "GET    /pesquisa           ?q=&insight=true&limite=5&angulo=&tamanho=",
      "GET    /insight            ?q=&area=&periodo=7d|30d|tudo&desde=&ate=&limite=20&angulo=&tamanho=",
      "POST   /insight            { q?, area?, periodo?, desde?, ate?, limite?, angulo?, tamanho? }",
      "GET    /insight/formatos   (angulos, tamanhos e atalhos disponiveis)",
      "POST   /insight/sugerir-formato { ids?|filtros } (escolhe angulo/tamanho antes de gerar)",
      "POST   /insight/continuar  { anterior, pedido?|atalho?, ids?, historico?, foco? }",
      "GET    /eventos/proximos   ?dias=30",
      "GET    /insight/sugestoes  ?ultimas=20",
      "GET    /insight/chaves",
      "POST   /relink             (local; em serverless retorna 501 com instrucao)",
      "GET    /backup             (export JSON)",
      "POST   /restore            ?modo=substituir|mesclar (envie o JSON)",
      "GET    /armazenamento",
      "GET    /docs               (Swagger UI)",
      "GET    /openapi.json       (especificacao OpenAPI 3)",
    ],
  });
});

app.use(ideiasRouter);
app.use(backupRouter);
app.use(docsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: "Erro interno inesperado." });
});

export default app;
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
// Modulos externos: cada um vive inteiro em modulos/<nome>/ e so encosta no
// app por uma linha de app.use(). Comentar as duas linhas desliga o modulo.
import trabalhoRouter from "../modulos/trabalho/servidor/index.js";

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
    modulos: ["trabalho (ClickUp) em /trabalho"],
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
      "--- modulo trabalho ---",
      "GET    /trabalho                       (tela do modulo)",
      "GET    /trabalho/api/health",
      "GET    /trabalho/api/me",
      "GET    /trabalho/api/tasks             ?closed=1&subtasks=0&due=&atividade=7|30&q=&space=&ordem=",
      "GET    /trabalho/api/tasks/:id",
      "GET    /trabalho/api/tasks/:id/statuses",
      "POST   /trabalho/api/tasks/:id/comment { texto }",
      "PUT    /trabalho/api/tasks/:id/status  { status }",
      "POST   /trabalho/api/plano             { ids: [] }",
    ],
  });
});

app.use(ideiasRouter);
app.use(backupRouter);
app.use(docsRouter);

// Modulos montados por prefixo. O prefixo e o unico acoplamento.
app.use("/trabalho", trabalhoRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: "Erro interno inesperado." });
});

export default app;
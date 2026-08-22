// Documentacao da API: /openapi.json (a spec) e /docs (Swagger UI).
//
// A Swagger UI vem de CDN (jsdelivr), carregada pelo navegador de quem abre
// /docs. Foi de proposito: nao adiciona dependencia no package.json nem assets
// pra empacotar, o que mantem a funcao serverless da Vercel leve. Se um dia
// quiser tudo self-hosted, troque por swagger-ui-express.

import { Router } from "express";
import openapi from "../openapi.js";

const router = Router();

// A spec crua, pra quem quiser importar no Postman/Insomnia ou gerar client.
router.get("/openapi.json", (_req, res) => {
  res.json(openapi);
});

const VERSAO_SWAGGER = "5.17.14";

const PAGINA_DOCS = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Segundo Cerebro - API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSAO_SWAGGER}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSAO_SWAGGER}/swagger-ui-bundle.js"></script>
  <script>
    window.addEventListener("load", function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger",
        deepLinking: true,
        docExpansion: "list",
        defaultModelsExpandDepth: 0,
        tryItOutEnabled: true,
      });
    });
  </script>
</body>
</html>`;

router.get("/docs", (_req, res) => {
  res.type("html").send(PAGINA_DOCS);
});

export default router;
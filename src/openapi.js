// Especificacao OpenAPI 3 da API do Segundo Cerebro.
// Escrita a mao (objeto JS puro) de proposito: nada de swagger-jsdoc lendo
// comentarios em runtime, que so adiciona dependencia e ponto de falha no
// serverless. Este objeto e servido em /openapi.json e o /docs (Swagger UI via
// CDN) aponta pra ele. Ao criar/alterar uma rota, atualize aqui tambem.

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Segundo Cerebro API",
    version: "4.0.0",
    description:
      "API que organiza ideias, conceitos e lembretes automaticamente (LLM Groq + " +
      "embeddings Gemini). Armazenamento em Supabase (Postgres + pgvector). " +
      "Os insights informam de qual provedor/modelo/chave sairam.",
  },
  // relativo: funciona igual no local (localhost:3333) e na Vercel
  servers: [{ url: "/", description: "mesma origem" }],
  tags: [
    { name: "Notas", description: "CRUD das ideias/notas" },
    { name: "Busca e insight", description: "Pesquisa semantica e geracao de insight" },
    { name: "Eventos", description: "Lembretes com data" },
    { name: "Manutencao", description: "Reindexacao e diagnostico" },
    { name: "Backup", description: "Exportar, restaurar e estado do armazenamento" },
    { name: "Sistema", description: "Health e metadados" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Sistema"],
        summary: "Healthcheck rapido (nao toca o banco)",
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
          },
        },
      },
    },
    "/api": {
      get: {
        tags: ["Sistema"],
        summary: "Metadados da API e lista de endpoints",
        responses: { 200: { description: "Metadados" } },
      },
    },
    "/ideias": {
      post: {
        tags: ["Notas"],
        summary: "Cria uma nota de forma automatica (so o texto e obrigatorio)",
        description:
          "O texto passa por embedding + LLM, que geram resumo, area, tags, tipo, " +
          "data de evento (se houver) e ligacoes com notas parecidas.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IdeiaEntrada" },
              example: { texto: "Reuniao com o cliente dia 12 sobre o novo totem" },
            },
          },
        },
        responses: {
          201: {
            description: "Nota criada",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ideia" } } },
          },
          400: { $ref: "#/components/responses/Erro" },
        },
      },
      get: {
        tags: ["Notas"],
        summary: "Lista notas com filtros opcionais",
        parameters: [
          { name: "area", in: "query", schema: { type: "string" }, description: "Filtra por area exata" },
          {
            name: "tipo",
            in: "query",
            schema: { type: "string", enum: ["ideia", "conceito", "lembrete_evento"] },
          },
          { name: "desde", in: "query", schema: { type: "string" }, description: "ISO ou AAAA-MM-DD" },
          { name: "ate", in: "query", schema: { type: "string" }, description: "ISO ou AAAA-MM-DD (vira fim do dia)" },
        ],
        responses: {
          200: {
            description: "Lista de notas",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Ideia" } },
              },
            },
          },
        },
      },
    },
    "/ideias/{id}": {
      get: {
        tags: ["Notas"],
        summary: "Busca uma nota por id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          200: {
            description: "Nota",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Ideia" } } },
          },
          404: { $ref: "#/components/responses/Erro" },
        },
      },
      delete: {
        tags: ["Notas"],
        summary: "Remove uma nota",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          204: { description: "Removida" },
          404: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/pesquisa": {
      get: {
        tags: ["Busca e insight"],
        summary: "Busca semantica, com insight opcional",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Tema/consulta" },
          {
            name: "insight",
            in: "query",
            schema: { type: "boolean", default: false },
            description: "Se true, gera tambem um insight sobre os resultados",
          },
          { name: "limite", in: "query", schema: { type: "integer", default: 5 } },
        ],
        responses: {
          200: {
            description: "Resultados por semelhanca (+ insight se pedido)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ResultadoPesquisa" } } },
          },
          400: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/insight": {
      get: {
        tags: ["Busca e insight"],
        summary: "Insight avancado sobre um recorte (area/periodo/frase ou nada)",
        description:
          "Gera insight a partir de um recorte por FILTRO (area + intervalo), nao de " +
          "busca pura. Tres modos: por area/periodo, com uma frase/pergunta de base (q), " +
          "ou sem nada (so o recorte). Devolve tambem de qual provedor/modelo/chave saiu.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Frase/pergunta de base (opcional)" },
          { name: "area", in: "query", schema: { type: "string" } },
          {
            name: "periodo",
            in: "query",
            schema: { type: "string", enum: ["1d", "7d", "30d", "90d", "365d", "tudo"] },
            description: "Atalho de intervalo; tem prioridade sobre desde/ate",
          },
          { name: "desde", in: "query", schema: { type: "string" }, description: "ISO ou AAAA-MM-DD" },
          { name: "ate", in: "query", schema: { type: "string" } },
          { name: "limite", in: "query", schema: { type: "integer", default: 20, maximum: 60 } },
        ],
        responses: {
          200: {
            description: "Insight do recorte",
            content: { "application/json": { schema: { $ref: "#/components/schemas/InsightAvancado" } } },
          },
          500: { $ref: "#/components/responses/Erro" },
        },
      },
      post: {
        tags: ["Busca e insight"],
        summary: "Igual ao GET /insight, mas com os campos no corpo (melhor pra frases longas)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  q: { type: "string" },
                  area: { type: "string" },
                  periodo: { type: "string", enum: ["1d", "7d", "30d", "90d", "365d", "tudo"] },
                  desde: { type: "string" },
                  ate: { type: "string" },
                  limite: { type: "integer", default: 20, maximum: 60 },
                },
              },
              example: { q: "o que eu deveria priorizar essa semana", periodo: "7d", limite: 20 },
            },
          },
        },
        responses: {
          200: {
            description: "Insight do recorte",
            content: { "application/json": { schema: { $ref: "#/components/schemas/InsightAvancado" } } },
          },
          500: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/insight/sugestoes": {
      get: {
        tags: ["Busca e insight"],
        summary: "Sugere 10 perguntas ancoradas nas notas",
        parameters: [
          { name: "ultimas", in: "query", schema: { type: "integer", default: 20 } },
          { name: "ids", in: "query", schema: { type: "string" }, description: "Recorte especifico (ids separados por virgula)" },
          { name: "forcar", in: "query", schema: { type: "boolean" }, description: "Ignora o cache" },
        ],
        responses: {
          200: {
            description: "Perguntas sugeridas",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Sugestoes" } } },
          },
        },
      },
    },
    "/insight/chaves": {
      get: {
        tags: ["Manutencao"],
        summary: "Diagnostico das chaves de LLM (Gemini e Groq)",
        responses: { 200: { description: "Estado das chaves por modelo" } },
      },
    },
    "/eventos/proximos": {
      get: {
        tags: ["Eventos"],
        summary: "Lembretes com data nos proximos N dias",
        parameters: [{ name: "dias", in: "query", schema: { type: "integer", default: 30 } }],
        responses: {
          200: {
            description: "Eventos ordenados por data",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Ideia" } } },
            },
          },
        },
      },
    },
    "/relink": {
      post: {
        tags: ["Manutencao"],
        summary: "Reconstroi embeddings e ligacoes de todas as notas (job em background)",
        description: "Nao roda em serverless (retorna 501). Rode local apontando pro mesmo Supabase.",
        responses: {
          202: { description: "Job iniciado", content: { "application/json": { schema: { $ref: "#/components/schemas/RelinkJob" } } } },
          409: { $ref: "#/components/responses/Erro" },
          501: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/relink/status/{jobId}": {
      get: {
        tags: ["Manutencao"],
        summary: "Progresso da reconstrucao",
        parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Estado do job" },
          404: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/backup": {
      get: {
        tags: ["Backup"],
        summary: "Exporta tudo num JSON (metadados + embeddings)",
        responses: {
          200: {
            description: "Arquivo JSON de backup",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/restore": {
      post: {
        tags: ["Backup"],
        summary: "Restaura um backup JSON",
        parameters: [
          {
            name: "modo",
            in: "query",
            schema: { type: "string", enum: ["mesclar", "substituir"], default: "mesclar" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          200: { description: "Relatorio da restauracao" },
          400: { $ref: "#/components/responses/Erro" },
        },
      },
    },
    "/compactar": {
      post: {
        tags: ["Backup"],
        summary: "No-op no Postgres (mantido por compatibilidade)",
        responses: { 200: { description: "OK" } },
      },
    },
    "/armazenamento": {
      get: {
        tags: ["Backup"],
        summary: "Estado do armazenamento (motor e contagem de notas)",
        description: "O front usa a contagem daqui pra detectar cold start do Supabase e dar reload.",
        responses: {
          200: {
            description: "Estatisticas",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Armazenamento" } } },
          },
        },
      },
    },
  },
  components: {
    responses: {
      Erro: {
        description: "Erro",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
      },
    },
    schemas: {
      Health: {
        type: "object",
        properties: { status: { type: "string", example: "ok" } },
      },
      Erro: {
        type: "object",
        properties: { erro: { type: "string" } },
      },
      IdeiaEntrada: {
        type: "object",
        required: ["texto"],
        properties: { texto: { type: "string", description: "O que voce quer guardar" } },
      },
      Relacionado: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          motivo: { type: "string" },
          score: { type: "number" },
        },
      },
      Ideia: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          texto_original: { type: "string" },
          resumo: { type: "string" },
          area: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          tipo: { type: "string", enum: ["ideia", "conceito", "lembrete_evento"] },
          data_evento: { type: "string", nullable: true, description: "AAAA-MM-DD ou null" },
          relacionados: { type: "array", items: { $ref: "#/components/schemas/Relacionado" } },
          criado_em: { type: "string", format: "date-time" },
        },
      },
      InsightMeta: {
        type: "object",
        description: "De onde o insight saiu. null quando o modelo nao conseguiu gerar.",
        nullable: true,
        properties: {
          provedor: { type: "string", enum: ["gemini", "groq"] },
          modelo: { type: "string", example: "gemini-2.5-flash" },
          chave: { type: "integer", description: "Indice da chave usada (1-based)" },
          totalChaves: { type: "integer" },
          pensando: { type: "boolean", description: "So no Gemini: se rodou com modo de pensamento" },
          notasConsideradas: { type: "integer", description: "Quantas notas entraram no prompt" },
          notasFortes: { type: "integer", description: "Quantas eram realmente relevantes ao tema" },
          temTema: { type: "boolean" },
          escopo: { type: "string", nullable: true },
        },
      },
      ResultadoPesquisa: {
        type: "object",
        properties: {
          resultados: {
            type: "array",
            items: {
              allOf: [
                { $ref: "#/components/schemas/Ideia" },
                { type: "object", properties: { score: { type: "number" } } },
              ],
            },
          },
          insight: { type: "string", nullable: true, description: "Texto do insight (se insight=true)" },
          insight_meta: { $ref: "#/components/schemas/InsightMeta" },
        },
      },
      InsightAvancado: {
        type: "object",
        properties: {
          insight: { type: "string", nullable: true },
          insight_meta: { $ref: "#/components/schemas/InsightMeta" },
          usou: { type: "integer", description: "Quantas notas do recorte entraram" },
          escopoTexto: { type: "string", description: "Descricao humana do recorte" },
          escopo: {
            type: "object",
            properties: {
              area: { type: "string", nullable: true },
              periodo: { type: "string", nullable: true },
              desde: { type: "string", nullable: true },
              ate: { type: "string", nullable: true },
              tema: { type: "string", nullable: true },
              limite: { type: "integer" },
            },
          },
          motivo: { type: "string", description: "So aparece quando insight vem null" },
          notas: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                resumo: { type: "string" },
                area: { type: "string" },
                score: { type: "number", nullable: true },
              },
            },
          },
        },
      },
      Sugestoes: {
        type: "object",
        properties: {
          perguntas: {
            type: "array",
            items: {
              type: "object",
              properties: { pergunta: { type: "string" }, porque: { type: "string" } },
            },
          },
          baseadoEm: { type: "integer" },
          escopo: { type: "string", enum: ["recentes", "selecao"] },
          doCache: { type: "boolean" },
        },
      },
      RelinkJob: {
        type: "object",
        properties: {
          jobId: { type: "string", format: "uuid" },
          estado: { type: "string", enum: ["rodando", "concluido", "erro"] },
        },
      },
      Armazenamento: {
        type: "object",
        properties: {
          motor: { type: "string", example: "supabase" },
          ideias: { type: "integer", description: "Total de notas no banco" },
          tumbas: { type: "integer" },
        },
      },
    },
  },
};

export default openapi;
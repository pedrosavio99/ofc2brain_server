/**
 * Servidor MCP do segundo cerebro. Endpoint: POST /mcp
 *
 * O MESMO catalogo de ferramentas que a conversa usa por dentro (ferramentas.mjs)
 * vira "tools" do Model Context Protocol. Resultado: Claude, ChatGPT, Cursor e
 * qualquer cliente MCP passam a consultar as suas notas, memorias, treinos,
 * refeicoes e tarefas, com os SEUS dados, sem voce reescrever nada.
 *
 * Por que a conversa interna NAO fala com este endpoint: na Vercel cada request
 * e uma funcao nova; chamar o proprio servidor por HTTP so somaria latencia e
 * cold start sem ganhar nada. Duas portas, uma implementacao.
 *
 * Transporte: Streamable HTTP, SEM sessao (stateless). E o modo que serve a
 * serverless: cada POST cria um servidor, responde e acaba.
 *
 * SOMENTE LEITURA, de proposito. Escrever nota ou memoria por MCP e uma decisao
 * a parte (um cliente externo com prompt injection poderia gravar lixo).
 *
 * SEGURANCA. Este endpoint expoe TODOS os seus dados pessoais. Por isso:
 *   - nao existe sem MCP_TOKEN: sem a variavel responde 503, nunca "aberto";
 *   - exige "Authorization: Bearer <MCP_TOKEN>", comparado em tempo constante;
 *   - o PIN do navegador NAO vale aqui (cliente MCP nao tem tela pra digitar);
 *     o caminho /mcp e liberado do PIN em acesso.js porque se autentica sozinho.
 *   Use um token longo e aleatorio (>= 32 caracteres): `openssl rand -hex 32`.
 */
import crypto from "crypto";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { FERRAMENTAS, executarFerramenta, criarEmbed } from "./ferramentas.mjs";
import { prepararTurno } from "./turno.mjs";

const router = express.Router();

/* ------------------------------------------------------------- autenticacao */

function tokenConfigurado() {
  return String(process.env.MCP_TOKEN || "").trim();
}

/** Comparacao de tempo constante. Pura o bastante pra testar. */
export function tokenConfere(recebido, esperado) {
  const a = Buffer.from(String(recebido || ""), "utf8");
  const b = Buffer.from(String(esperado || ""), "utf8");
  if (!b.length) return false;
  if (a.length !== b.length) { crypto.timingSafeEqual(b, b); return false; }
  return crypto.timingSafeEqual(a, b);
}

function bearerDe(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

/* ------------------------------------------------------------- ferramentas */

function zodDe(def, obrigatorio) {
  let z0;
  if (def.tipo === "lista") z0 = z.array(z.string()).max(def.max || 3);
  else if (def.tipo === "numero") z0 = z.number().int().min(def.min).max(def.max);
  else if (def.tipo === "escolha") z0 = z.enum(def.opcoes);
  else z0 = z.string();
  const desc = def.padrao !== undefined ? `${def.descricao} Padrão: ${def.padrao}.` : def.descricao;
  z0 = z0.describe(desc);
  return obrigatorio ? z0 : z0.optional();
}

/** Argumentos de lista sao obrigatorios por MCP: sem plano da conversa, nao ha de onde inferir. */
function formaDoZod(args) {
  return Object.fromEntries(Object.entries(args).map(([k, def]) => [k, zodDe(def, def.tipo === "lista")]));
}

const SO_LEITURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function criarServidor() {
  const servidor = new McpServer({ name: "segundo-cerebro", version: "1.0.0" });

  for (const [nome, { espec }] of Object.entries(FERRAMENTAS)) {
    servidor.registerTool(nome, {
      title: nome.replace(/_/g, " "),
      description: espec.descricao,
      inputSchema: formaDoZod(espec.args),
      annotations: SO_LEITURA,
    }, async (args) => {
      const ctx = { plano: null, texto: "", conversaId: null, agora: new Date(), embed: criarEmbed(), idsBase: new Set() };
      const r = await executarFerramenta(nome, args, ctx);
      return { content: [{ type: "text", text: r.texto || "(sem resultado)" }], isError: Boolean(r.erro) };
    });
  }

  /* A mais util pra um cliente externo: pergunta em linguagem natural, e o
     proprio segundo cerebro decide onde procurar (planejador) e devolve a
     evidencia consolidada. O cliente nao precisa saber qual ferramenta chamar. */
  servidor.registerTool("consultar", {
    title: "consultar",
    description:
      "Pergunte em linguagem natural e o segundo cérebro decide onde procurar (notas, memórias, treinos, " +
      "refeições, tarefas...) e devolve a evidência encontrada, com datas. Use quando não souber qual ferramenta chamar.",
    inputSchema: { pergunta: z.string().min(2).max(1500).describe("A pergunta ou assunto, como a pessoa diria.") },
    annotations: SO_LEITURA,
  }, async ({ pergunta }) => {
    const t = await prepararTurno({ texto: pergunta });
    const memorias = t.memorias.length ? `MEMÓRIAS SOBRE A PESSOA:\n${t.memorias.map((m) => `- ${m.fato}`).join("\n")}\n\n` : "";
    const corpo = `${memorias}${t.pacote.texto || "Nada encontrado nas fontes consultadas."}`;
    return { content: [{ type: "text", text: corpo }] };
  });

  return servidor;
}

/* ---------------------------------------------------------------- rotas */

const naoPermitido = (_req, res) => res.status(405).json({
  jsonrpc: "2.0", error: { code: -32000, message: "Metodo nao permitido: este servidor MCP e stateless, use POST." }, id: null,
});

router.post("/", async (req, res) => {
  const esperado = tokenConfigurado();
  if (!esperado) {
    return res.status(503).json({ erro: "MCP desativado.", dica: "Defina MCP_TOKEN no ambiente (use: openssl rand -hex 32)." });
  }
  if (!tokenConfere(bearerDe(req), esperado)) {
    res.set("WWW-Authenticate", 'Bearer realm="segundo-cerebro"');
    return res.status(401).json({ erro: "Token invalido ou ausente." });
  }

  try {
    const servidor = criarServidor();
    // sessionIdGenerator undefined = stateless; JSON em vez de SSE: serverless nao segura stream
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transporte.close(); servidor.close(); });
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("[mcp] erro: " + e.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno do servidor MCP." }, id: null });
    }
  }
});

router.get("/", naoPermitido);
router.delete("/", naoPermitido);

export default router;

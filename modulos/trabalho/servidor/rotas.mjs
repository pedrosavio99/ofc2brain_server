/**
 * Modulo TRABALHO - rotas, sem servidor.
 *
 * Recebe (req, url) e devolve um objeto pra virar JSON. Quem monta isso num
 * servidor e o index.js (Router do Express). Deixar as rotas separadas do
 * framework e o que permite levar esta pasta pra outro lugar depois.
 *
 * Os caminhos aqui sao relativos ao ponto de montagem. Montado em /trabalho,
 * "/api/tasks" vira "/trabalho/api/tasks" no navegador.
 */
import {
  cfg, ErroHttp, exigirToken,
  buscarUsuario, buscarWorkspaces, buscarTasks, buscarTask, statusesDaLista,
  comentar, mudarStatus, contarPrazos, ordenarPorPrazo, PRAZOS,
  dentroDaAtividade, contarAtividade, ATIVIDADES,
} from "./clickup.mjs";
import { ordenarTarefas, temGroq, groq } from "./groq.mjs";

export { ErroHttp };

const log = (...args) => console.log("[trabalho]", ...args);

/* ------------------------------- cache -------------------------------- */

const cache = new Map();
export const limparCache = () => cache.clear();

async function comCache(chave, produzir) {
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < cfg.cacheMs) return { ...guardado.valor, cache: true };
  const valor = await produzir();
  cache.set(chave, { em: Date.now(), valor });
  return { ...valor, cache: false };
}

/* ------------------------------ corpo --------------------------------- */

// O Express ja parseia com express.json(), entao normalmente req.body chega
// pronto. Os outros caminhos ficam aqui pro modulo continuar rodando solto.
export function lerCorpo(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new ErroHttp(400, "Corpo nao e um JSON valido", ""));
    }
  }
  return new Promise((resolve, reject) => {
    let bruto = "";
    req.on("data", (pedaco) => {
      bruto += pedaco;
      if (bruto.length > 64000) {
        reject(new ErroHttp(413, "Corpo grande demais", ""));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!bruto) return resolve({});
      try {
        resolve(JSON.parse(bruto));
      } catch {
        reject(new ErroHttp(400, "Corpo nao e um JSON valido", ""));
      }
    });
    req.on("error", () => reject(new ErroHttp(400, "Falha ao ler o corpo", "")));
  });
}

/* ------------------------------ escrita ------------------------------- */

// Escrita exige um cabecalho proprio, que obriga preflight, e recusa Origin
// de fora. Local isso significa so o navegador na sua maquina; publicado,
// so a propria pagina do deploy.
export function guardaDeEscrita(req) {
  if (req.headers["x-clickup-local"] !== "1") {
    throw new ErroHttp(403, "Escrita exige o cabecalho x-clickup-local: 1", "A propria tela ja manda esse cabecalho.");
  }
  const origem = req.headers.origin;
  if (!origem) return;
  let alvo;
  try {
    alvo = new URL(origem);
  } catch {
    throw new ErroHttp(403, "Origem invalida: " + origem, "");
  }
  const local = /^(localhost|127\.0\.0\.1)$/.test(alvo.hostname);
  const mesmaOrigem = req.headers.host && alvo.host === req.headers.host;
  if (!local && !mesmaOrigem) throw new ErroHttp(403, "Origem nao permitida para escrita: " + origem, "");
}

/* ------------------------------- rotas -------------------------------- */

async function listar(url) {
  const fechadas = url.searchParams.get("closed") === "1";
  const subtarefas = url.searchParams.get("subtasks") !== "0";
  const due = url.searchParams.get("due") || "";
  const espaco = url.searchParams.get("space") || "";
  const busca = (url.searchParams.get("q") || "").toLowerCase().trim();
  const ordem = url.searchParams.get("ordem") || "prazo";
  const atividade = Number(url.searchParams.get("atividade") || 0);
  if (atividade && !ATIVIDADES.includes(atividade)) {
    throw new ErroHttp(400, "Filtro atividade invalido: " + atividade, "Use " + ATIVIDADES.join(" ou ") + ", em dias.");
  }

  const base = await comCache("tasks:" + fechadas + ":" + subtarefas, async () => ({
    usuario: await buscarUsuario(),
    tasks: await buscarTasks({ fechadas, subtarefas }),
    carregadoEm: Date.now(),
  }));

  let tasks = base.tasks;
  if (due) {
    if (!PRAZOS.includes(due)) throw new ErroHttp(400, "Filtro due invalido: " + due, "Use " + PRAZOS.join(", "));
    tasks = tasks.filter((t) => t.prazo === due);
  }
  if (atividade) tasks = tasks.filter((t) => dentroDaAtividade(t, atividade));
  if (espaco) tasks = tasks.filter((t) => t.space === espaco);
  if (busca) {
    tasks = tasks.filter((t) =>
      [t.name, t.list, t.folder, t.space, t.status, t.id, t.customId, t.tags.join(" ")]
        .join(" ").toLowerCase().includes(busca));
  }
  tasks = ordem === "atualizada"
    ? [...tasks].sort((a, b) => (b.updated || 0) - (a.updated || 0))
    : ordenarPorPrazo(tasks);

  return {
    usuario: base.usuario,
    total: tasks.length,
    abertas: tasks.filter((t) => t.statusType !== "closed" && t.statusType !== "done").length,
    prazos: contarPrazos(base.tasks),
    atividade: contarAtividade(base.tasks),
    espacos: [...new Set(base.tasks.map((t) => t.space).filter(Boolean))].sort(),
    somenteLeitura: cfg.somenteLeitura,
    groq: temGroq(),
    carregadoEm: base.carregadoEm,
    cache: base.cache,
    tasks,
  };
}

export async function rotear(req, url) {
  const rota = url.pathname.replace(/\/+$/, "") || "/";
  const metodo = req.method;

  if (metodo === "GET" && rota === "/api/health") {
    return {
      ok: true,
      modulo: "trabalho",
      tokenConfigurado: Boolean(cfg.token) || cfg.mock,
      mock: cfg.mock,
      somenteLeitura: cfg.somenteLeitura,
      ondeRoda: cfg.ondeRoda,
      cacheTtlMs: cfg.cacheMs,
      groq: temGroq(),
      groqModelo: temGroq() ? groq.modelo : "",
      versao: 1,
    };
  }

  if (metodo === "GET" && rota === "/api/me") {
    exigirToken();
    return { usuario: await buscarUsuario(), workspaces: await buscarWorkspaces() };
  }

  if (metodo === "GET" && rota === "/api/tasks") {
    exigirToken();
    return await listar(url);
  }

  if (rota === "/api/plano" && metodo === "POST") {
    exigirToken();
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const ids = [...new Set((corpo.ids || []).map(String).filter(Boolean))];
    if (!ids.length) throw new ErroHttp(400, "Escolha pelo menos uma tarefa", "");
    if (ids.length > 25) throw new ErroHttp(400, "Maximo de 25 tarefas por plano", "Marque menos itens.");

    const lista = await comCache("tasks:false:true", async () => ({
      usuario: await buscarUsuario(),
      tasks: await buscarTasks({ fechadas: false, subtarefas: true }),
      carregadoEm: Date.now(),
    }));
    const porId = new Map(lista.tasks.map((t) => [String(t.id), t]));
    const escolhidas = [];
    for (const id of ids) {
      escolhidas.push(porId.get(id) || await buscarTask(id));
    }

    const plano = await ordenarTarefas(escolhidas);
    log("plano de " + escolhidas.length + " tarefa(s) via " + plano.fonte);
    return {
      ...plano,
      geradoEm: Date.now(),
      tarefas: plano.ordem.map((item, i) => {
        const t = escolhidas.find((x) => String(x.id) === String(item.id)) || {};
        return {
          posicao: i + 1,
          id: item.id,
          motivo: item.motivo,
          name: t.name || item.id,
          url: t.url || "",
          status: t.status || "",
          prazo: t.prazo || "",
          dueDate: t.dueDate || null,
          list: t.list || "",
        };
      }),
    };
  }

  const statuses = rota.match(/^\/api\/tasks\/([^/]+)\/statuses$/);
  if (statuses && metodo === "GET") {
    exigirToken();
    const task = await buscarTask(decodeURIComponent(statuses[1]));
    return { atual: task.status, opcoes: await statusesDaLista(task.listId) };
  }

  const comentario = rota.match(/^\/api\/tasks\/([^/]+)\/comment$/);
  if (comentario && metodo === "POST") {
    exigirToken();
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const id = decodeURIComponent(comentario[1]);
    await comentar(id, corpo.texto);
    log("comentario postado na task " + id);
    return { ok: true, id, acao: "comentario" };
  }

  const status = rota.match(/^\/api\/tasks\/([^/]+)\/status$/);
  if (status && (metodo === "PUT" || metodo === "POST")) {
    exigirToken();
    guardaDeEscrita(req);
    const corpo = await lerCorpo(req);
    const id = decodeURIComponent(status[1]);
    const feito = await mudarStatus(id, corpo.status);
    limparCache();
    log("status da task " + id + " agora e '" + feito.status + "'");
    return { ok: true, id, acao: "status", status: feito.status };
  }

  const detalhe = rota.match(/^\/api\/tasks\/([^/]+)$/);
  if (detalhe && metodo === "GET") {
    exigirToken();
    return await buscarTask(decodeURIComponent(detalhe[1]));
  }

  throw new ErroHttp(404, metodo + " /trabalho" + rota + " nao existe",
    "Rotas: /trabalho/api/health, /me, /tasks, /tasks/:id, /tasks/:id/statuses, /tasks/:id/comment, /tasks/:id/status, /plano");
}

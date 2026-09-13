/**
 * Modulo TRABALHO - nucleo do ClickUp.
 *
 * Este arquivo nao conhece o Segundo Cerebro. Ele so le a configuracao,
 * fala com a API do ClickUp e normaliza tarefas. E de proposito: a pasta
 * modulos/trabalho inteira pode ser zipada e evoluida sozinha.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_MODULO = (() => {
  // na Vercel o arquivo roda empacotado, entao caimos no cwd se nao der
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return process.cwd();
  }
})();

const API = "https://api.clickup.com/api/v2";
const MAX_PAGINAS = 10;

/* --------------------------- configuracao ----------------------------
   O host (Segundo Cerebro) ja chama dotenv e carrega o .env da raiz, entao
   normalmente nao ha nada pra fazer aqui. Este carregador so existe pra
   permitir um .env proprio dentro de modulos/trabalho/ quando voce quiser
   separar as chaves do modulo das chaves do app principal. Ele nunca
   sobrescreve o que ja esta em process.env. */

export function carregarEnvDoModulo(caminho = join(RAIZ_MODULO, ".env")) {
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const corte = limpa.indexOf("=");
    if (corte === -1) continue;
    const chave = limpa.slice(0, corte).trim();
    let valor = limpa.slice(corte + 1).trim();
    if (/^".*"$/.test(valor) || /^'.*'$/.test(valor)) valor = valor.slice(1, -1);
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

carregarEnvDoModulo();

const NA_VERCEL = Boolean(process.env.VERCEL);

export const cfg = {
  token: (process.env.CLICKUP_API_TOKEN || "").trim(),
  teamId: (process.env.CLICKUP_TEAM_ID || "").trim(),
  cacheMs: Number(process.env.CACHE_TTL_MS || 60000),
  mock: process.env.MOCK === "1",
  somenteLeitura: process.env.READ_ONLY === "1",
  ondeRoda: NA_VERCEL ? "vercel" : "local",
};

export class ErroHttp extends Error {
  constructor(status, mensagem, dica) {
    super(mensagem);
    this.status = status;
    this.dica = dica || "";
  }
}

export function exigirToken() {
  if (cfg.mock) return;
  if (!cfg.token) {
    throw new ErroHttp(
      500,
      "CLICKUP_API_TOKEN nao esta definido",
      "Adicione CLICKUP_API_TOKEN no .env do Segundo Cerebro (ou no painel da Vercel) e suba de novo.",
    );
  }
}

export function exigirEscrita() {
  if (cfg.somenteLeitura) {
    throw new ErroHttp(403, "Modo somente leitura", "Tire READ_ONLY=1 do .env para comentar e mudar status.");
  }
}

/* ----------------------------- ClickUp ------------------------------- */

export async function cu(caminho, { metodo = "GET", corpo = null } = {}) {
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: { Authorization: cfg.token, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { raw: texto };
  }
  if (res.ok) return dados;

  const detalhe = dados?.err || dados?.ECODE || "HTTP " + res.status;
  if (res.status === 401) throw new ErroHttp(401, "Token recusado pelo ClickUp: " + detalhe, "Gere outro em Settings, Apps, API Token.");
  if (res.status === 403) throw new ErroHttp(403, "Sem permissao no ClickUp: " + detalhe, "");
  if (res.status === 404) throw new ErroHttp(404, "Nao encontrado no ClickUp: " + detalhe, "");
  if (res.status === 429) throw new ErroHttp(429, "Limite de requisicoes do ClickUp atingido", "Espere um minuto e tente de novo.");
  throw new ErroHttp(502, "O ClickUp respondeu com erro: " + detalhe, "");
}

/* ------------------------------ prazos ------------------------------- */

export function classificarPrazo(dueDate, agora = Date.now()) {
  if (!dueDate) return "sem-prazo";
  const inicioDeHoje = new Date(agora).setHours(0, 0, 0, 0);
  const fimDeHoje = new Date(agora).setHours(23, 59, 59, 999);
  const fimDaSemana = new Date(fimDeHoje + 6 * 86400000).getTime();
  if (dueDate < inicioDeHoje) return "vencida";
  if (dueDate <= fimDeHoje) return "hoje";
  if (dueDate <= fimDaSemana) return "semana";
  return "depois";
}

export const PRAZOS = ["vencida", "hoje", "semana", "depois", "sem-prazo"];

export function contarPrazos(tasks) {
  const contagem = Object.fromEntries(PRAZOS.map((p) => [p, 0]));
  for (const t of tasks) contagem[t.prazo] = (contagem[t.prazo] || 0) + 1;
  return contagem;
}

export function ordenarPorPrazo(tasks) {
  const peso = { vencida: 0, hoje: 1, semana: 2, depois: 3, "sem-prazo": 4 };
  return [...tasks].sort((a, b) => {
    const d = peso[a.prazo] - peso[b.prazo];
    if (d !== 0) return d;
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    return (b.updated || 0) - (a.updated || 0);
  });
}

/* ---------------------------- atividade ------------------------------ */

export const ATIVIDADES = [7, 30];

export function dentroDaAtividade(task, dias, agora = Date.now()) {
  if (!dias) return true;
  const referencia = task.updated || task.created || 0;
  return referencia >= agora - dias * 86400000;
}

export function contarAtividade(tasks, agora = Date.now()) {
  const contagem = { todas: tasks.length };
  for (const dias of ATIVIDADES) {
    contagem["d" + dias] = tasks.filter((t) => dentroDaAtividade(t, dias, agora)).length;
  }
  return contagem;
}

/* ---------------------------- normalizacao --------------------------- */

export function limparTask(t, workspace = "") {
  const dueDate = t.due_date ? Number(t.due_date) : null;
  return {
    id: t.id,
    customId: t.custom_id || "",
    name: t.name || "(sem titulo)",
    url: t.url || "",
    status: t.status?.status || "sem status",
    statusType: t.status?.type || "",
    statusColor: t.status?.color || "#8B90A0",
    priority: t.priority?.priority || "",
    dueDate,
    prazo: classificarPrazo(dueDate),
    updated: t.date_updated ? Number(t.date_updated) : null,
    created: t.date_created ? Number(t.date_created) : null,
    list: t.list?.name || "",
    listId: t.list?.id || "",
    folder: t.folder?.hidden ? "" : t.folder?.name || "",
    space: t.space?.name || t.space?.id || "",
    workspace,
    tags: (t.tags || []).map((tag) => tag.name),
    subtarefa: Boolean(t.parent),
    assignees: (t.assignees || []).map((a) => a.username || a.email || ""),
    description: t.description || t.text_content || "",
  };
}

/* ------------------------------ leitura ------------------------------ */

export async function buscarUsuario() {
  if (cfg.mock) return mock.usuario;
  const u = (await cu("/user"))?.user;
  if (!u?.id) throw new ErroHttp(502, "O ClickUp nao retornou o usuario do token", "");
  return { id: u.id, nome: u.username || "", email: u.email || "", iniciais: u.initials || "" };
}

export async function buscarWorkspaces() {
  if (cfg.mock) return mock.workspaces;
  const times = ((await cu("/team"))?.teams || []).map((t) => ({ id: String(t.id), nome: t.name || "" }));
  if (!times.length) throw new ErroHttp(403, "O token nao tem acesso a nenhum workspace", "");
  return cfg.teamId ? times.filter((t) => t.id === cfg.teamId) : times;
}

export async function buscarTasks({ fechadas = false, subtarefas = true } = {}) {
  if (cfg.mock) {
    return mock.tasks
      .filter((t) => fechadas || (t.statusType !== "closed" && t.statusType !== "done"))
      .filter((t) => subtarefas || !t.subtarefa)
      .map((t) => ({ ...t, prazo: classificarPrazo(t.dueDate) }));
  }

  const usuario = await buscarUsuario();
  const workspaces = await buscarWorkspaces();
  const tasks = [];
  const vistos = new Set();

  for (const ws of workspaces) {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const qs = new URLSearchParams({
        "assignees[]": String(usuario.id),
        include_closed: fechadas ? "true" : "false",
        subtasks: subtarefas ? "true" : "false",
        order_by: "updated",
        page: String(pagina),
      });
      const dados = await cu("/team/" + ws.id + "/task?" + qs.toString());
      const lote = dados?.tasks || [];
      for (const t of lote) {
        if (vistos.has(t.id)) continue;
        vistos.add(t.id);
        tasks.push(limparTask(t, ws.nome));
      }
      if (!lote.length || dados?.last_page) break;
    }
  }
  return tasks;
}

export async function buscarTask(id) {
  if (cfg.mock) {
    const t = mock.tasks.find((x) => x.id === id);
    if (!t) throw new ErroHttp(404, "Tarefa " + id + " nao encontrada", "");
    return { ...t, prazo: classificarPrazo(t.dueDate), subtasks: [], comentarios: mock.comentarios[id] || [] };
  }
  const bruta = await cu("/task/" + encodeURIComponent(id) + "?include_markdown_description=true");
  const task = limparTask(bruta);
  task.description = bruta.markdown_description || bruta.description || bruta.text_content || "";
  task.subtasks = (bruta.subtasks || []).map((s) => ({
    id: s.id,
    name: s.name,
    status: s.status?.status || "",
    fechada: s.status?.type === "closed" || s.status?.type === "done",
  }));
  return task;
}

export async function statusesDaLista(listId) {
  if (!listId) return [];
  if (cfg.mock) return mock.statuses;
  const lista = await cu("/list/" + encodeURIComponent(listId));
  return (lista?.statuses || []).map((s) => ({ nome: s.status, cor: s.color || "#8B90A0", tipo: s.type || "" }));
}

/* ------------------------------ escrita ------------------------------ */

export async function comentar(id, texto) {
  exigirEscrita();
  const limpo = String(texto || "").trim();
  if (!limpo) throw new ErroHttp(400, "O comentario esta vazio", "");
  if (limpo.length > 8000) throw new ErroHttp(400, "Comentario longo demais, maximo 8000 caracteres", "");
  if (cfg.mock) {
    mock.comentarios[id] = [...(mock.comentarios[id] || []), { texto: limpo, em: Date.now() }];
    return { id: "mock-" + Date.now() };
  }
  return cu("/task/" + encodeURIComponent(id) + "/comment", {
    metodo: "POST",
    corpo: { comment_text: limpo, notify_all: false },
  });
}

export async function mudarStatus(id, statusPedido) {
  exigirEscrita();
  const pedido = String(statusPedido || "").trim();
  if (!pedido) throw new ErroHttp(400, "Informe o status de destino", "");

  const task = await buscarTask(id);
  const opcoes = await statusesDaLista(task.listId);
  const casou = opcoes.find((s) => s.nome.toLowerCase() === pedido.toLowerCase());
  if (opcoes.length && !casou) {
    throw new ErroHttp(400, "A lista dessa tarefa nao tem o status '" + pedido + "'",
      "Status validos: " + opcoes.map((s) => s.nome).join(", "));
  }
  const nomeExato = casou ? casou.nome : pedido;

  if (cfg.mock) {
    const t = mock.tasks.find((x) => x.id === id);
    if (t) {
      t.status = nomeExato;
      t.statusColor = casou?.cor || t.statusColor;
      t.updated = Date.now();
    }
    return { status: nomeExato };
  }
  await cu("/task/" + encodeURIComponent(id), { metodo: "PUT", corpo: { status: nomeExato } });
  return { status: nomeExato };
}

/* -------------------------- dados de exemplo -------------------------- */

const dia = 86400000;

export const mock = {
  usuario: { id: 1, nome: "Voce", email: "voce@exemplo.com", iniciais: "V" },
  workspaces: [{ id: "90133024554", nome: "Workspace de exemplo" }],
  statuses: [
    { nome: "aberto", cor: "#8B90A0", tipo: "open" },
    { nome: "em progresso", cor: "#5B9FD6", tipo: "custom" },
    { nome: "em revisao", cor: "#E5A100", tipo: "custom" },
    { nome: "concluido", cor: "#4CAF50", tipo: "done" },
  ],
  comentarios: {},
  tasks: [
    {
      id: "86ak74kz7", customId: "", name: "Cota de brinde por CPF no totem",
      url: "https://app.clickup.com/t/90133024554/86ak74kz7", status: "em progresso", statusType: "custom",
      statusColor: "#5B9FD6", priority: "high", dueDate: Date.now() - 2 * dia, updated: Date.now() - 3600000,
      created: Date.now() - 12 * dia, list: "Sprint 12", listId: "1", folder: "Gift Catcher",
      space: "Produtos", workspace: "Workspace de exemplo", tags: ["backend"], subtarefa: false,
      assignees: ["Voce", "Pedro"],
      description: "## Regra\nLimitar **um brinde por CPF** por ativacao.\n\n- Validar no `POST /resgate`\n- Contador em Redis com TTL do evento",
    },
    {
      id: "86ak74kz8", customId: "DEV-12", name: "Totem precisa funcionar offline", url: "",
      status: "aberto", statusType: "open", statusColor: "#8B90A0", priority: "urgent",
      dueDate: Date.now() + 3600000, updated: Date.now() - 9 * dia, created: Date.now() - 30 * dia,
      list: "Backlog", listId: "2", folder: "", space: "Clientes", workspace: "Workspace de exemplo",
      tags: ["kiosk"], subtarefa: true, assignees: ["Voce"], description: "",
    },
    {
      id: "86ak74kz9", customId: "", name: "Revisar copy da tela de agradecimento", url: "",
      status: "em revisao", statusType: "custom", statusColor: "#E5A100", priority: "normal",
      dueDate: Date.now() + 3 * dia, updated: Date.now() - 2 * dia, created: Date.now() - 5 * dia,
      list: "Sprint 12", listId: "1", folder: "Gift Catcher", space: "Produtos",
      workspace: "Workspace de exemplo", tags: [], subtarefa: false, assignees: ["Voce"],
      description: "Texto atual esta generico demais. Ver referencia em https://exemplo.com/copy",
    },
    {
      id: "86ak74kza", customId: "", name: "Migrar cron de relatorio para o k3s", url: "",
      status: "aberto", statusType: "open", statusColor: "#8B90A0", priority: "",
      dueDate: null, updated: Date.now() - 21 * dia, created: Date.now() - 60 * dia,
      list: "Infra", listId: "3", folder: "", space: "Produtos", workspace: "Workspace de exemplo",
      tags: ["infra"], subtarefa: false, assignees: ["Voce"], description: "",
    },
  ],
};


/* ------------------------- comentarios e daily -------------------------
   A API v2 do ClickUp nao tem endpoint de "meus comentarios". Comentario so
   existe por tarefa. Entao o caminho e: descobrir as tarefas que mexeram na
   janela, buscar os comentarios de cada uma e filtrar pelo dono do token.

   Custo: uma requisicao por tarefa. Por isso o teto de tarefas e o lote
   pequeno; o limite do ClickUp e 100 requisicoes por minuto. */

export const MAX_TASKS_DAILY = 40;
const LOTE_COMENTARIOS = 4;

/** Tarefas minhas que mudaram desde `desde`, fechadas incluidas.
    Fechadas entram de proposito: tarefa que eu comentei e conclui ontem e
    justamente o que a daily precisa contar. */
export async function buscarTasksAtualizadasDesde(desde, { max = MAX_TASKS_DAILY } = {}) {
  if (cfg.mock) {
    return mock.tasks
      .filter((t) => (t.updated || 0) >= desde)
      .map((t) => ({ ...t, prazo: classificarPrazo(t.dueDate) }))
      .slice(0, max);
  }

  const usuario = await buscarUsuario();
  const workspaces = await buscarWorkspaces();
  const tasks = [];
  const vistos = new Set();

  for (const ws of workspaces) {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const qs = new URLSearchParams({
        "assignees[]": String(usuario.id),
        include_closed: "true",
        subtasks: "true",
        order_by: "updated",
        date_updated_gt: String(desde),
        page: String(pagina),
      });
      const dados = await cu("/team/" + ws.id + "/task?" + qs.toString());
      const lote = dados?.tasks || [];
      for (const t of lote) {
        if (vistos.has(t.id)) continue;
        vistos.add(t.id);
        tasks.push(limparTask(t, ws.nome));
      }
      if (!lote.length || dados?.last_page || tasks.length >= max) break;
    }
    if (tasks.length >= max) break;
  }
  return tasks.slice(0, max);
}

/** Comentarios de uma tarefa, ja normalizados. Pagina unica, os mais recentes. */
export async function buscarComentariosDaTask(id) {
  if (cfg.mock) {
    return (mock.comentarios[id] || []).map((c, i) => ({
      id: "mock-" + id + "-" + i,
      texto: c.texto,
      em: c.em,
      userId: mock.usuario.id,
      userNome: mock.usuario.nome,
    }));
  }
  const dados = await cu("/task/" + encodeURIComponent(id) + "/comment");
  return (dados?.comments || []).map((c) => ({
    id: String(c.id || ""),
    // comment_text vem pronto; o array comment e o formato em blocos
    texto: c.comment_text || (Array.isArray(c.comment) ? c.comment.map((p) => p.text || "").join("") : ""),
    em: Number(c.date || 0),
    userId: c.user?.id ?? null,
    userNome: c.user?.username || c.user?.email || "",
  }));
}

/**
 * Meus comentarios na janela, ja com o contexto da tarefa junto.
 * `extras` serve de rede: se o date_updated de alguma tarefa nao tiver mexido
 * com o comentario, quem chama passa as tarefas abertas que ja tem em cache e
 * elas entram na varredura do mesmo jeito.
 */
export async function coletarMeusComentarios({ horas = 48, extras = [], max = MAX_TASKS_DAILY } = {}) {
  const corte = Date.now() - horas * 3600000;
  const usuario = await buscarUsuario();

  const candidatas = await buscarTasksAtualizadasDesde(corte, { max });
  const porId = new Map(candidatas.map((t) => [String(t.id), t]));
  for (const t of extras) {
    if (porId.size >= max) break;
    if (!porId.has(String(t.id))) porId.set(String(t.id), t);
  }

  const lista = [...porId.values()];
  const comentarios = [];
  let falhas = 0;

  for (let i = 0; i < lista.length; i += LOTE_COMENTARIOS) {
    const lote = lista.slice(i, i + LOTE_COMENTARIOS);
    const respostas = await Promise.all(lote.map(async (t) => {
      try {
        return { t, cs: await buscarComentariosDaTask(t.id) };
      } catch {
        falhas++;  // tarefa sem permissao ou erro pontual nao derruba a daily
        return { t, cs: [] };
      }
    }));
    for (const { t, cs } of respostas) {
      for (const c of cs) {
        if (c.em < corte) continue;
        if (String(c.userId) !== String(usuario.id)) continue;
        const texto = String(c.texto || "").trim();
        if (!texto) continue;
        comentarios.push({
          taskId: t.id,
          taskName: t.name,
          list: t.list || "",
          status: t.status || "",
          url: t.url || "",
          texto,
          em: c.em,
        });
      }
    }
  }

  comentarios.sort((a, b) => a.em - b.em);  // ordem cronologica, a daily le melhor
  return { usuario, corte, comentarios, tarefasVarridas: lista.length, falhas };
}

/* Comentarios de exemplo pro modo MOCK, senao a daily sobe vazia. */
if (cfg.mock && !Object.keys(mock.comentarios).length) {
  const agora = Date.now();
  mock.comentarios["86ak74kz7"] = [
    { texto: "Contador de CPF em Redis funcionando, TTL amarrado na data do evento.", em: agora - 30 * 3600000 },
    { texto: "Falta cobrir o caso de resgate duplicado quando o totem perde a rede no meio.", em: agora - 5 * 3600000 },
  ];
  mock.comentarios["86ak74kz9"] = [
    { texto: "Copy nova escrita, mandei pra revisao da Clara.", em: agora - 20 * 3600000 },
  ];
}

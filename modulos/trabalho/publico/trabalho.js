/* Modulo TRABALHO - tela.
   Mesma gramatica visual e mesmos padroes do app.js do Segundo Cerebro:
   um estado, um render, delegacao de evento no documento, sheet pros
   detalhes e toast pros avisos. Nada aqui toca o app principal. */

var BASE = "/trabalho/api";

/* ============================================================
   Estado
   ============================================================ */
var S = {
  tasks: [], prazos: {}, atividade: {}, usuario: null,
  filtroPrazo: "", periodo: 0, fechadas: false, subtarefas: true,
  agrupar: "prazo", busca: "",
  selecionadas: new Set(), visiveis: [],
  detalhes: new Map(), somenteLeitura: false, temGroq: false,
  carregando: true, carregadoEm: 0, doCache: false, erro: null,
  dailyHoras: 48, dailyUltima: null,
};

var $ = function (s) { return document.querySelector(s); };

var esc = function (s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

/* ============================================================
   Vocabulario
   ============================================================ */
var PRAZOS = [
  { chave: "", rotulo: "Todas" },
  { chave: "vencida", rotulo: "Vencidas", perigo: true },
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "semana", rotulo: "7 dias" },
  { chave: "depois", rotulo: "Adiante" },
  { chave: "sem-prazo", rotulo: "Sem prazo" },
];
var NOME_PRAZO = {
  vencida: "Vencidas", hoje: "Vencem hoje", semana: "Próximos 7 dias",
  depois: "Mais adiante", "sem-prazo": "Sem prazo",
};
/* Cores do prazo saem dos tokens do app, entao acompanham o tema. */
var COR_PRAZO = {
  vencida: "var(--perigo)", hoje: "var(--alerta)", semana: "var(--acento)",
  depois: "var(--texto-3)", "sem-prazo": "var(--separador)",
};
var PERIODOS = [
  { chave: 0, rotulo: "Qualquer data", conta: "todas" },
  { chave: 7, rotulo: "Últimos 7 dias", conta: "d7" },
  { chave: 30, rotulo: "Últimos 30 dias", conta: "d30" },
];

/* ============================================================
   Rede
   ============================================================ */
function api(caminho, opcoes) {
  opcoes = opcoes || {};
  var cabecalhos = { "Content-Type": "application/json", "x-clickup-local": "1" };
  for (var k in (opcoes.headers || {})) cabecalhos[k] = opcoes.headers[k];
  return fetch(BASE + caminho, Object.assign({}, opcoes, { headers: cabecalhos })).then(function (res) {
    return res.json().catch(function () { return { erro: "Resposta ilegível do servidor" }; })
      .then(function (dados) {
        if (!res.ok) {
          var e = new Error(dados.erro || "Falhou");
          e.dica = dados.dica || "";
          throw e;
        }
        return dados;
      });
  });
}

/* ============================================================
   Utilidades
   ============================================================ */
function dataCurta(ms) {
  var d = new Date(ms);
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
}
function desdeQuando(ms) {
  if (!ms) return "";
  var dias = Math.floor((Date.now() - ms) / 86400000);
  if (dias <= 0) return "mexida hoje";
  if (dias === 1) return "mexida ontem";
  if (dias < 30) return "mexida há " + dias + " dias";
  var meses = Math.floor(dias / 30);
  return "parada há " + meses + (meses === 1 ? " mês" : " meses");
}
function hora(ms) {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
/* Markdown minimo, so o que aparece em descricao de tarefa do ClickUp. */
function markdown(texto) {
  var html = esc(texto);
  html = html.replace(/```([\s\S]*?)```/g, function (m, c) { return "<code>" + c.trim() + "</code>"; });
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>");
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return html;
}
function corHex(c) { return /^#[0-9a-f]{6}$/i.test(c || "") ? c : "#8B90A0"; }

var toastTimer = null;
function toast(msg) {
  var t = $("#toast");
  t.textContent = msg;
  t.classList.add("visivel");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove("visivel"); }, 2600);
}

/* Copia com reserva.
   navigator.clipboard so existe em contexto seguro, https ou localhost. Aberto
   pelo celular no IP da maquina o objeto nem existe, e a chamada morria calada.
   Entao: tenta a API moderna, cai no execCommand, e em qualquer caso avisa. */
function copiar(texto, aviso) {
  function reserva() {
    var area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);  // iOS ignora select() sozinho
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    toast(ok ? aviso : "Nao consegui copiar aqui. Abra por https ou localhost.");
    return ok;
  }
  if (!navigator.clipboard || !navigator.clipboard.writeText) return reserva();
  navigator.clipboard.writeText(texto)
    .then(function () { toast(aviso); })
    .catch(reserva);
}

/* ============================================================
   Sheet
   ============================================================ */
function abrirSheet(titulo, html) {
  $("#sheetTitulo").textContent = titulo;
  $("#sheetCorpo").innerHTML = html;
  $("#sheet").classList.add("aberto");
  $("#cortina").classList.add("aberta");
}
function fecharSheet() {
  $("#sheet").classList.remove("aberto");
  $("#cortina").classList.remove("aberta");
}
$("#btnFechaSheet").addEventListener("click", fecharSheet);
$("#cortina").addEventListener("click", fecharSheet);
document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") fecharSheet();
  if (ev.key === "/" && ["INPUT", "TEXTAREA"].indexOf(document.activeElement.tagName) === -1) {
    ev.preventDefault();
    $("#campoBusca").focus();
  }
});

/* ============================================================
   Filtros
   ============================================================ */
function chip(rotulo, ativo, atributo, valor, extra, n) {
  return '<button class="chip' + (ativo ? " ativo" : "") + (extra ? " " + extra : "") +
    '" ' + atributo + '="' + esc(valor) + '">' + esc(rotulo) +
    (n == null ? "" : '<span class="n">' + n + "</span>") + "</button>";
}

var CHECK = '<svg class="marca" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

function renderFiltros() {
  if (S.erro) { $("#filtros").innerHTML = ""; return; }

  var total = 0;
  for (var k in S.prazos) total += S.prazos[k];

  var linhaPrazo = PRAZOS.map(function (p) {
    var n = p.chave ? (S.prazos[p.chave] || 0) : total;
    return chip(p.rotulo, S.filtroPrazo === p.chave, "data-prazo", p.chave, p.perigo ? "perigo" : "", n);
  }).join("");

  var linhaPeriodo = PERIODOS.map(function (p) {
    return chip(p.rotulo, S.periodo === p.chave, "data-periodo", String(p.chave), "", S.atividade[p.conta] == null ? 0 : S.atividade[p.conta]);
  }).join("");

  var linhaOpcoes =
    '<button class="chip' + (S.fechadas ? " ativo" : "") + '" data-liga="fechadas">' +
      (S.fechadas ? CHECK : "") + "Concluídas</button>" +
    '<button class="chip' + (S.subtarefas ? " ativo" : "") + '" data-liga="subtarefas">' +
      (S.subtarefas ? CHECK : "") + "Subtarefas</button>" +
    '<button class="chip" data-marcar-visiveis="1">Marcar visíveis</button>';

  $("#filtros").innerHTML =
    '<p class="tr-rot-filtro">Prazo</p>' +
    '<div class="faixa-chips"><div class="chips">' + linhaPrazo + "</div></div>" +
    '<p class="tr-rot-filtro">Última mexida</p>' +
    '<div class="faixa-chips"><div class="chips">' + linhaPeriodo + "</div></div>" +
    '<p class="tr-rot-filtro">Mostrar</p>' +
    '<div class="faixa-chips"><div class="chips">' + linhaOpcoes + "</div></div>";
}

/* ============================================================
   Lista
   ============================================================ */
function chaveGrupo(t) {
  if (S.agrupar === "prazo") return NOME_PRAZO[t.prazo] || t.prazo;
  if (S.agrupar === "status") return t.status;
  if (S.agrupar === "space") return t.space || "Sem espaço";
  return t.list || "Sem lista";
}
function corGrupo(t) {
  if (S.agrupar === "prazo") return COR_PRAZO[t.prazo] || "var(--separador)";
  if (S.agrupar === "status") return corHex(t.statusColor);
  return "var(--acento)";
}

function selosDaTarefa(t) {
  var cor = corHex(t.statusColor);
  var selos = ['<span class="selo-tipo" style="color:' + cor + ';background:' + cor + '22">' + esc(t.status) + "</span>"];
  if (t.dueDate) {
    var classe = t.prazo === "vencida" ? " vencida" : t.prazo === "hoje" ? " hoje" : "";
    var verbo = t.prazo === "vencida" ? "venceu" : "vence";
    selos.push('<span class="selo-prazo' + classe + '">' + verbo + " " + dataCurta(t.dueDate) + "</span>");
  }
  if (t.priority === "urgent" || t.priority === "high") {
    selos.push('<span class="selo-prazo prio">' + esc(t.priority) + "</span>");
  }
  return selos.join("");
}

function cartao(t) {
  var caminho = [t.space, t.folder, t.list].filter(Boolean)
    .map(function (p) { return "<span>" + esc(p) + "</span>"; }).join("");
  if (t.subtarefa) caminho += "<span>subtarefa</span>";

  var pe = [];
  t.tags.slice(0, 3).forEach(function (tag) { pe.push('<span class="tag">' + esc(tag) + "</span>"); });
  if (t.updated) pe.push("<span>" + esc(desdeQuando(t.updated)) + "</span>");

  var marcada = S.selecionadas.has(t.id);
  return '<div class="nota tr-tarefa' + (marcada ? " marcada" : "") + '" style="--cor-area:' + corGrupo(t) + '">' +
    '<button class="tr-marcar" data-sel="' + esc(t.id) + '" aria-pressed="' + marcada + '" aria-label="Selecionar para a ordem de execução">' + CHECK + "</button>" +
    '<button class="tr-corpo" data-abrir="' + esc(t.id) + '">' +
      '<p class="tr-titulo">' + esc(t.name) + "</p>" +
      (caminho ? '<p class="tr-caminho">' + caminho + "</p>" : "") +
      '<div class="tr-selos">' + selosDaTarefa(t) + "</div>" +
      (pe.length ? '<div class="tr-pe">' + pe.join("") + "</div>" : "") +
    "</button>" +
  "</div>";
}

function esqueletos() {
  var um = '<div class="esqueleto"><div class="linha"></div><div class="linha"></div><div class="linha"></div></div>';
  return '<div class="lista">' + um + um + um + um + "</div>";
}

function filtradas() {
  var termo = S.busca.toLowerCase().trim();
  if (!termo) return S.tasks;
  return S.tasks.filter(function (t) {
    return [t.name, t.list, t.folder, t.space, t.status, t.id, t.customId, t.tags.join(" ")]
      .join(" ").toLowerCase().indexOf(termo) !== -1;
  });
}

function render() {
  atualizarResumo();
  renderFiltros();
  var alvo = $("#conteudo");

  if (S.erro) {
    alvo.innerHTML = '<div class="tr-aviso"><strong>' + esc(S.erro.message) + "</strong>" +
      "<p>" + esc(S.erro.dica || "Confira o CLICKUP_API_TOKEN e tente atualizar.") + "</p></div>";
    S.visiveis = [];
    return pintarBarraSel();
  }
  if (S.carregando) { alvo.innerHTML = esqueletos(); return; }

  var tasks = filtradas();
  S.visiveis = tasks.map(function (t) { return t.id; });

  if (!tasks.length) {
    alvo.innerHTML = '<div class="vazio"><span class="emoji">🗂️</span>' +
      "<h3>Nada por aqui</h3><p>Nenhuma tarefa bate com esse filtro.</p></div>";
    return pintarBarraSel();
  }

  var grupos = new Map();
  tasks.forEach(function (t) {
    var k = chaveGrupo(t);
    if (!grupos.has(k)) grupos.set(k, { cor: corGrupo(t), itens: [] });
    grupos.get(k).itens.push(t);
  });

  var html = "";
  grupos.forEach(function (g, nome) {
    html += '<section class="tr-grupo">' +
      '<div class="tr-grupo-rot"><span class="bolinha" style="background:' + g.cor + '"></span>' +
        esc(nome) + '<span class="conta">' + g.itens.length + "</span></div>" +
      '<div class="lista">' + g.itens.map(cartao).join("") + "</div>" +
    "</section>";
  });
  alvo.innerHTML = html;

  // anima so quando a vista muda de verdade, senao filtrar faz tudo re-animar
  var chave = [S.agrupar, S.busca, S.filtroPrazo, S.periodo, S.fechadas, S.subtarefas].join("|");
  if (chave !== render._vista) {
    render._vista = chave;
    alvo.querySelectorAll(".lista").forEach(function (l) { l.classList.add("animar"); });
    setTimeout(function () {
      alvo.querySelectorAll(".lista.animar").forEach(function (l) { l.classList.remove("animar"); });
    }, 400);
  }
  pintarBarraSel();
}

function atualizarResumo() {
  var alvo = $("#resumoTopo");
  if (S.erro) return (alvo.textContent = "Não consegui falar com o ClickUp.");
  if (S.carregando) return (alvo.textContent = "Carregando…");
  var vencidas = S.prazos.vencida || 0;
  var hoje = S.prazos.hoje || 0;
  var quem = S.usuario && S.usuario.nome ? S.usuario.nome + " · " : "";
  alvo.textContent = quem + S.tasks.length + " tarefa(s), " + vencidas + " vencida(s), " +
    hoje + " para hoje · " + hora(S.carregadoEm) + (S.doCache ? " (cache)" : "");
}

/* ============================================================
   Selecao
   ============================================================ */
function pintarBarraSel() {
  var n = S.selecionadas.size;
  $("#barraPlano").hidden = n === 0;
  $("#contagemSel").textContent = n === 1 ? "1 selecionada" : n + " selecionadas";
}

/* ============================================================
   Detalhe da tarefa
   ============================================================ */
function corpoDetalhe(id) {
  var t = null;
  S.tasks.forEach(function (x) { if (x.id === id) t = x; });
  if (!t) return "";
  var d = S.detalhes.get(id);
  var texto = String((d && d.description) || t.description || "").trim();

  var blocos = "";

  blocos += '<div class="grupo"><div class="detalhe-bloco">' +
    '<p class="detalhe-rot">Onde vive</p>' +
    '<p class="detalhe-txt">' + esc([t.space, t.folder, t.list].filter(Boolean).join(" › ") || "sem lista") + "</p>" +
    '</div><div class="detalhe-bloco">' +
    '<p class="detalhe-rot">Situação</p>' +
    '<div class="tr-selos">' + selosDaTarefa(t) +
      (t.assignees.length > 1 ? '<span class="tag">com ' + esc(t.assignees.join(", ")) + "</span>" : "") +
      (t.updated ? '<span class="tag">' + esc(desdeQuando(t.updated)) + "</span>" : "") +
    "</div></div>" +
    '<div class="detalhe-bloco"><p class="detalhe-rot">Descrição</p>' +
      (texto ? '<div class="tr-desc">' + markdown(texto) + "</div>"
             : '<p class="tr-desc tr-vazio-txt">' + (d ? "Essa tarefa não tem descrição." : "Buscando descrição…") + "</p>") +
    "</div>" +
    (d && d.subtasks && d.subtasks.length
      ? '<div class="detalhe-bloco"><p class="detalhe-rot">Subtarefas</p><ul class="tr-filhas">' +
        d.subtasks.map(function (s) { return '<li class="' + (s.fechada ? "feita" : "") + '">' + esc(s.name) + "</li>"; }).join("") +
        "</ul></div>"
      : "") +
  "</div>";

  blocos += '<div class="tr-acoes">' +
    '<button class="btn btn-suave" data-copiar="' + esc(id) + '">Copiar [CU-' + esc(id) + "]</button>" +
    (t.url ? '<a class="btn btn-suave" href="' + esc(t.url) + '" target="_blank" rel="noopener">Abrir no ClickUp</a>' : "") +
  "</div>";

  if (S.somenteLeitura) {
    blocos += '<p class="tr-recado">Modo somente leitura. Tire READ_ONLY=1 do .env para comentar e mudar status por aqui.</p>';
  } else {
    var opcoes = (d && d.statuses && d.statuses.opcoes) || [];
    blocos += '<div style="margin-top:16px">' +
      '<p class="detalhe-rot">Agir na tarefa</p>' +
      '<textarea class="campo" id="txt-' + esc(id) + '" placeholder="Escrever um comentário na tarefa"></textarea>' +
      '<div class="tr-linha-acao">' +
        '<button class="btn" data-comentar="' + esc(id) + '">Comentar</button>' +
        (opcoes.length
          ? '<select class="campo" id="st-' + esc(id) + '" aria-label="Novo status">' +
            opcoes.map(function (s) {
              return '<option value="' + esc(s.nome) + '"' + (s.nome === t.status ? " selected" : "") + ">" + esc(s.nome) + "</option>";
            }).join("") + "</select>" +
            '<button class="btn btn-suave" data-status="' + esc(id) + '">Mudar status</button>'
          : "") +
      "</div>" +
      '<p class="tr-recado" id="recado-' + esc(id) + '"></p>' +
    "</div>";
  }

  blocos += '<div style="height:12px"></div>';
  return blocos;
}

function abrirTarefa(id) {
  var t = null;
  S.tasks.forEach(function (x) { if (x.id === id) t = x; });
  if (!t) return;
  abrirSheet(t.name, corpoDetalhe(id));

  if (S.detalhes.has(id)) return;
  api("/tasks/" + encodeURIComponent(id)).then(function (detalhe) {
    if (S.somenteLeitura) return detalhe;
    return api("/tasks/" + encodeURIComponent(id) + "/statuses")
      .then(function (st) { detalhe.statuses = st; return detalhe; })
      .catch(function () { return detalhe; });
  }).then(function (detalhe) {
    S.detalhes.set(id, detalhe);
    // so repinta se o sheet ainda esta nessa tarefa
    if ($("#sheet").classList.contains("aberto") && $("#sheetTitulo").textContent === t.name) {
      $("#sheetCorpo").innerHTML = corpoDetalhe(id);
    }
  }).catch(function () { /* fica com a descricao curta que veio na listagem */ });
}

function recado(id, texto, tipo) {
  var alvo = document.getElementById("recado-" + id);
  if (!alvo) return;
  alvo.textContent = texto;
  alvo.className = "tr-recado" + (tipo ? " " + tipo : "");
}

function enviarComentario(id, botao) {
  var campo = document.getElementById("txt-" + id);
  var texto = (campo.value || "").trim();
  if (!texto) return recado(id, "Escreva alguma coisa antes.", "ruim");
  botao.disabled = true;
  recado(id, "Enviando…");
  api("/tasks/" + encodeURIComponent(id) + "/comment", { method: "POST", body: JSON.stringify({ texto: texto }) })
    .then(function () {
      campo.value = "";
      recado(id, "Comentário postado no ClickUp.", "bom");
      toast("Comentário postado");
    })
    .catch(function (e) { recado(id, e.message + (e.dica ? " " + e.dica : ""), "ruim"); })
    .then(function () { botao.disabled = false; });
}

function enviarStatus(id, botao) {
  var escolha = document.getElementById("st-" + id);
  if (!escolha) return;
  var status = escolha.value;
  botao.disabled = true;
  recado(id, "Mudando…");
  api("/tasks/" + encodeURIComponent(id) + "/status", { method: "PUT", body: JSON.stringify({ status: status }) })
    .then(function (r) {
      S.tasks.forEach(function (x) { if (x.id === id) x.status = r.status; });
      S.detalhes.delete(id);
      toast("Status agora é " + r.status);
      return carregar();
    })
    .then(function () {
      // a listagem voltou com o status novo; repinta o sheet pro selo bater
      if ($("#sheet").classList.contains("aberto")) $("#sheetCorpo").innerHTML = corpoDetalhe(id);
      recado(id, "Status atualizado.", "bom");
    })
    .catch(function (e) { recado(id, e.message + (e.dica ? " " + e.dica : ""), "ruim"); })
    .then(function () { botao.disabled = false; });
}

/* ============================================================
   Ordem de execucao
   ============================================================ */
function gerarPlano() {
  var ids = Array.from(S.selecionadas);
  if (!ids.length) return;
  abrirSheet("Ordem de execução",
    '<div class="cartao-insight"><div class="pensando">' +
    '<span class="pontinhos"><i></i><i></i><i></i></span>' +
    (S.temGroq ? "Perguntando para a Groq…" : "Montando a ordem…") + "</div></div>");

  api("/plano", { method: "POST", body: JSON.stringify({ ids: ids }) })
    .then(function (p) {
      var fonte = p.fonte === "groq"
        ? "Ordem sugerida pela Groq, modelo " + p.modelo
        : "Ordem montada localmente, sem IA";
      var itens = p.tarefas.map(function (t) {
        var titulo = t.url
          ? '<a href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.name) + "</a>"
          : esc(t.name);
        return "<li><div><strong>" + titulo + "</strong>" +
          (t.list ? '<span class="motivo">' + esc(t.list) + "</span>" : "") +
          '<span class="motivo">' + esc(t.motivo) + "</span></div></li>";
      }).join("");
      abrirSheet("Ordem de execução",
        '<div class="insight-fonte"><span>' + esc(fonte) + ". Gerado às " + hora(p.geradoEm) + ".</span></div>" +
        (p.resumo ? '<p class="detalhe-txt" style="margin:0 0 16px;font-size:15px">' + esc(p.resumo) + "</p>" : "") +
        '<ol class="tr-plano">' + itens + '</ol><div style="height:14px"></div>');
    })
    .catch(function (e) {
      abrirSheet("Ordem de execução",
        '<div class="tr-aviso"><strong>' + esc(e.message) + "</strong><p>" + esc(e.dica || "") + "</p></div>");
    });
}

/* ============================================================
   Daily
   ============================================================ */
var JANELAS = [24, 48, 72];

/* Texto puro pro botao copiar. O que vai pro Slack nao pode ter tag. */
function dailyEmTexto(d) {
  var linhas = ["Daily - ultimas " + d.horas + "h", ""];
  if (d.resumo) linhas.push(d.resumo, "");
  if (d.feito && d.feito.length) {
    linhas.push("Feito:");
    d.feito.forEach(function (f) {
      linhas.push("- " + f.task);
      (f.pontos || []).forEach(function (p) { linhas.push("  . " + p); });
    });
    linhas.push("");
  }
  if (d.proximas && d.proximas.length) {
    linhas.push("Proximas:");
    d.proximas.forEach(function (p) {
      linhas.push("- " + p.name + (p.list ? " [" + p.list + "]" : ""));
      if (p.motivo) linhas.push("  por que: " + p.motivo);
      if (p.url) linhas.push("  " + p.url);
    });
  }
  return linhas.join("\n").trim();
}

function corpoDaily(d) {
  var fonte = d.fonte === "groq"
    ? "Daily escrita pela Groq, modelo " + d.modelo
    : "Groq indisponivel, daily montada localmente";

  var seletor = '<div class="faixa-chips"><div class="chips">' +
    JANELAS.map(function (h) {
      return '<button class="chip' + (d.horas === h ? " ativo" : "") + '" data-daily-horas="' + h + '">' + h + "h</button>";
    }).join("") + "</div></div>";

  var feito = (d.feito && d.feito.length)
    ? '<ul class="tr-daily-feito">' + d.feito.map(function (f) {
        return "<li><strong>" + esc(f.task) + "</strong>" +
          ((f.pontos && f.pontos.length)
            ? "<ul>" + f.pontos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>"
            : "") + "</li>";
      }).join("") + "</ul>"
    : '<p class="tr-desc tr-vazio-txt">Nenhum comentario seu nessa janela. Nada para relatar.</p>';

  var proximas = (d.proximas && d.proximas.length)
    ? '<ol class="tr-plano">' + d.proximas.map(function (p) {
        var titulo = p.url
          ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a>"
          : esc(p.name);
        return "<li><div><strong>" + titulo + "</strong>" +
          (p.list ? '<span class="motivo">' + esc(p.list) + "</span>" : "") +
          '<span class="motivo">' + esc(p.motivo) + "</span></div></li>";
      }).join("") + "</ol>"
    : '<p class="tr-desc tr-vazio-txt">Nenhuma tarefa aberta para sugerir.</p>';

  return '<div class="insight-fonte"><span>' + esc(fonte) + ". Gerado as " + hora(d.geradoEm) +
      ", " + d.comentarios + " comentario(s) em " + d.tarefasVarridas + " tarefa(s)." +
      (d.falhas ? " " + d.falhas + " tarefa(s) sem leitura de comentario." : "") + "</span></div>" +
    seletor +
    (d.resumo ? '<p class="detalhe-txt" style="margin:14px 0 18px;font-size:15px">' + esc(d.resumo) + "</p>" : "") +
    '<p class="detalhe-rot">Feito</p>' + feito +
    '<p class="detalhe-rot" style="margin-top:18px">Proximas</p>' + proximas +
    '<div class="tr-acoes" style="margin-top:18px">' +
      '<button class="btn" data-daily-copiar="1">Copiar daily</button>' +
      '<button class="btn btn-suave" data-daily-refazer="1">Refazer</button>' +
    "</div><div style=\"height:14px\"></div>";
}

function gerarDaily(horas, forcar) {
  S.dailyHoras = horas;
  abrirSheet("Daily",
    '<div class="cartao-insight"><div class="pensando">' +
    '<span class="pontinhos"><i></i><i></i><i></i></span>' +
    "Lendo seus comentarios das ultimas " + horas + "h" +
    (S.temGroq ? " e perguntando para a Groq" : "") + "\u2026</div></div>");

  var qs = "?horas=" + horas + (forcar ? "&atualizar=1" : "");
  api("/daily" + qs)
    .then(function (d) {
      S.dailyUltima = d;
      abrirSheet("Daily", corpoDaily(d));
    })
    .catch(function (e) {
      abrirSheet("Daily",
        '<div class="tr-aviso"><strong>' + esc(e.message) + "</strong><p>" + esc(e.dica || "") + "</p></div>");
    });
}

/* ============================================================
   Opcoes
   ============================================================ */
function abrirOpcoes() {
  api("/health").then(function (h) {
    var linhas =
      '<div class="grupo"><button class="item" data-daily-abrir="1">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
          '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 14h5"/></svg>' +
        '<div class="item-txt"><strong>Gerar daily</strong>' +
        "<span>Resumo dos seus comentarios e o que pegar agora</span></div></button></div>" +
      '<div class="grupo">' +
        '<div class="item"><div class="item-txt"><strong>Token do ClickUp</strong>' +
          "<span>" + (h.tokenConfigurado ? "configurado" : "faltando") + "</span></div></div>" +
        '<div class="item"><div class="item-txt"><strong>Groq</strong>' +
          "<span>" + (h.groq ? esc(h.groqModelo) + " · " + (h.groqChaves || 1) + " chave(s)" : "sem chave, a ordem sai por heurística") + "</span></div></div>" +
        '<div class="item"><div class="item-txt"><strong>Escrita</strong>' +
          "<span>" + (h.somenteLeitura ? "somente leitura" : "comentário e status liberados") + "</span></div></div>" +
        '<div class="item"><div class="item-txt"><strong>Onde roda</strong>' +
          "<span>" + esc(h.ondeRoda) + (h.mock ? " · modo MOCK" : "") + "</span></div></div>" +
      "</div>" +
      '<a class="btn btn-largo btn-suave" href="/" style="text-decoration:none">Voltar ao Segundo cérebro</a>' +
      '<div style="height:14px"></div>';
    abrirSheet("Módulo Trabalho", linhas);
  }).catch(function (e) {
    abrirSheet("Módulo Trabalho", '<div class="tr-aviso"><strong>' + esc(e.message) + "</strong><p>" + esc(e.dica || "") + "</p></div>");
  });
}

/* ============================================================
   Carga
   ============================================================ */
function carregar() {
  S.erro = null;
  if (!S.tasks.length) S.carregando = true;
  render();

  var qs = new URLSearchParams({
    closed: S.fechadas ? "1" : "0",
    subtasks: S.subtarefas ? "1" : "0",
  });
  if (S.filtroPrazo) qs.set("due", S.filtroPrazo);
  if (S.periodo) qs.set("atividade", String(S.periodo));

  return api("/tasks?" + qs.toString()).then(function (d) {
    S.tasks = d.tasks;
    S.prazos = d.prazos || {};
    S.atividade = d.atividade || {};
    S.usuario = d.usuario;
    S.somenteLeitura = d.somenteLeitura;
    S.temGroq = Boolean(d.groq);
    S.carregadoEm = d.carregadoEm;
    S.doCache = d.cache;
    S.detalhes.clear();
    Array.from(S.selecionadas).forEach(function (id) {
      if (!d.tasks.some(function (t) { return t.id === id; })) S.selecionadas.delete(id);
    });
    S.carregando = false;
    render();
  }).catch(function (e) {
    S.carregando = false;
    S.erro = e;
    render();
  });
}

/* ============================================================
   Eventos
   ============================================================ */
document.addEventListener("click", function (ev) {
  var alvo;

  if ((alvo = ev.target.closest("[data-prazo]"))) {
    S.filtroPrazo = alvo.dataset.prazo;
    return carregar();
  }
  if ((alvo = ev.target.closest("[data-periodo]"))) {
    S.periodo = Number(alvo.dataset.periodo);
    return carregar();
  }
  if ((alvo = ev.target.closest("[data-liga]"))) {
    if (alvo.dataset.liga === "fechadas") S.fechadas = !S.fechadas;
    else S.subtarefas = !S.subtarefas;
    return carregar();
  }
  if (ev.target.closest("[data-marcar-visiveis]")) {
    S.visiveis.forEach(function (id) { S.selecionadas.add(id); });
    return render();
  }
  if ((alvo = ev.target.closest("[data-sel]"))) {
    var id = alvo.dataset.sel;
    if (S.selecionadas.has(id)) S.selecionadas.delete(id);
    else S.selecionadas.add(id);
    var cartaoEl = alvo.closest(".tr-tarefa");
    var marcado = S.selecionadas.has(id);
    alvo.setAttribute("aria-pressed", String(marcado));
    if (cartaoEl) cartaoEl.classList.toggle("marcada", marcado);
    return pintarBarraSel();
  }
  if (ev.target.closest("[data-daily-abrir]")) return gerarDaily(S.dailyHoras, false);
  if ((alvo = ev.target.closest("[data-daily-horas]"))) return gerarDaily(Number(alvo.dataset.dailyHoras), false);
  if (ev.target.closest("[data-daily-refazer]")) return gerarDaily(S.dailyHoras, true);
  if (ev.target.closest("[data-daily-copiar]")) {
    if (!S.dailyUltima) return;
    copiar(dailyEmTexto(S.dailyUltima), "Daily copiada");
    return;
  }
  if ((alvo = ev.target.closest("[data-abrir]"))) return abrirTarefa(alvo.dataset.abrir);
  if ((alvo = ev.target.closest("[data-comentar]"))) return enviarComentario(alvo.dataset.comentar, alvo);
  if ((alvo = ev.target.closest("[data-status]"))) return enviarStatus(alvo.dataset.status, alvo);
  if ((alvo = ev.target.closest("[data-copiar]"))) {
    copiar("[CU-" + alvo.dataset.copiar + "]", "Copiado");
    return;
  }
});

$("#btnPlano").addEventListener("click", gerarPlano);
$("#btnLimparSel").addEventListener("click", function () {
  S.selecionadas.clear();
  render();
});
$("#btnAtualizar").addEventListener("click", function () { carregar(); });
$("#btnOpcoes").addEventListener("click", abrirOpcoes);

var buscaTimer = null;
$("#campoBusca").addEventListener("input", function (ev) {
  var v = ev.target.value;
  $("#caixaBusca").classList.toggle("tem-texto", Boolean(v));
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(function () { S.busca = v; render(); }, 180);
});
$("#btnLimpar").addEventListener("click", function () {
  $("#campoBusca").value = "";
  $("#caixaBusca").classList.remove("tem-texto");
  S.busca = "";
  render();
});

/* Segmentado do agrupamento: mesma mecanica do app principal. */
function moverIndicador() {
  var ativo = $("#abasGrupo").querySelector("button.ativo");
  var ind = $("#indicadorGrupo");
  if (!ativo) return;
  ind.style.width = ativo.offsetWidth + "px";
  ind.style.transform = "translateX(" + (ativo.offsetLeft - 2) + "px)";
}
$("#abasGrupo").querySelectorAll("button").forEach(function (b) {
  b.addEventListener("click", function () {
    S.agrupar = b.dataset.grupo;
    $("#abasGrupo").querySelectorAll("button").forEach(function (x) {
      x.classList.toggle("ativo", x === b);
    });
    moverIndicador();
    render();
  });
});
window.addEventListener("resize", moverIndicador);
requestAnimationFrame(moverIndicador);

var _rolou = false;
addEventListener("scroll", function () {
  var agora = scrollY > 28;
  if (agora === _rolou) return;
  _rolou = agora;
  $("#barra").classList.toggle("rolou", agora);
}, { passive: true });

carregar();

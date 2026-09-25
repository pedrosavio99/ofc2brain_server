/* Segundo cerebro - app (estado, telas, modais, dados)
   Gerado a partir do index.html monolitico: CSS, app e visao sinaptica
   agora vivem em arquivos separados (mais facil de manter e o navegador
   cacheia cada um por conta). */

/* ============================================================
   Estado
   ============================================================ */
var S = {
  notas: [], eventos: [], aba: "foco", quantosNoHall: 5,
  recentes: [], busca: "", resultadosBusca: null,
  // insight: texto pronto, blocos (secoes), fonte (provedor/modelo), notas usadas,
  // formato escolhido (angulo/tamanho), url base pra refazer e a thread de follow-ups
  insight: null, insightBlocos: null, insightFonte: null, insightNotas: null,
  insightCarregando: false, insightEscopo: null, insightUrl: null,
  insightAngulo: "panorama", insightTamanho: "curto", insightThread: [], insightAuto: true,
  // payload da funcao armazenamento() do banco. null enquanto nao carrega, ou
  // quando a funcao nao foi criada no Supabase.
  armazenamento: null,
  // instrucao em texto livre para a GERACAO. Zera junto com a thread: pedido de
  // um recorte nao vale pro proximo.
  insightPedido: "",
  filtroArea: null, filtroTipo: null, carregando: true,
  areaAberta: null, periodo: '7d', dataDe: '', dataAte: '', limiteTempo: 40,
};

var $ = function (s) { return document.querySelector(s); };
var api = function (p, o) { return fetch(p, o); };

/* ============================================================
   Tema
   ============================================================ */
var TEMAS = { sistema: "Sistema", claro: "Claro", escuro: "Escuro" };
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem("2brain-tema", t); } catch (e) {}
  // a sinapse desenha de um jeito no claro e de outro no escuro, entao se ela
  // estiver aberta precisa ser redesenhada agora, e nao so na proxima abertura
  if (typeof aplicarTemaSinapse === "function" && $("#sinapse").classList.contains("aberta")) {
    aplicarTemaSinapse();
    if (typeof reconstruirGrafo === "function") reconstruirGrafo();
  }
}
try { aplicarTema(localStorage.getItem("2brain-tema") || "sistema"); } catch (e) { aplicarTema("sistema"); }

/* ============================================================
   Feedback
   ============================================================ */
var toastTimer;
function avisar(msg) {
  var el = $("#toast");
  el.textContent = msg;
  el.classList.add("visivel");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("visivel"); }, 2800);
}

/* ============================================================
   Sheet
   ============================================================ */
/* Trava do scroll centralizada. Antes cada modal mexia no overflow por conta
   propria, entao fechar um enquanto outro estava aberto podia deixar a pagina
   travada (ou liberada na hora errada). Agora e um estado so. */
function ajustarTravaScroll() {
  var travar = $("#sheet").classList.contains("aberto") || $("#sinapse").classList.contains("aberta");
  document.body.style.overflow = travar ? "hidden" : "";
}

function abrirSheet(titulo, html) {
  $("#sheetTitulo").textContent = titulo;
  $("#sheetCorpo").innerHTML = html;
  $("#sheet").classList.add("aberto");
  $("#cortina").classList.add("aberta");
  $("#sheet").scrollTop = 0;
  ajustarTravaScroll();
}
function fecharSheet() {
  $("#sheet").classList.remove("aberto");
  $("#cortina").classList.remove("aberta");
  ajustarTravaScroll();
  // re-renderiza pra faixa "Ver insight" aparecer assim que o modal fecha
  if (S.insight && !S.carregando) render();
}
$("#cortina").addEventListener("click", fecharSheet);
$("#btnFechaSheet").addEventListener("click", fecharSheet);
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if ($("#sinapse").classList.contains("aberta")) fecharSinapse();
  else fecharSheet();
});

/* ============================================================
   Helpers
   ============================================================ */
function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function rotuloTipo(t) {
  return ({ ideia: "ideia", conceito: "conceito", lembrete_evento: "evento", tarefa: "tarefa" })[t] || t || "nota";
}
/* relacionados sao objetos { id, motivo, score }; tolera string por seguranca */
function relId(r) { return typeof r === "string" ? r : (r && r.id); }
function relsDe(n) { return (n && n.relacionados) || []; }

function quando(iso) {
  if (!iso) return "";
  var d = new Date(iso), min = Math.floor((new Date() - d) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return min + " min";
  var h = Math.floor(min / 60);
  if (h < 24) return h + " h";
  var dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return dias + " d";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function dataEvento(iso) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "";
}

/* Cor por area: mesma funcao usada nos neuronios, pra card e grafo combinarem */
var _corCache = {};
function corDaArea(area) {
  var chave = area || "sem-área";
  if (_corCache[chave]) return _corCache[chave];
  var h = 0;
  for (var i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0;
  var cor = "hsl(" + (h % 360) + ", 60%, 62%)";
  _corCache[chave] = cor;
  return cor;
}

function medidor(n) {
  var cheias = Math.min(4, n), bolhas = "";
  for (var i = 0; i < 4; i++) bolhas += '<span class="bolha' + (i < cheias ? " on" : "") + '"></span>';
  return '<span class="ligacoes" title="' + n + ' ligação(ões)">' + bolhas + '<span class="num">' + n + "</span></span>";
}

function cardNota(n, opcoes) {
  var o = opcoes || {}, recente = !!o.recente, score = o.score == null ? null : o.score;
  var lig = relsDe(n).length;
  var selo = recente
    ? '<span class="selo-tipo selo-agora">nova</span>'
    : '<span class="selo-tipo' + (n.tipo === "lembrete_evento" ? " selo-evento" : "") + '">' + esc(rotuloTipo(n.tipo)) + "</span>";
  var extra = score !== null ? "<span>" + Math.round(score * 100) + "% parecida</span>"
    : n.data_evento ? "<span>" + esc(dataEvento(n.data_evento)) + "</span>"
    : "<span>" + esc(quando(n.criado_em)) + "</span>";
  return '<button class="nota' + (recente ? " recente" : "") + '" data-id="' + esc(n.id) + '"' +
      ' style="--cor-area:' + corDaArea(n.area) + '">' +
      '<div class="nota-topo">' + selo + (n.area ? '<span class="area-chip">' + esc(n.area) + "</span>" : "") + "</div>" +
      '<p class="nota-resumo">' + esc(n.resumo || n.texto_original || "Sem resumo") + "</p>" +
      (n.resumo ? '<p class="nota-texto">' + esc(n.texto_original) + "</p>" : "") +
      '<div class="nota-pe">' + extra + medidor(lig) + "</div>" +
    "</button>";
}

function esqueletos(n) {
  var q = n || 3, s = "";
  for (var i = 0; i < q; i++) s += '<div class="esqueleto"><div class="linha" style="width:35%"></div><div class="linha"></div><div class="linha"></div></div>';
  return '<div class="lista">' + s + "</div>";
}

/* ============================================================
   Dados
   ============================================================ */
function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Cold start do Supabase: na primeira carga (funcao serverless fria + banco
   despertando) o /ideias as vezes volta vazio mesmo havendo notas, e a tela
   mostrava "base vazia" a toa. Aqui a gente cruza com a contagem real de
   /armazenamento: se o banco DIZ que tem notas mas a lista veio vazia, espera
   um pouco e tenta de novo (backoff). Erro de rede tambem faz nova tentativa.
   Base de verdade vazia (contagem 0) NAO entra em loop. */
function obterNotasComRetry(tentativa) {
  tentativa = tentativa || 0;
  var MAX = 4;
  return Promise.all([
    api("/ideias").then(function (r) { if (!r.ok) throw new Error("ideias " + r.status); return r.json(); }),
    api("/armazenamento").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
  ]).then(function (res) {
    var notas = Array.isArray(res[0]) ? res[0] : [];
    var stats = res[1];
    // o /armazenamento ja era buscado aqui e o resultado ia pro lixo. Agora fica
    // guardado pro topo mostrar o tamanho sem fazer uma chamada a mais.
    S.armazenamento = (stats && stats.armazenamento) || null;
    var esperado = stats && typeof stats.ideias === "number" ? stats.ideias : null;
    var coldStart = notas.length === 0 && esperado > 0;
    if (coldStart && tentativa < MAX) {
      if (tentativa === 0) avisar("Acordando o banco…");
      return esperar(600 * Math.pow(1.8, tentativa)).then(function () {
        return obterNotasComRetry(tentativa + 1);
      });
    }
    return notas;
  }).catch(function (err) {
    if (tentativa < MAX) {
      return esperar(600 * Math.pow(1.8, tentativa)).then(function () {
        return obterNotasComRetry(tentativa + 1);
      });
    }
    throw err;
  });
}

function carregar() {
  S.carregando = true;
  render();
  return obterNotasComRetry(0).then(function (notas) {
    S.notas = notas;
    return api("/eventos/proximos?dias=45").then(function (r) { return r.json(); }).catch(function () { return []; });
  }).then(function (evts) {
    S.eventos = Array.isArray(evts) ? evts : [];
  }).catch(function () {
    avisar("Não deu pra carregar as notas.");
    if (!Array.isArray(S.notas)) S.notas = [];
  }).then(function () {
    S.carregando = false;   // sai do esqueleto aconteca o que acontecer
    render();
    /* Avisa a tela de abertura que ja da pra sair. Ela NAO sai na hora: espera
       a virada do ciclo da animacao, garantindo um ciclo inteiro. */
    if (window.aberturaPronta) window.aberturaPronta();
    if ($("#sinapse").classList.contains("aberta") && typeof reconstruirGrafo === "function") reconstruirGrafo();
  });
}

/* Depois de guardar UMA nota, atualiza o estado local em vez de reler a base
   inteira. Numa base de algumas centenas de notas isso e a diferenca entre
   guardar levar o tempo do LLM e levar o tempo do LLM mais uma varredura.
   O garimpo continua usando carregar(): la sao varias notas de uma vez. */
function absorverNota(nova) {
  // ordem de criacao crescente, igual ao que vem do servidor. Quem precisa de
  // outra ordem (por ligacoes, por data) ja ordena por conta propria.
  var existe = S.notas.some(function (n) { return n.id === nova.id; });
  if (!existe) S.notas.push(nova);

  // Espelho da referencia de volta. O servidor, ao criar a nota, acrescenta
  // { id da nova, motivo, score } no relacionados de cada nota citada (ver
  // criarIdeiaAutomaticamente no ideasService.js). Sem repetir isso aqui, o
  // medidor de ligacoes desses cards ficaria uma unidade atras ate o proximo
  // carregamento. Se a regra mudar la, ela precisa mudar aqui tambem.
  var porId = {};
  S.notas.forEach(function (n) { porId[n.id] = n; });
  relsDe(nova).forEach(function (rel) {
    var antiga = porId[rel.id];
    if (!antiga) return;
    antiga.relacionados = relsDe(antiga).filter(function (r) { return r.id !== nova.id; });
    antiga.relacionados.push({ id: nova.id, motivo: rel.motivo, score: rel.score });
  });

  render();
  if ($("#sinapse").classList.contains("aberta") && typeof reconstruirGrafo === "function") reconstruirGrafo();

  // Lembrete de evento so aparece na aba Eventos depois que o servidor aplica
  // a janela de dias. Essa rota ficou barata, entao vale a ida. Qualquer outro
  // tipo de nota nao mexe em S.eventos e nao precisa de rede nenhuma.
  if (nova.tipo === "lembrete_evento" && nova.data_evento) {
    return api("/eventos/proximos?dias=45")
      .then(function (r) { return r.json(); })
      .then(function (evts) { S.eventos = Array.isArray(evts) ? evts : []; render(); })
      .catch(function () {});
  }
  return Promise.resolve();
}

function adicionar() {
  var texto = $("#campoNota").value.trim();
  if (!texto) return Promise.resolve();
  var btn = $("#btnAdicionar");
  btn.disabled = true;
  btn.textContent = "Guardando…";
  return api("/ideias", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto: texto }),
  }).then(function (r) {
    return r.json().then(function (nova) {
      if (!r.ok) throw new Error(nova.erro || "Falhou ao guardar.");
      $("#campoNota").value = "";
      ajustarAltura();
      S.recentes = [nova.id].concat(S.recentes.filter(function (i) { return i !== nova.id; })).slice(0, 5);
      S.animarId = nova.id;
      trocarAba("foco");
      return absorverNota(nova).then(function () { avisar("Nota guardada."); });
    });
  }).catch(function (e) { avisar(e.message); })
    .then(function () {
      btn.textContent = "Guardar";
      btn.disabled = !$("#campoNota").value.trim();
    });
}

function buscar(q) {
  if (!q) { S.resultadosBusca = null; limparInsight(); S.insightCarregando = false; render(); return; }
  S.resultadosBusca = "carregando";
  limparInsight();
  S.insightCarregando = false;
  render();
  api("/pesquisa?q=" + encodeURIComponent(q) + "&limite=10")
    .then(function (r) { return r.json(); })
    .then(function (d) { S.resultadosBusca = d.resultados || []; })
    .catch(function () { S.resultadosBusca = []; avisar("A busca falhou."); })
    .then(render);
}

/* Insight sob demanda: so roda quando voce pede, porque usa o modelo forte
   (Gemini) e demora alguns segundos. Nao faz sentido disparar a cada tecla. */
/* Guarda, de forma enxuta, as notas que alimentaram o ultimo insight, pra
   mostrar o acordeon depois. Mantem resumo/area como reserva caso a nota nao
   esteja mais em S.notas na hora de desenhar o card. */
function guardarNotasInsight(lista) {
  if (!Array.isArray(lista) || lista.length === 0) { S.insightNotas = null; return; }
  S.insightNotas = lista.map(function (n) {
    return {
      id: n.id,
      resumo: n.resumo || null,
      area: n.area || null,
      score: (typeof n.score === "number" ? n.score : null),
    };
  });
}

/* ============================================================
   Render
   ============================================================ */
function porLigacoes(a, b) {
  var d = relsDe(b).length - relsDe(a).length;
  return d !== 0 ? d : String(b.criado_em || "").localeCompare(String(a.criado_em || ""));
}
function notasFiltradas() {
  return S.notas.filter(function (n) {
    if (S.filtroArea && (n.area || "Sem área") !== S.filtroArea) return false;
    if (S.filtroTipo && n.tipo !== S.filtroTipo) return false;
    return true;
  });
}

/* A vista atual (aba + busca + filtros). Muda de vista => anima a entrada.
   Mesma vista (ex: apenas recarregou) => sem animacao, sem piscar. */
function chaveDaVista() {
  return [S.busca ? "busca:" + S.busca + (S.resultadosBusca === "carregando" ? ":buscando" : "") : S.aba, S.filtroArea || "", S.filtroTipo || "",
          S.areaAberta || "", S.periodo, S.dataDe, S.dataAte].join("|");
}
var vistaAnterior = null;

var saidaTimer = null;

function movimentoReduzido() {
  return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function render() {
  atualizarResumoTopo();
  renderFiltros();
  var alvo = $("#conteudo");
  var html;
  if (S.busca) html = telaBusca();
  else if (S.carregando) { alvo.innerHTML = esqueletos(); return; }
  else if (S.aba === "foco") html = S.areaAberta ? telaAreaAberta() : telaFoco();
  else if (S.aba === "areas") html = S.areaAberta ? telaAreaAberta() : telaAreas();
  else if (S.aba === "tempo") html = telaTempo();
  else html = telaEventos();

  var vista = chaveDaVista();

  /* A ultima escolha vence: se uma saida estava rolando e chegou outro
     render, ela e cancelada e so o mais novo vale. */
  if (saidaTimer) { clearTimeout(saidaTimer); saidaTimer = null; }

  /* Esquecer: a vista mudou e ha cards na tela que nao estarao na proxima
     (limpou o filtro, trocou de area, apagou a busca). So esses somem,
     desfocando do ultimo pro primeiro, e entao a tela troca. Vale na busca
     tambem: ela so roda 350ms depois da ultima tecla. */
  var velhas = Array.prototype.filter.call(alvo.querySelectorAll(".nota[data-id]"), function (el) {
    return html.indexOf('data-id="' + el.dataset.id + '"') < 0;
  });
  if (vista !== vistaAnterior && velhas.length && !movimentoReduzido()) {
    var n = velhas.length;
    velhas.forEach(function (el, i) {
      el.style.animationDelay = Math.min((n - 1 - i) * 35, 280) + "ms";
      el.classList.add("esquecer");
    });
    alvo.classList.add("esquecendo");
    saidaTimer = setTimeout(function () {
      saidaTimer = null;
      aplicarTela(alvo, html, vista);
    }, 340 + Math.min(n * 35, 280));
    return;
  }
  aplicarTela(alvo, html, vista);
}

function aplicarTela(alvo, html, vista) {
  alvo.classList.remove("esquecendo");
  alvo.innerHTML = html;

  if (vista !== vistaAnterior) {
    vistaAnterior = vista;
    alvo.querySelectorAll(".lista").forEach(function (l) { l.classList.add("animar"); });
    /* tira a classe depois da animacao: assim um re-render seguinte nao
       repete. 1100 e nao 400: os cards entram um depois do outro, e tirar
       antes cortaria os ultimos no meio. */
    setTimeout(function () {
      alvo.querySelectorAll(".lista.animar").forEach(function (l) { l.classList.remove("animar"); });
    }, 1100);
  }

  // a nota recem-guardada recorda sozinha, mesmo sem a vista mudar
  if (S.animarId) {
    var nova = alvo.querySelector('.nota[data-id="' + String(S.animarId).replace(/"/g, "") + '"]');
    if (nova) nova.classList.add("recordando");
    S.animarId = null;
  }
}

/* Delegacao de evento: um listener so, no container, em vez de um por card.
   Cards continuam clicaveis mesmo depois de qualquer re-render. */
document.addEventListener("click", function (ev) {
  var card = ev.target.closest ? ev.target.closest(".nota") : null;
  if (card && card.dataset.id) { abrirDetalhe(card.dataset.id); return; }

  var qtd = ev.target.closest ? ev.target.closest("#qtdHall button") : null;
  if (qtd) { S.quantosNoHall = Number(qtd.dataset.qtd); render(); return; }

  // ATENCAO: os botoes de periodo tambem usam a classe .chip, entao precisam
  // ser tratados ANTES do handler generico de chips (senao ele engole o clique).
  var mt = ev.target.closest ? ev.target.closest("#maisTempo") : null;
  if (mt) { S.limiteTempo += 40; render(); return; }

  var pe = ev.target.closest ? ev.target.closest("[data-periodo]") : null;
  if (pe) { S.periodo = pe.dataset.periodo; S.limiteTempo = 40; render(); return; }

  var chip = ev.target.closest ? ev.target.closest(".chip") : null;
  if (chip) {
    if (chip.dataset.limpa) { S.filtroArea = null; S.filtroTipo = null; }
    else if (chip.dataset.tipoLimpa) S.filtroTipo = null;
    else if (chip.dataset.area) S.filtroArea = S.filtroArea === chip.dataset.area ? null : chip.dataset.area;
    else if (chip.dataset.tipo) S.filtroTipo = S.filtroTipo === chip.dataset.tipo ? null : chip.dataset.tipo;
    render();
    return;
  }

  var bi = ev.target.closest ? ev.target.closest("#btnInsight") : null;
  if (bi) { ev.stopPropagation(); gerarInsight(); return; }

  var vi = ev.target.closest ? ev.target.closest("#verInsight") : null;
  if (vi) { abrirInsight(S.insightEscopo && S.insightEscopo.tipo === "periodo" ? "Insight do período" : "Insight"); return; }

  var ab = ev.target.closest ? ev.target.closest("[data-area-abrir]") : null;
  if (ab) { S.areaAberta = ab.dataset.areaAbrir; render(); return; }

  var vt = ev.target.closest ? ev.target.closest("#voltarAreas") : null;
  if (vt) { S.areaAberta = null; S.filtroTipo = null; render(); return; }

  var ip = ev.target.closest ? ev.target.closest("#insightPeriodo") : null;
  if (ip) {
    var notas = notasDoPeriodo();
    if (!notas.length) { avisar("Nenhuma nota neste período."); return; }
    gerarInsight({ tipo: "periodo", notas: notas });
    return;
  }

  var gp = ev.target.closest ? ev.target.closest("[data-g-periodo]") : null;
  if (gp) { G.periodo = gp.dataset.gPeriodo; reconstruirGrafo(); return; }

  var gd = ev.target.closest ? ev.target.closest("[data-g-dens]") : null;
  if (gd) { G.densidade = Number(gd.dataset.gDens); reconstruirGrafo(); return; }

  var ga = ev.target.closest ? ev.target.closest("[data-g-area]") : null;
  if (ga) { G.area = ga.dataset.gArea || null; reconstruirGrafo(); return; }

  var pg = ev.target.closest ? ev.target.closest("[data-pergunta]") : null;
  if (pg) { usarPergunta(pg.dataset.pergunta); return; }

  var sg = ev.target.closest ? ev.target.closest("#abrirSugestoes") : null;
  if (sg) { telaSugestoes(false); return; }

  var pb = ev.target.closest ? ev.target.closest("#perguntasDaBusca") : null;
  if (pb) {
    var res = Array.isArray(S.resultadosBusca) ? S.resultadosBusca : [];
    if (!res.length) { avisar("Nenhuma nota nos resultados."); return; }
    telaSugestoes(false, res.map(function (n) { return n.id; }));
    return;
  }

  var fl = ev.target.closest ? ev.target.closest("#abrirFiltros") : null;
  if (fl) { telaFiltros(); return; }

  var ir = ev.target.closest ? ev.target.closest("[data-ir]") : null;
  if (ir) { abrirDetalhe(ir.dataset.ir); return; }
});

/* Bytes em texto de gente. O pg_size_pretty do Postgres so vira MB depois de
   uns 10 MB, entao 4288 kB ficava assim na tela. Aqui a gente formata dos bytes
   crus, com virgula decimal. */
function tamanhoBonito(bytes) {
  var b = Number(bytes);
  if (!isFinite(b) || b <= 0) return "";
  if (b < 1024) return b + " B";
  var kb = b / 1024;
  if (kb < 1024) return Math.round(kb) + " KB";
  var mb = kb / 1024;
  if (mb < 1024) return String(Math.round(mb * 10) / 10).replace(".", ",") + " MB";
  return String(Math.round((mb / 1024) * 100) / 100).replace(".", ",") + " GB";
}

/* O tamanho do que e SEU (schema public), nao o do banco inteiro: o numero do
   painel do Supabase inclui auth, storage, realtime e catalogos, que sao uns
   27 MB que existem num projeto vazio e nao crescem com o uso.
   Vazio quando a funcao armazenamento() nao foi criada no banco. */
function tamanhoDaBase() {
  var a = S.armazenamento;
  if (!a) return "";
  // prefere os bytes crus; o texto do Postgres e o plano B
  return tamanhoBonito(a.seu_bytes) || (a.seu ? String(a.seu) : "");
}

function atualizarResumoTopo() {
  var n = S.notas.length;
  var lig = 0;
  S.notas.forEach(function (i) { lig += relsDe(i).length; });
  lig = Math.round(lig / 2);
  var tam = tamanhoDaBase();

  /* Layout novo: a faixa de numeros abaixo da barra. Sem ela no HTML, cai no
     texto antigo, pra nenhum passo da troca deixar a pagina quebrada. */
  var faixa = $("#faixaResumo");
  if (faixa) {
    var c = S.carregando;
    faixa.classList.toggle("carregando", !!c);
    $("#numNotas").textContent = c ? "–" : n.toLocaleString("pt-BR");
    $("#rotNotas").textContent = n === 1 ? "nota" : "notas";
    $("#numLigacoes").textContent = c ? "–" : lig.toLocaleString("pt-BR");
    $("#rotLigacoes").textContent = lig === 1 ? "ligação" : "ligações";
    // sem a funcao armazenamento() no banco nao ha tamanho; o traco e honesto
    $("#numEspaco").textContent = c || !tam ? "–" : tam;
    return;
  }

  var el = $("#resumoTopo");
  if (!el) return;
  if (S.carregando) { el.textContent = "Carregando…"; return; }
  el.textContent = n === 0 ? "Nenhuma nota ainda."
    : n + " " + (n === 1 ? "nota" : "notas") + " · " + lig + " " + (lig === 1 ? "ligação" : "ligações") +
      (tam ? " · " + tam : "");
}

/* Atalhos da faixa. Ligacoes abre a visao sinaptica pelo mesmo botao da barra
   (sem conhecer o sinapse.js por dentro). Espaco abre a tela de armazenamento,
   que antes so se achava no menu. */
(function () {
  var lig = document.getElementById("statLigacoes");
  var esp = document.getElementById("statEspaco");
  if (lig) lig.addEventListener("click", function () {
    var b = document.getElementById("btnSinapse");
    if (b) b.click();
  });
  if (esp) esp.addEventListener("click", function () { telaArmazenamento(); });
})();

/* Dentro de uma area aberta: so os tipos que existem nela. */
function chipsDeTipo() {
  var tipos = {};
  S.notas.forEach(function (n) {
    if ((n.area || "Sem área") === S.areaAberta) tipos[n.tipo || "ideia"] = 1;
  });
  var lista = Object.keys(tipos);
  if (lista.length < 2) return "";
  return '<div class="faixa-chips"><div class="chips">' +
    '<button class="chip' + (!S.filtroTipo ? " ativo" : "") + '" data-tipo-limpa="1">Todos</button>' +
    lista.map(function (t) {
      return '<button class="chip' + (S.filtroTipo === t ? " ativo" : "") + '" data-tipo="' + esc(t) + '">' + esc(rotuloTipo(t)) + "</button>";
    }).join("") + "</div></div>";
}

/* Filtros por area e tipo (chips roláveis) */
function renderFiltros() {
  var box = $("#filtros");
  if (S.busca || S.carregando || S.aba === "eventos" || S.notas.length === 0) { box.innerHTML = ""; return; }
  if (S.aba === "areas" && S.areaAberta) { box.innerHTML = ""; return; }
  // na Memoria nao ha faixa de chips: os blocos sao as areas, e os tipos
  // moram dentro da area aberta, logo abaixo do titulo dela
  if (S.aba === "foco") { box.innerHTML = ""; return; }
  var areas = {}, tipos = {};
  S.notas.forEach(function (n) {
    areas[n.area || "Sem área"] = (areas[n.area || "Sem área"] || 0) + 1;
    tipos[n.tipo || "ideia"] = (tipos[n.tipo || "ideia"] || 0) + 1;
  });
  var listaAreas = Object.keys(areas).sort(function (a, b) { return areas[b] - areas[a]; });
  var listaTipos = Object.keys(tipos);
  if (listaAreas.length < 2 && listaTipos.length < 2) { box.innerHTML = ""; return; }

  var html = '<div class="faixa-chips"><div class="chips">' +
    '<button class="chip' + (!S.filtroArea && !S.filtroTipo ? " ativo" : "") + '" data-limpa="1">Tudo</button>' +
    listaAreas.map(function (a) {
      return '<button class="chip' + (S.filtroArea === a ? " ativo" : "") + '" data-area="' + esc(a) + '">' +
        '<i class="ponto" style="background:' + corDaArea(a === "Sem área" ? null : a) + '"></i>' + esc(a) + "</button>";
    }).join("") +
    (listaTipos.length > 1 ? listaTipos.map(function (t) {
      return '<button class="chip' + (S.filtroTipo === t ? " ativo" : "") + '" data-tipo="' + esc(t) + '">' + esc(rotuloTipo(t)) + "</button>";
    }).join("") : "") + "</div></div>";
  box.innerHTML = html;

  // cliques dos chips sao tratados por delegacao (ver o listener global)
}


/* --- Areas: lista compacta (uma linha por area). Antes despejava todas as
   areas com 6 cards cada, o que virava uma pagina gigante. Agora voce toca


/* --- Linha do tempo: notas por periodo. Ajuda a olhar "o que eu pensei essa
   semana" e, junto com o insight, deixa a leitura bem mais afiada. --- */
var PERIODOS = [
  { id: "1d", rot: "Hoje", dias: 1 },
  { id: "7d", rot: "7 dias", dias: 7 },
  { id: "30d", rot: "30 dias", dias: 30 },
  { id: "tudo", rot: "Tudo", dias: null },
  { id: "custom", rot: "Escolher", dias: null },
];








/* Bloco do insight: botao quando ainda nao pediu, estado de espera
   enquanto o modelo pensa, e o texto em paragrafos quando chega. */
function blocoInsight() {
  if (S.insightCarregando) {
    return '<div class="faixa-insight aguardando"><span class="pontinhos"><i></i><i></i><i></i></span>' +
      "Lendo suas notas e procurando o que elas dizem juntas…</div>";
  }
  if (S.insight) {
    // ja gerado: some da lista e vira um chip discreto que reabre o modal
    return '<button class="faixa-insight pronta" id="verInsight">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" width="16" height="16">' +
      '<path d="M12 3v1.5M5.2 5.2l1 1M3 12h1.5M18.8 5.2l-1 1M21 12h-1.5"/><path d="M9.2 17.5h5.6M10 21h4"/>' +
      '<path d="M12 7a5 5 0 00-2.8 9.1V17.5h5.6V16.1A5 5 0 0012 7z"/></svg>' +
      "Ver insight" +
      '<span class="refazer-mini" id="btnInsight">gerar de novo</span></button>';
  }
  return '<button class="btn btn-suave btn-largo btn-insight" id="btnInsight">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' +
    '<path d="M12 3v1.5M5.2 5.2l1 1M3 12h1.5M18.8 5.2l-1 1M21 12h-1.5"/>' +
    '<path d="M9.2 17.5h5.6M10 21h4"/><path d="M12 7a5 5 0 00-2.8 9.1V17.5h5.6V16.1A5 5 0 0012 7z"/></svg>' +
    "Gerar insight com estas notas</button>";
}

/* Duas acoes lado a lado nos resultados da busca:
   - insight: responde sobre estas notas
   - perguntas: sugere O QUE perguntar sobre estas notas, que e o que ajuda
     quando voce nao sabe o que tem ali dentro (o resultado da busca costuma
     trazer notas de epocas diferentes que voce nao lembrava). */
function acoesDaBusca() {
  return '<div class="acoes-busca">' + blocoInsight() +
    '<button class="btn btn-suave btn-largo btn-perguntas" id="perguntasDaBusca">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' +
    '<path d="M9.2 9a2.8 2.8 0 115.6.6c0 1.9-2.8 2.4-2.8 4.4"/><circle cx="12" cy="18" r=".6" fill="currentColor"/></svg>' +
    "O que perguntar sobre elas</button></div>";
}

/* Em foco sem filtro. Antes despejava 5 ou 10 cards toda vez que a pagina
   abria. Agora a memoria fica quieta: as areas viram blocos, e tocar num
   deles e o mesmo que tocar no chip da area. So a nota recem-guardada
   aparece como card, que e a confirmacao de que ela entrou. */
function telaFocoEmRepouso() {
  var contagem = {}, ligacoes = {};
  S.notas.forEach(function (n) {
    var a = n.area || "Sem área";
    contagem[a] = (contagem[a] || 0) + 1;
    ligacoes[a] = (ligacoes[a] || 0) + relsDe(n).length;
  });
  var areas = Object.keys(contagem).sort(function (a, b) { return contagem[b] - contagem[a]; });

  var recentes = S.recentes.map(function (id) {
    return S.notas.filter(function (n) { return n.id === id; })[0];
  }).filter(Boolean);

  return (recentes.length
      ? '<div class="cab-secao"><div><h2>Acabou de guardar</h2><p>' + recentes.length + " " +
          (recentes.length === 1 ? "nota" : "notas") + " nesta sessão</p></div></div>" +
        '<div class="lista duas">' + recentes.map(function (n) {
          return cardNota(n, { recente: true });
        }).join("") + "</div>"
      : "") +
    '<div class="cab-secao memoria-cab"><div><h2>Sua memória</h2>' +
      "<p>Toque numa área pra recordar o que tem nela</p></div></div>" +
    '<div class="lista memoria-areas">' + areas.map(function (a) {
      var q = contagem[a];
      // cada ligacao aparece nas duas notas; metade e o numero real
      var l = Math.round(ligacoes[a] / 2);
      return '<button class="memoria-area" data-area-abrir="' + esc(a) + '"' +
        ' style="--cor-area:' + corDaArea(a === "Sem área" ? null : a) + '">' +
        '<i class="ponto"></i>' +
        '<span class="nome">' + esc(a) + "</span>" +
        '<span class="qtd">' + q + " " + (q === 1 ? "nota" : "notas") + "</span>" +
        // sempre uma linha pra ligacoes, pra todos os blocos terem a mesma altura
        '<span class="lig">' + (l ? l + " " + (l === 1 ? "ligação" : "ligações") : "sem ligações") + "</span>" +
      "</button>";
    }).join("") + "</div>" +
    '<button class="convite" id="abrirSugestoes">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" width="18" height="18">' +
      '<path d="M9.5 17.5h5M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9V17.5h7V13.9A6 6 0 0012 3z"/></svg>' +
      "<span><strong>Não sabe o que perguntar?</strong>Veja 10 perguntas tiradas das suas notas</span>" +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".4" width="18" height="18"><path d="M9 6l6 6-6 6"/></svg>' +
    "</button>";
}

/* --- Em foco: o hall --- */
function telaFoco() {
  var base = notasFiltradas();
  if (S.notas.length === 0) {
    return '<div class="vazio"><span class="emoji">🧠</span><h3>Comece pela primeira nota</h3>' +
      "<p>Escreva qualquer coisa acima. O resumo, a área e as ligações saem sozinhos.</p></div>";
  }
  if (base.length === 0) {
    return '<div class="vazio"><h3>Nada com esse filtro</h3><p>Toque em “Tudo” pra ver todas de novo.</p></div>';
  }

  /* A Memoria nunca despeja notas: sempre os blocos de area. Filtro de
     area ou tipo vindo da Linha do tempo nao vaza pra ca. */
  return telaFocoEmRepouso();

  var mapaRecentes = {};
  var recentes = S.recentes.map(function (id) {
    return base.filter(function (n) { return n.id === id; })[0];
  }).filter(Boolean);
  recentes.forEach(function (n) { mapaRecentes[n.id] = true; });

  var consolidadas = base.filter(function (n) { return !mapaRecentes[n.id]; }).sort(porLigacoes);
  var vagas = Math.max(0, S.quantosNoHall - recentes.length);
  var mostradas = recentes.concat(consolidadas.slice(0, vagas));
  var restante = base.length - mostradas.length;

  return '<div class="cab-secao"><div><h2>Memória de trabalho</h2><p>Mais conectadas' +
      (recentes.length ? " e as recém-guardadas" : "") + "</p></div>" +
      '<div class="mini-seg" id="qtdHall">' +
        '<button class="' + (S.quantosNoHall === 5 ? "ativo" : "") + '" data-qtd="5">5</button>' +
        '<button class="' + (S.quantosNoHall === 10 ? "ativo" : "") + '" data-qtd="10">10</button>' +
      "</div></div>" +
    '<div class="lista duas">' + mostradas.map(function (n) {
      return cardNota(n, { recente: !!mapaRecentes[n.id] });
    }).join("") + "</div>" +
    (restante > 0 ? '<div class="vazio" style="padding:22px 20px 4px"><p>Mais ' + restante + " " +
      (restante === 1 ? "nota" : "notas") + ". Use a busca, os filtros ou a visão sináptica.</p></div>" : "") +
    '<button class="convite" id="abrirSugestoes">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" width="18" height="18">' +
      '<path d="M9.5 17.5h5M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9V17.5h7V13.9A6 6 0 0012 3z"/></svg>' +
      "<span><strong>Não sabe o que perguntar?</strong>Veja 10 perguntas tiradas das suas notas</span>" +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".4" width="18" height="18"><path d="M9 6l6 6-6 6"/></svg>' +
    "</button>";
}

/* --- Areas: lista compacta (uma linha por area). Antes despejava todas as
   areas com 6 cards cada, o que virava uma pagina gigante. Agora voce toca
   numa area e abre so ela, com botao de voltar. --- */
function telaAreas() {
  var base = notasFiltradas(), mapa = {};
  base.forEach(function (n) {
    var a = n.area || "Sem área";
    (mapa[a] = mapa[a] || []).push(n);
  });
  var areas = Object.keys(mapa).sort(function (a, b) { return mapa[b].length - mapa[a].length; });
  if (areas.length === 0) {
    return '<div class="vazio"><span class="emoji">🗂️</span><h3>Nada por aqui</h3><p>As áreas aparecem conforme você guarda notas.</p></div>';
  }
  return '<div class="cab-secao"><div><h2>Áreas</h2><p>' + areas.length + " " +
    (areas.length === 1 ? "área" : "áreas") + " · toque para abrir</p></div></div>" +
    '<div class="grupo">' + areas.map(function (a) {
      var notas = mapa[a];
      var lig = 0;
      notas.forEach(function (n) { lig += relsDe(n).length; });
      return '<button class="item" data-area-abrir="' + esc(a) + '">' +
        '<span class="ponto-area" style="background:' + corDaArea(a === "Sem área" ? null : a) + '"></span>' +
        '<div class="item-txt"><strong>' + esc(a) + "</strong><span>" + notas.length + " " +
        (notas.length === 1 ? "nota" : "notas") + " · " + Math.round(lig / 2) + " ligações</span></div>" +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".35"><path d="M9 6l6 6-6 6"/></svg>' +
        "</button>";
    }).join("") + "</div>";
}

/* Notas de UMA area (drill-down). Mostra todas, das mais conectadas pras
   menos. So o filtro de tipo vale aqui: o de area e a propria area. */
function telaAreaAberta() {
  var alvo = S.areaAberta;
  var daArea = S.notas.filter(function (n) { return (n.area || "Sem área") === alvo; });
  var notas = daArea.filter(function (n) { return !S.filtroTipo || n.tipo === S.filtroTipo; }).sort(porLigacoes);
  return '<button class="voltar" id="voltarAreas">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>Memória</button>' +
    '<div class="cab-secao area-cab" style="--cor-area:' + corDaArea(alvo === "Sem área" ? null : alvo) + '">' +
      '<div><h2><i class="ponto"></i>' + esc(alvo) + "</h2><p>" + notas.length + " " +
      (notas.length === 1 ? "nota" : "notas") + (S.filtroTipo ? " de " + esc(rotuloTipo(S.filtroTipo)).toLowerCase() : "") +
      ", das mais conectadas pras menos</p></div></div>" +
    chipsDeTipo() +
    (notas.length
      ? '<div class="lista duas">' + notas.map(function (n) { return cardNota(n); }).join("") + "</div>"
      : '<div class="vazio"><p>Nada desse tipo nesta área.</p></div>');
}


/* --- Linha do tempo: notas por periodo. Ajuda a olhar "o que eu pensei essa
   semana" e, junto com o insight, deixa a leitura bem mais afiada. --- */
var PERIODOS = [
  { id: "1d", rot: "Hoje", dias: 1 },
  { id: "7d", rot: "7 dias", dias: 7 },
  { id: "30d", rot: "30 dias", dias: 30 },
  { id: "tudo", rot: "Tudo", dias: null },
  { id: "custom", rot: "Escolher", dias: null },
];

function limitesDoPeriodo() {
  if (S.periodo === "custom") {
    return {
      de: S.dataDe ? new Date(S.dataDe + "T00:00:00") : null,
      ate: S.dataAte ? new Date(S.dataAte + "T23:59:59.999") : null,
    };
  }
  var p = PERIODOS.filter(function (x) { return x.id === S.periodo; })[0];
  if (!p || p.dias === null) return { de: null, ate: null };
  return { de: new Date(Date.now() - p.dias * 86400000), ate: null };
}

function notasDoPeriodo() {
  var lim = limitesDoPeriodo();
  return notasFiltradas().filter(function (n) {
    var t = new Date(n.criado_em).getTime();
    if (isNaN(t)) return false;
    if (lim.de && t < lim.de.getTime()) return false;
    if (lim.ate && t > lim.ate.getTime()) return false;
    return true;
  }).sort(function (a, b) { return String(b.criado_em).localeCompare(String(a.criado_em)); });
}

/* agrupa por dia, pra leitura virar uma linha do tempo de verdade */
function telaTempo() {
  var seletor = '<div class="chips periodo">' + PERIODOS.map(function (p) {
    return '<button class="chip' + (S.periodo === p.id ? " ativo" : "") + '" data-periodo="' + p.id + '">' + p.rot + "</button>";
  }).join("") + "</div>" +
  (S.periodo === "custom"
    ? '<div class="intervalo"><label>De<input type="date" id="dataDe" value="' + esc(S.dataDe) + '" /></label>' +
      '<label>Até<input type="date" id="dataAte" value="' + esc(S.dataAte) + '" /></label></div>'
    : "");

  var notas = notasDoPeriodo();
  if (notas.length === 0) {
    return seletor + '<div class="vazio"><span class="emoji">🗓️</span><h3>Nada neste período</h3>' +
      "<p>Escolha um intervalo maior ou guarde uma nota nova.</p></div>";
  }

  // Renderiza no maximo N cards por vez. Sem isso, um periodo grande jogava
  // centenas de cards no DOM de uma vez e o scroll/toque ficavam pesados.
  var totalPeriodo = notas.length;
  var cortou = totalPeriodo > S.limiteTempo;
  if (cortou) notas = notas.slice(0, S.limiteTempo);

  // agrupa por dia
  var grupos = [], atual = null;
  notas.forEach(function (n) {
    var dia = new Date(n.criado_em).toDateString();
    if (!atual || atual.dia !== dia) { atual = { dia: dia, iso: n.criado_em, itens: [] }; grupos.push(atual); }
    atual.itens.push(n);
  });

  var corpo = grupos.map(function (g) {
    return '<p class="dia-rot">' + esc(rotuloDoDia(g.iso)) + "</p>" +
      '<div class="lista duas">' + g.itens.map(function (n) { return cardNota(n); }).join("") + "</div>";
  }).join("");

  // faixa do insight do periodo (some quando o escopo atual e outro)
  var doPeriodo = S.insightEscopo && S.insightEscopo.tipo === "periodo";
  var faixa = (S.insightCarregando && doPeriodo) || (S.insight && doPeriodo) ? blocoInsight() : "";

  return seletor +
    '<div class="cab-secao"><div><h2>' + totalPeriodo + " " + (totalPeriodo === 1 ? "nota" : "notas") +
      "</h2><p>" + esc(descricaoPeriodo()) + "</p></div>" +
      (faixa ? "" : '<button class="btn btn-suave" id="insightPeriodo">Insight do período</button>') + "</div>" +
    faixa + corpo +
    (cortou ? '<button class="btn btn-suave btn-largo" id="maisTempo" style="margin-top:14px">Mostrar mais ' +
      Math.min(40, totalPeriodo - notas.length) + " de " + (totalPeriodo - notas.length) + " restantes</button>" : "");
}

function rotuloDoDia(iso) {
  var d = new Date(iso), hoje = new Date();
  var umDia = 86400000;
  var dA = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  var dH = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  var diff = Math.round((dH - dA) / umDia);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  if (diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

function descricaoPeriodo() {
  if (S.periodo === "custom") {
    if (S.dataDe && S.dataAte) return "de " + S.dataDe.split("-").reverse().join("/") + " a " + S.dataAte.split("-").reverse().join("/");
    if (S.dataDe) return "a partir de " + S.dataDe.split("-").reverse().join("/");
    if (S.dataAte) return "até " + S.dataAte.split("-").reverse().join("/");
    return "escolha as datas";
  }
  var p = PERIODOS.filter(function (x) { return x.id === S.periodo; })[0];
  return p ? (p.id === "tudo" ? "todas as notas" : "últimos " + p.rot.toLowerCase()) : "";
}

/* --- Eventos --- */
function telaEventos() {
  if (S.eventos.length === 0) {
    return '<div class="vazio"><span class="emoji">📅</span><h3>Sem eventos próximos</h3>' +
      "<p>Escreva algo com data, tipo “reunião dia 12”, que vira lembrete.</p></div>";
  }
  return '<div class="cab-secao"><div><h2>Próximos 45 dias</h2><p>' + S.eventos.length + " " +
    (S.eventos.length === 1 ? "lembrete" : "lembretes") + "</p></div></div>" +
    '<div class="lista">' + S.eventos.map(function (n) { return cardNota(n); }).join("") + "</div>";
}

/* --- Busca --- */
function telaBusca() {
  if (S.resultadosBusca === "carregando") return esqueletos(2);
  var r = S.resultadosBusca || [];
  if (r.length === 0) {
    return '<div class="vazio"><span class="emoji">🔍</span><h3>Nada encontrado</h3>' +
      "<p>Tente outras palavras. A busca entende sentido, não só o texto exato.</p></div>";
  }
  var cabInsight = acoesDaBusca();
  return cabInsight +
    '<div class="cab-secao"><div><h2>Resultados</h2><p>' + r.length + " " +
    (r.length === 1 ? "nota" : "notas") + " por semelhança</p></div></div>" +
    '<div class="lista duas">' + r.map(function (n) { return cardNota(n, { score: n.score }); }).join("") + "</div>";
}

/* Bloco do insight: botao quando ainda nao pediu, estado de espera
   enquanto o modelo pensa, e o texto em paragrafos quando chega. */

/* ============================================================
   Detalhe
   ============================================================ */
function acharNota(id) {
  var achou = S.notas.filter(function (x) { return x.id === id; })[0];
  if (achou) return achou;
  var res = Array.isArray(S.resultadosBusca) ? S.resultadosBusca : [];
  return res.filter(function (x) { return x.id === id; })[0];
}

function abrirDetalhe(id) {
  var n = acharNota(id);
  if (!n) return;

  // relacionados sao { id, motivo, score }: mostramos o MOTIVO da ligacao
  var rel = relsDe(n).map(function (r) {
    var alvo = S.notas.filter(function (x) { return x.id === relId(r); })[0];
    return alvo ? { nota: alvo, motivo: (r && r.motivo) || "", score: (r && r.score) } : null;
  }).filter(Boolean);

  var blocos =
    (n.resumo ? '<div class="detalhe-bloco"><p class="detalhe-rot">Resumo</p><p class="detalhe-txt">' + esc(n.resumo) + "</p></div>" : "") +
    '<div class="detalhe-bloco"><p class="detalhe-rot">Texto original</p><p class="detalhe-txt">' + esc(n.texto_original) + "</p></div>" +
    (n.area ? '<div class="detalhe-bloco"><p class="detalhe-rot">Área</p><p class="detalhe-txt">' + esc(n.area) + "</p></div>" : "") +
    (n.data_evento ? '<div class="detalhe-bloco"><p class="detalhe-rot">Data</p><p class="detalhe-txt">' + esc(dataEvento(n.data_evento)) + "</p></div>" : "") +
    ((n.tags || []).length ? '<div class="detalhe-bloco"><p class="detalhe-rot">Tags</p><div class="tags">' +
      n.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div></div>" : "") +
    '<div class="detalhe-bloco"><p class="detalhe-rot">Guardada</p><p class="detalhe-txt">' +
      esc(new Date(n.criado_em).toLocaleString("pt-BR")) + "</p></div>";

  var ligacoes = rel.length
    ? '<p class="grupo-titulo">Ligada a ' + rel.length + " " + (rel.length === 1 ? "nota" : "notas") + '</p><div class="grupo">' +
      rel.map(function (r) {
        return '<button class="item" data-ir="' + esc(r.nota.id) + '">' +
          '<div class="item-txt"><strong>' + esc(r.nota.resumo || r.nota.texto_original) + "</strong>" +
          "<span>" + esc(r.nota.area || rotuloTipo(r.nota.tipo)) +
            (r.score != null ? " · " + Math.round(r.score * 100) + "%" : "") + "</span>" +
          (r.motivo ? "<em>" + esc(r.motivo) + "</em>" : "") + "</div>" +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".4"><path d="M9 6l6 6-6 6"/></svg>' +
          "</button>";
      }).join("") + "</div>"
    : '<p class="grupo-titulo">Sem ligações ainda</p><div class="grupo"><div class="detalhe-bloco">' +
      '<p class="detalhe-txt" style="color:var(--texto-2);font-size:15px">Guarde notas parecidas e elas se conectam sozinhas.</p></div></div>';

  abrirSheet(rotuloTipo(n.tipo),
    '<div class="grupo">' + blocos + "</div>" + ligacoes +
    '<div class="grupo"><button class="item destrutivo" id="btnApagar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
      '<div class="item-txt"><strong>Apagar nota</strong></div></button></div>');

  $("#btnApagar").addEventListener("click", function () { apagar(n.id); });
}

function apagar(id) {
  var alvo = $("#btnApagar");
  if (alvo.dataset.confirmar !== "1") {
    alvo.dataset.confirmar = "1";
    alvo.querySelector("strong").textContent = "Toque de novo para apagar";
    setTimeout(function () {
      if (!alvo.isConnected) return;
      alvo.dataset.confirmar = "";
      alvo.querySelector("strong").textContent = "Apagar nota";
    }, 3200);
    return;
  }
  api("/ideias/" + id, { method: "DELETE" }).then(function (r) {
    if (!r.ok && r.status !== 204) throw new Error("Não deu pra apagar.");
    S.recentes = S.recentes.filter(function (x) { return x !== id; });
    fecharSheet();
    return carregar().then(function () { avisar("Nota apagada."); });
  }).catch(function (e) { avisar(e.message); });
}

/* ============================================================
   Sugestoes de perguntas para insight
   ============================================================ */
function telaSugestoes(forcar, ids) {
  var recorte = Array.isArray(ids) && ids.length;
  abrirSheet(recorte ? "O que perguntar sobre estas notas" : "O que perguntar", esqueletos(2));
  var url = recorte
    ? "/insight/sugestoes?ids=" + encodeURIComponent(ids.join(","))
    : "/insight/sugestoes?ultimas=20";
  api(url + (forcar ? "&forcar=true" : ""))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) throw new Error(d.erro);
      if (!d.perguntas || !d.perguntas.length) {
        $("#sheetCorpo").innerHTML = '<div class="vazio"><h3>Ainda não dá</h3>' +
          "<p>Guarde algumas notas primeiro. As perguntas saem do que você escreveu.</p></div>";
        return;
      }
      $("#sheetCorpo").innerHTML =
        '<p class="grupo-titulo">' + (d.escopo === "selecao"
          ? "Baseado nas " + d.baseadoEm + " notas desta pesquisa"
          : "Baseado nas suas " + d.baseadoEm + " notas mais recentes") + "</p>" +
        '<div class="grupo">' + d.perguntas.map(function (p, i) {
          return '<button class="item" data-pergunta="' + esc(p.pergunta) + '">' +
            '<span class="num-sugestao">' + (i + 1) + "</span>" +
            '<div class="item-txt"><strong>' + esc(p.pergunta) + "</strong>" +
            (p.porque ? "<span>" + esc(p.porque) + "</span>" : "") + "</div>" +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".35"><path d="M9 6l6 6-6 6"/></svg>' +
            "</button>";
        }).join("") + "</div>" +
        '<button class="btn btn-suave btn-largo" id="btnOutrasSugestoes">Sugerir outras</button>' +
        (d.doCache ? '<p class="dica-compositor" style="display:block;text-align:center;margin-top:10px">' +
          "Reaproveitadas da última geração, pra não gastar cota à toa.</p>" : "");
      var o = $("#btnOutrasSugestoes");
      if (o) o.addEventListener("click", function () { telaSugestoes(true, ids); });
    })
    .catch(function (e) {
      $("#sheetCorpo").innerHTML = '<div class="vazio"><h3>Não deu certo</h3><p>' + esc(e.message) + "</p></div>";
    });
}

/* Toca numa pergunta: joga na busca e ja gera o insight daquele angulo. */
function usarPergunta(q) {
  fecharSheet();
  $("#campoBusca").value = q;
  S.busca = q;
  $("#caixaBusca").classList.add("tem-texto");
  S.resultadosBusca = "carregando";
  limparInsight();
  render();
  api("/pesquisa?q=" + encodeURIComponent(q) + "&limite=10")
    .then(function (r) { return r.json(); })
    .then(function (d) { S.resultadosBusca = d.resultados || []; render(); gerarInsight({ tipo: "busca", q: q }); })
    .catch(function () { S.resultadosBusca = []; render(); avisar("A busca falhou."); });
}

/* ============================================================
   Insight avancado (area / periodo / frase ou nada)
   ============================================================ */
// estado do formulario, preservado entre reaberturas do modal
var IA = { area: "", periodo: "30d", q: "", limite: 20, de: "", ate: "" };

function areasDisponiveis() {
  var conta = {};
  S.notas.forEach(function (n) { var a = n.area || ""; if (a) conta[a] = (conta[a] || 0) + 1; });
  return Object.keys(conta).sort(function (a, b) { return conta[b] - conta[a]; });
}

var IA_PERIODOS = [
  { id: "1d", rot: "Hoje" }, { id: "7d", rot: "7 dias" }, { id: "30d", rot: "30 dias" },
  { id: "90d", rot: "90 dias" }, { id: "tudo", rot: "Tudo" }, { id: "custom", rot: "Escolher" },
];
var IA_QTDS = [10, 20, 30, 40];

// pega o que o usuario ja digitou antes de um re-render do formulario
function lerFormIA() {
  var t = $("#iaQ"); if (t) IA.q = t.value;
  var a = $("#iaArea"); if (a) IA.area = a.value;
  var de = $("#iaDe"); if (de) IA.de = de.value;
  var ate = $("#iaAte"); if (ate) IA.ate = ate.value;
}

/* Replica no cliente a selecao que o backend faz em insightAvancado, pra dar um
   preview ao vivo. Filtro por area + periodo e identico ao servidor. A ordenacao
   por relevancia a frase NAO da pra fazer aqui (precisa de embedding), entao com
   frase mostramos o recorte inteiro como candidatas. */
function recorteIA() {
  var area = IA.area || "";
  var de = null, ate = null;
  if (IA.periodo === "custom") {
    de = IA.de ? new Date(IA.de + "T00:00:00").getTime() : null;
    ate = IA.ate ? new Date(IA.ate + "T23:59:59.999").getTime() : null;
  } else if (IA.periodo && IA.periodo !== "tudo") {
    var dias = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "365d": 365 }[IA.periodo];
    if (dias) de = Date.now() - dias * 86400000;
  }
  var pool = S.notas.filter(function (n) {
    if (area && (n.area || "") !== area) return false;
    var t = new Date(n.criado_em).getTime();
    if (isNaN(t)) return de === null && ate === null;
    if (de !== null && t < de) return false;
    if (ate !== null && t > ate) return false;
    return true;
  });
  // mais recentes primeiro (o backend usa slice(-lim).reverse())
  pool.sort(function (a, b) { return String(b.criado_em || "").localeCompare(String(a.criado_em || "")); });
  return pool;
}

// desenha o acordeon do preview a partir de uma lista de notas
function envelopePreviewIA(titulo, conta, cards, sobra) {
  return '<details class="notas-insight" open>' +
    "<summary>" +
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 6l6 6-6 6"/></svg>' +
      "<span>" + esc(titulo) + "</span>" +
      '<span class="conta">' + conta + "</span>" +
    "</summary>" +
    '<div class="lista duas">' + cards + "</div>" + (sobra || "") +
  "</details>";
}

// monta os cards olhando a nota completa em S.notas (pra ter texto/ligacoes),
// caindo no que veio do backend se a nota nao estiver em memoria
function cardsPreviewIA(lista) {
  return lista.map(function (ref) {
    var full = S.notas.filter(function (x) { return x.id === ref.id; })[0];
    var nota = full || { id: ref.id, resumo: ref.resumo, area: ref.area, texto_original: "" };
    return cardNota(nota, (ref.score != null ? { score: ref.score } : {}));
  }).join("");
}

function vazioPreviewIA() {
  guardarIdsPreviewIA([]);
  return '<div class="dica-compositor" style="display:block;text-align:center;margin:2px 2px 4px">' +
    "Nenhuma nota nesse recorte. Afrouxe a área ou o período.</div>";
}

// sem frase: exato e instantaneo (as mais recentes do recorte)
/* Os ids do que esta no preview ficam guardados: o sugeridor de formato manda
   eles em vez de refazer a selecao no servidor (economiza 1 embedding). */
function guardarIdsPreviewIA(lista) {
  IA_PREVIEW.ids = (lista || []).map(function (n) { return n && n.id; }).filter(Boolean);
}

function previewLocalHtmlIA() {
  var pool = recorteIA();
  var total = pool.length;
  if (total === 0) return vazioPreviewIA();
  var usadas = Math.min(IA.limite, total);
  var titulo = "As " + usadas + " mais recentes" + (total > usadas ? " de " + total : "");
  guardarIdsPreviewIA(pool.slice(0, IA.limite));
  return envelopePreviewIA(titulo, usadas, cardsPreviewIA(pool.slice(0, IA.limite)), "");
}

// com frase: mostra o que o servidor devolveu, ja ordenado por relevancia
function previewServidorHtmlIA(d) {
  var lista = (d && d.notas) || [];
  if (lista.length === 0) return vazioPreviewIA();
  var total = d.total || lista.length;
  var titulo = "As " + lista.length + " mais próximas da frase" + (total > lista.length ? " de " + total : "");
  guardarIdsPreviewIA(lista);
  return envelopePreviewIA(titulo, lista.length, cardsPreviewIA(lista), "");
}

function carregandoPreviewIA() {
  return '<div class="dica-compositor" style="display:block;text-align:center;margin:2px 2px 4px">' +
    "Procurando as notas mais próximas da frase…</div>";
}

function erroPreviewIA() {
  return '<div class="dica-compositor" style="display:block;text-align:center;margin:2px 2px 4px">' +
    "Não deu pra montar o preview agora. As notas certas ainda entram ao gerar.</div>";
}

// estado do debounce + guarda de corrida (respostas fora de ordem)
var IA_PREVIEW = { seq: 0, timer: null, ids: [] };

function montarPreviewIA() {
  lerFormIA();
  var box = $("#iaPreview");
  if (!box) return;

  var temFrase = !!(IA.q && IA.q.trim());
  IA_PREVIEW.seq++;                              // invalida resposta pendente
  if (IA_PREVIEW.timer) { clearTimeout(IA_PREVIEW.timer); IA_PREVIEW.timer = null; }

  if (!temFrase) {                               // instantaneo, de graca
    box.innerHTML = previewLocalHtmlIA();
    return;
  }

  // com frase: relevancia so o servidor calcula. Debounce pra nao chamar a cada tecla.
  box.innerHTML = carregandoPreviewIA();
  var meuSeq = IA_PREVIEW.seq;
  IA_PREVIEW.timer = setTimeout(function () { buscarPreviewIA(meuSeq); }, 450);
}

function buscarPreviewIA(meuSeq) {
  var params = [];
  var q = (IA.q || "").trim();
  if (q) params.push("q=" + encodeURIComponent(q));
  if (IA.area) params.push("area=" + encodeURIComponent(IA.area));
  if (IA.periodo === "custom") {
    if (IA.de) params.push("desde=" + encodeURIComponent(IA.de));
    if (IA.ate) params.push("ate=" + encodeURIComponent(IA.ate));
  } else if (IA.periodo && IA.periodo !== "tudo") {
    params.push("periodo=" + encodeURIComponent(IA.periodo));
  }
  params.push("limite=" + IA.limite);

  api("/insight/preview?" + params.join("&"))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (meuSeq !== IA_PREVIEW.seq) return;     // chegou tarde, ignora
      var box = $("#iaPreview");
      if (!box) return;
      box.innerHTML = d && d.erro ? erroPreviewIA() : previewServidorHtmlIA(d);
    })
    .catch(function () {
      if (meuSeq !== IA_PREVIEW.seq) return;
      var box = $("#iaPreview");
      if (box) box.innerHTML = erroPreviewIA();
    });
}

function telaInsightAvancado() {
  var opcoesArea = '<option value="">Todas as áreas</option>' + areasDisponiveis().map(function (a) {
    return '<option value="' + esc(a) + '"' + (IA.area === a ? " selected" : "") + ">" + esc(a) + "</option>";
  }).join("");

  var chipsPeriodo = '<div class="chips periodo">' + IA_PERIODOS.map(function (p) {
    return '<button type="button" class="chip' + (IA.periodo === p.id ? " ativo" : "") +
      '" data-ia-periodo="' + p.id + '">' + p.rot + "</button>";
  }).join("") + "</div>";

  var intervalo = IA.periodo === "custom"
    ? '<div class="intervalo"><label>De<input type="date" id="iaDe" value="' + esc(IA.de) + '" /></label>' +
      '<label>Até<input type="date" id="iaAte" value="' + esc(IA.ate) + '" /></label></div>'
    : "";

  var chipsQtd = '<div class="chips" style="padding-bottom:6px">' + IA_QTDS.map(function (q) {
    return '<button type="button" class="chip' + (IA.limite === q ? " ativo" : "") +
      '" data-ia-qtd="' + q + '">' + q + " notas</button>";
  }).join("") + "</div>";

  abrirSheet("Gerar insight",
    '<p class="grupo-titulo">Área</p>' +
    '<div class="campo-linha"><select id="iaArea" class="campo">' + opcoesArea + "</select></div>" +
    '<p class="grupo-titulo">Período</p>' + chipsPeriodo + intervalo +
    '<p class="grupo-titulo">Frase ou pergunta de base</p>' +
    '<div class="campo-linha"><textarea id="iaQ" class="campo" rows="2" ' +
      'placeholder="Opcional. Deixe vazio pra o modelo ler o recorte livremente.">' + esc(IA.q) + "</textarea></div>" +
    '<p class="dica-compositor" style="display:block;margin:0 2px 16px">Com uma frase, o insight foca nela. ' +
      "Sem nada, ele resume o que as notas do recorte dizem juntas.</p>" +
    '<p class="grupo-titulo">Quantas notas considerar</p>' + chipsQtd +
    secaoFormatoIA() +
    '<button class="btn btn-largo" id="iaGerar" style="margin-top:14px">Gerar insight</button>' +
    '<p class="grupo-titulo" style="margin-top:20px">Notas selecionadas</p>' +
    '<div id="iaPreview"></div>');

  var corpo = $("#sheetCorpo");
  corpo.querySelectorAll("[data-ia-periodo]").forEach(function (b) {
    b.addEventListener("click", function () { lerFormIA(); IA.periodo = b.dataset.iaPeriodo; telaInsightAvancado(); });
  });
  // quantidade atualiza em lugar, sem re-render, pra nao resetar o scroll do modal
  corpo.querySelectorAll("[data-ia-qtd]").forEach(function (b) {
    b.addEventListener("click", function () {
      lerFormIA();
      IA.limite = Number(b.dataset.iaQtd);
      corpo.querySelectorAll("[data-ia-qtd]").forEach(function (x) {
        x.classList.toggle("ativo", Number(x.dataset.iaQtd) === IA.limite);
      });
      montarPreviewIA();
    });
  });
  // area, frase e datas customizadas atualizam o preview ao vivo
  var selArea = $("#iaArea");
  if (selArea) selArea.addEventListener("change", function () { IA.area = selArea.value; montarPreviewIA(); });
  var campoQ = $("#iaQ");
  if (campoQ) campoQ.addEventListener("input", function () { IA.q = campoQ.value; montarPreviewIA(); });
  var campoDe = $("#iaDe");
  if (campoDe) campoDe.addEventListener("change", function () { IA.de = campoDe.value; montarPreviewIA(); });
  var campoAte = $("#iaAte");
  if (campoAte) campoAte.addEventListener("change", function () { IA.ate = campoAte.value; montarPreviewIA(); });

  ligarSecaoFormatoIA(corpo); // definido em insight.js

  var g = $("#iaGerar");
  if (g) g.addEventListener("click", gerarInsightAvancado);

  montarPreviewIA();
}

/* ============================================================
   Menu
   ============================================================ */
function abrirMenu() {
  var tema = document.documentElement.dataset.tema;
  var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg>';
  var opcoesTema = Object.keys(TEMAS).map(function (k) {
    return '<button class="item" data-tema="' + k + '"><div class="item-txt"><strong>' + TEMAS[k] + "</strong></div>" +
      (tema === k ? check : "") + "</button>";
  }).join("");

  abrirSheet("Opções",
    '<p class="grupo-titulo">Aparência</p><div class="grupo">' + opcoesTema + "</div>" +
    '<p class="grupo-titulo">Suas notas</p><div class="grupo">' +
      '<button class="item" id="mGarimpo">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h11M4 9.5h8M4 14h6"/><path d="M14.5 14.5l5 5"/><circle cx="12.8" cy="12.8" r="3.4"/></svg>' +
      '<div class="item-txt"><strong>Garimpar ideias</strong><span>Extrai várias notas de um texto e você escolhe</span></div></button>' +
      '<button class="item" id="mSinapse">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="7" r="2.4"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="13" r="2.6"/><circle cx="5" cy="18" r="2"/><path d="M7.9 8.4l2.4 3M14.2 12.2l2.4-4.5M10.4 14.6L6.6 16.6" stroke-linecap="round" opacity=".6"/></svg>' +
      '<div class="item-txt"><strong>Visão sináptica</strong><span>O mapa 3D das ligações</span></div></button>' +
      '<button class="item" id="mInsightAvancado">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v1.5M5.2 5.2l1 1M3 12h1.5M18.8 5.2l-1 1M21 12h-1.5"/><path d="M9.2 17.5h5.6M10 21h4"/><path d="M12 7a5 5 0 00-2.8 9.1V17.5h5.6V16.1A5 5 0 0012 7z"/></svg>' +
      '<div class="item-txt"><strong>Gerar insight</strong><span>Por área, por período, com uma frase ou sem nada</span></div></button>' +
      '<button class="item" id="mSugestoes">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9.5 17.5h5M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9V17.5h7V13.9A6 6 0 0012 3z"/></svg>' +
      '<div class="item-txt"><strong>O que perguntar</strong><span>10 perguntas tiradas das suas notas</span></div></button>' +
      '<button class="item" id="mRelink">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 0113.7-5.7L20 8M20 12a8 8 0 01-13.7 5.7L4 16"/><path d="M20 4v4h-4M4 20v-4h4"/></svg>' +
      '<div class="item-txt"><strong>Reconstruir ligações</strong><span>Recalcula as conexões entre todas as notas</span></div></button>' +
    "</div>" +
    '<p class="grupo-titulo">Arquivo</p><div class="grupo">' +
      '<button class="item" id="mBaixar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg>' +
      '<div class="item-txt"><strong>Baixar backup</strong><span>Salva tudo num arquivo</span></div></button>' +
      '<button class="item" id="mRestaurar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20V9M8 13l4-4 4 4M5 4h14"/></svg>' +
      '<div class="item-txt"><strong>Restaurar backup</strong><span>Substituir ou juntar com o que já existe</span></div></button>' +
      '<button class="item" id="mArmazenamento">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" stroke-linecap="round"/></svg>' +
      '<div class="item-txt"><strong>Armazenamento</strong><span>Espaço e limpeza do arquivo</span></div></button>' +
    "</div>");

  $("#sheetCorpo").querySelectorAll("[data-tema]").forEach(function (b) {
    b.addEventListener("click", function () { aplicarTema(b.dataset.tema); abrirMenu(); });
  });
  // definido em garimpo.js, carregado depois deste arquivo
  $("#mGarimpo").addEventListener("click", function () { telaGarimpo(); });
  $("#mSinapse").addEventListener("click", function () { fecharSheet(); abrirSinapse(); });
  $("#mInsightAvancado").addEventListener("click", function () {
    // se ja tem uma area filtrada na tela, o modal ja abre com ela escolhida
    if (S.filtroArea) IA.area = S.filtroArea;
    fecharSheet(); telaInsightAvancado();
  });
  $("#mSugestoes").addEventListener("click", function () { fecharSheet(); telaSugestoes(false); });
  $("#mRelink").addEventListener("click", relink);
  $("#mBaixar").addEventListener("click", baixarBackup);
  $("#mRestaurar").addEventListener("click", telaRestaurar);
  $("#mArmazenamento").addEventListener("click", telaArmazenamento);
}
$("#btnMenu").addEventListener("click", abrirMenu);

/* O relink faz uma chamada de LLM por nota: numa base grande leva minutos e
   pode esbarrar no limite do provedor. Por isso ele roda em background no
   servidor e aqui a gente acompanha por polling, mostrando o progresso em vez
   de deixar a pessoa achando que travou. */
function relink() {
  api("/relink", { method: "POST" })
    .then(function (r) {
      return r.json().then(function (d) {
        if (r.status === 409) throw new Error(d.erro || "Já existe uma reconstrução em andamento.");
        if (!r.ok) throw new Error(d.erro || "Não deu pra iniciar.");
        telaRelink(d.jobId);
      });
    })
    .catch(function (e) { avisar(e.message); });
}

function telaRelink(jobId) {
  abrirSheet("Reconstruindo ligações", corpoRelink({ fase: "preparando", feito: 0, total: 0 }));
  acompanharRelink(jobId);
}

function corpoRelink(p) {
  var pct = p.total > 0 ? Math.round((p.feito / p.total) * 100) : 0;
  var rotulo = {
    preparando: "Preparando…",
    embeddings: "Etapa 1 de 2 · relendo suas notas",
    relacoes: "Etapa 2 de 2 · descobrindo as ligações",
    concluido: "Pronto!",
  }[p.fase] || p.fase;

  var tempo = "";
  if (p.fase === "relacoes" && p.restanteSegundos != null && p.restanteSegundos > 0) {
    var m = Math.floor(p.restanteSegundos / 60), sg = p.restanteSegundos % 60;
    tempo = m > 0 ? "cerca de " + m + " min restantes" : "cerca de " + sg + "s restantes";
  }

  return '<div class="grupo" style="padding:16px">' +
      '<p class="relink-fase">' + esc(rotulo) + "</p>" +
      '<div class="barra-prog"><div class="barra-prog-cheia" style="width:' + pct + '%"></div></div>' +
      '<div class="relink-linha"><span>' + (p.total ? p.feito + " de " + p.total + " notas" : "iniciando…") +
        "</span><span>" + pct + "%</span></div>" +
      (tempo ? '<p class="relink-tempo">' + esc(tempo) + "</p>" : "") +
      (p.falhas ? '<p class="relink-falhas">' + p.falhas + " nota(s) falharam e serão ignoradas.</p>" : "") +
    "</div>" +
    '<p class="dica-compositor" style="display:block;text-align:center">' +
      "Pode fechar esta janela: o processo continua no servidor.</p>";
}

function acompanharRelink(jobId) {
  var parar = false;
  var tick = function () {
    if (parar) return;
    api("/relink/status/" + jobId)
      .then(function (r) { return r.json(); })
      .then(function (t) {
        if (t.erro && t.estado !== "erro") throw new Error(t.erro);
        var aberto = $("#sheet").classList.contains("aberto") &&
          $("#sheetTitulo").textContent.indexOf("Reconstruindo") === 0;

        if (t.estado === "rodando") {
          if (aberto) $("#sheetCorpo").innerHTML = corpoRelink(t);
          setTimeout(tick, 1200);
          return;
        }
        parar = true;
        if (t.estado === "erro") {
          if (aberto) fecharSheet();
          avisar(t.erro || "A reconstrução falhou.");
          return;
        }
        // concluido
        if (aberto) $("#sheetCorpo").innerHTML = corpoRelink({ ...t, fase: "concluido", feito: t.total || t.feito });
        carregar().then(function () {
          var res = t.resumo || {};
          avisar(
            "Ligações reconstruídas: " + (res.relacoes || 0) + " conexões" +
            (res.falhas ? " (" + res.falhas + " falha(s))" : "") + "."
          );
          setTimeout(function () {
            if ($("#sheetTitulo").textContent.indexOf("Reconstruindo") === 0) fecharSheet();
          }, 1500);
        });
      })
      .catch(function (e) { parar = true; avisar(e.message || "Perdi o acompanhamento da reconstrução."); });
  };
  tick();
}


function baixarBackup() {
  var a = document.createElement("a");
  a.href = "/backup"; a.download = "";
  document.body.appendChild(a); a.click(); a.remove();
  fecharSheet();
  avisar("Backup baixado.");
}

function telaArmazenamento() {
  abrirSheet("Armazenamento", esqueletos(1));
  api("/armazenamento").then(function (r) { return r.json(); }).then(function (d) {
    S.armazenamento = d.armazenamento || null;
    var a = S.armazenamento;

    /* A tela antiga era do motor de ARQUIVO: lia d.bytes e d.registrosNoArquivo,
       que nao existem no Supabase, entao mostrava "NaN KB". E oferecia limpar
       historico do arquivo, que aqui nao quer dizer nada. */
    if (!a) {
      $("#sheetCorpo").innerHTML =
        '<div class="grupo"><div class="item"><div class="item-txt"><strong>Notas</strong></div>' +
        '<span class="valor">' + d.ideias + "</span></div></div>" +
        '<div class="vazio"><p>O tamanho em bytes precisa da função <code>armazenamento()</code> no banco. ' +
        "Rode <code>supabase/armazenamento.sql</code> no SQL Editor.</p>" +
        (d.armazenamento_erro ? "<p>" + esc(d.armazenamento_erro) + "</p>" : "") + "</div>";
      return;
    }

    var tabelas = a.tabelas || [];
    var mortas = tabelas.reduce(function (t, x) { return t + (x.linhas_mortas || 0); }, 0);
    var vivas = tabelas.reduce(function (t, x) { return t + (x.linhas || 0); }, 0);

    $("#sheetCorpo").innerHTML =
      '<div class="grupo">' +
        '<div class="item"><div class="item-txt"><strong>Notas</strong></div><span class="valor">' + d.ideias + "</span></div>" +
        '<div class="item"><div class="item-txt"><strong>Suas tabelas</strong><span>O que você de fato ocupa</span></div>' +
          '<span class="valor">' + esc(tamanhoBonito(a.seu_bytes) || a.seu || "?") + "</span></div>" +
        '<div class="item"><div class="item-txt"><strong>Banco inteiro</strong><span>Inclui o que o Supabase instala sozinho</span></div>' +
          '<span class="valor">' + esc(tamanhoBonito(a.banco_bytes) || a.banco || "?") + "</span></div>" +
      "</div>" +
      '<p class="grupo-titulo">Por tabela</p>' +
      '<div class="grupo">' +
      tabelas.map(function (t) {
        return '<div class="item"><div class="item-txt"><strong>' + esc(t.nome) + "</strong><span>" +
          (t.linhas || 0) + " linhas · dados " + esc(t.dados) + " · índices " + esc(t.indices) +
          " · toast " + esc(t.toast) +
          (t.bytes_por_linha ? " · " + Math.round(t.bytes_por_linha / 1024 * 10) / 10 + " KB por linha" : "") +
          "</span></div><span class=\"valor\">" + esc(tamanhoBonito(t.total_bytes) || t.total) + "</span></div>";
      }).join("") +
      "</div>" +
      (mortas > 0 && vivas > 0 && mortas / vivas > 0.2
        ? '<div class="vazio"><p>' + mortas + " linhas mortas para " + vivas +
          " vivas. É espaço de versões antigas ainda não recolhido. Rode <code>vacuum analyze ideias;</code> no SQL Editor.</p></div>"
        : "") +
      '<p class="grupo-titulo">Medido em ' + esc(a.medido_em || "") + "</p>";
  }).catch(function () {
    $("#sheetCorpo").innerHTML = '<div class="vazio"><h3>Não deu pra ler</h3><p>O armazenamento não respondeu.</p></div>';
  });
}

function telaRestaurar() {
  abrirSheet("Restaurar backup",
    '<p class="grupo-titulo">Como juntar</p><div class="opcoes-radio" style="margin-bottom:18px">' +
      '<label class="op-radio"><input type="radio" name="modo" value="mesclar" checked />' +
      '<div class="txt"><strong>Juntar com as atuais</strong><span>Mantém as duas; em conflito vale a mais recente</span></div></label>' +
      '<label class="op-radio"><input type="radio" name="modo" value="substituir" />' +
      '<div class="txt"><strong>Substituir tudo</strong><span>Apaga as atuais e usa só as do arquivo</span></div></label>' +
    "</div>" +
    '<button class="btn btn-suave btn-largo" id="mEscolher" style="margin-bottom:10px">Escolher arquivo…</button>' +
    '<p class="dica-compositor" style="display:block;text-align:center;margin-bottom:18px">Mostramos o que muda antes de aplicar.</p>' +
    '<div id="areaRelatorio"></div>');
  $("#mEscolher").addEventListener("click", function () { $("#arquivoBackup").click(); });
}

$("#arquivoBackup").addEventListener("change", function (ev) {
  var arq = ev.target.files[0];
  if (!arq) return;
  var sel = document.querySelector('input[name="modo"]:checked');
  var modo = sel ? sel.value : "mesclar";
  var area = $("#areaRelatorio");
  if (!area) { ev.target.value = ""; return; }
  area.innerHTML = esqueletos(1);

  arq.arrayBuffer().then(function (buf) {
    return api("/restore?modo=" + modo + "&simular=true", {
      method: "POST", headers: { "content-type": "application/octet-stream" }, body: buf,
    }).then(function (r) { return r.json(); }).then(function (sim) {
      if (sim.erro) throw new Error(sim.erro);
      area.innerHTML =
        '<div class="grupo">' +
          '<div class="item"><div class="item-txt"><strong>Notas agora</strong></div><span class="valor">' + sim.antes.ideias + "</span></div>" +
          '<div class="item"><div class="item-txt"><strong>Depois de aplicar</strong></div><span class="valor">' + sim.depois.ideias + "</span></div>" +
          (sim.entraram !== undefined ? '<div class="item"><div class="item-txt"><strong>Entram do arquivo</strong></div><span class="valor">' + sim.entraram + "</span></div>" : "") +
          (sim.conflitos && sim.conflitos.length ? '<div class="item"><div class="item-txt"><strong>Conflitos</strong><span>Resolvidos pela data mais recente</span></div><span class="valor">' + sim.conflitos.length + "</span></div>" : "") +
        "</div><button class=\"btn btn-largo\" id=\"mAplicar\">Aplicar</button>";
      $("#mAplicar").addEventListener("click", function (e) {
        e.target.textContent = "Aplicando…";
        e.target.disabled = true;
        api("/restore?modo=" + modo, {
          method: "POST", headers: { "content-type": "application/octet-stream" }, body: buf,
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.erro) throw new Error(d.erro);
          fecharSheet();
          return carregar().then(function () {
            avisar(modo === "mesclar" ? "Backup juntado." : "Backup restaurado.");
          });
        }).catch(function (err) { avisar(err.message); });
      });
    });
  }).catch(function (e) {
    area.innerHTML = '<div class="vazio"><h3>Arquivo não aceito</h3><p>' + esc(e.message) + "</p></div>";
  }).then(function () { ev.target.value = ""; });
});

/* ============================================================
   Interface
   ============================================================ */
function ajustarAltura() {
  var t = $("#campoNota");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 220) + "px";
}
$("#campoNota").addEventListener("input", function () {
  ajustarAltura();
  $("#btnAdicionar").disabled = !$("#campoNota").value.trim();
});
$("#campoNota").addEventListener("keydown", function (e) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") adicionar();
});
$("#btnAdicionar").addEventListener("click", adicionar);

var buscaTimer;
$("#campoBusca").addEventListener("input", function (e) {
  var v = e.target.value.trim();
  S.busca = v;
  $("#caixaBusca").classList.toggle("tem-texto", !!v);
  clearTimeout(buscaTimer);
  buscaTimer = setTimeout(function () { buscar(v); }, 350);
});
$("#btnLimpar").addEventListener("click", function () {
  $("#campoBusca").value = "";
  S.busca = ""; S.resultadosBusca = null; limparInsight();
  $("#caixaBusca").classList.remove("tem-texto");
  render();
});

function trocarAba(nome) {
  S.aba = nome;
  S.areaAberta = null;
  S.limiteTempo = 40;
  $("#abas").querySelectorAll("button").forEach(function (x) {
    x.classList.toggle("ativo", x.dataset.aba === nome);
  });
  moverIndicador();
}
function moverIndicador() {
  var ativo = $("#abas").querySelector("button.ativo");
  var ind = $("#indicadorAba");
  if (!ativo) return;
  ind.style.width = ativo.offsetWidth + "px";
  ind.style.transform = "translateX(" + (ativo.offsetLeft - 2) + "px)";
}
$("#abas").querySelectorAll("button").forEach(function (b) {
  b.addEventListener("click", function () { trocarAba(b.dataset.aba); render(); });
});
document.addEventListener("change", function (ev) {
  if (ev.target.id === "dataDe") { S.dataDe = ev.target.value; render(); }
  if (ev.target.id === "dataAte") { S.dataAte = ev.target.value; render(); }
});
window.addEventListener("resize", moverIndicador);
var _rolou = false;
addEventListener("scroll", function () {
  var agora = scrollY > 28;
  if (agora === _rolou) return;   // evita tocar no DOM a cada pixel rolado
  _rolou = agora;
  $("#barra").classList.toggle("rolou", agora);
}, { passive: true });

requestAnimationFrame(moverIndicador);
carregar();
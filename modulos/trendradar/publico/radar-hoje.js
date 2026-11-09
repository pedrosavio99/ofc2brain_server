/**
 * "Hoje no radar": a parte VIVA do TrendRadar.
 *
 * Mostra o que mudou desde a sua ultima visita: sinais novos que o radar achou
 * sozinho (com as manchetes que os sustentam e a nota SUA que combina), e as
 * oportunidades que estao subindo ou esfriando na imprensa. Cada sinal pode ser
 * investigado, salvo, descartado ou levado pra conversa.
 *
 * Se os dados tem mais de 14 horas, dispara uma coleta sozinho (uma por sessao),
 * entao o radar muda mesmo sem o cron.
 *
 * Script classico: usa `estado`, `esc`, `mostrarToast`, `carregarDadosRadar` e
 * `abrirDossie6Perguntas` do trendradar.js. Tudo que vem do servidor entra por
 * esc() ou textContent; link so se for http(s).
 */
(function () {
  "use strict";

  var CHAVE_VISITA = "tr_ultima_visita_v1";
  var CHAVE_COLETA = "tr_coleta_tentada_v1";
  var NOME_FRENTE = {
    saude: "Saúde", fintech: "FinTech", regtech: "RegTech", govtech: "GovTech",
    operacoes: "Obras & Campo", ia_devtools: "IA & Dev"
  };

  var raiz = null;
  var visitaAnterior = 0;
  var dados = null;
  var atualizando = false;

  function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function gravar(chave, v) { try { localStorage.setItem(chave, v); } catch (e) {} }

  function esc2(t) { return typeof esc === "function" ? esc(t) : String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  function urlSegura(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }

  function dataCurta(iso) {
    var p = String(iso || "").slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] : "";
  }

  function quandoColetou(ms) {
    if (!ms) return "ainda não coletado";
    var min = Math.round((Date.now() - ms) / 60000);
    if (min < 2) return "agora há pouco";
    if (min < 60) return "há " + min + " min";
    var h = Math.round(min / 60);
    if (h < 24) return "há " + h + " h";
    var d = Math.round(h / 24);
    return "há " + d + (d === 1 ? " dia" : " dias");
  }

  async function chamar(caminho, opcoes, limiteMs) {
    var ctrl = new AbortController();
    var rel = setTimeout(function () { ctrl.abort(); }, limiteMs || 30000);
    try {
      var o = Object.assign({ headers: { Accept: "application/json" } }, opcoes || {});
      o.signal = ctrl.signal;
      var r = await fetch("/trendradar/api" + caminho, o);
      var j = await r.json();
      if (!r.ok || j.erro) throw new Error(j.erro || "Falha na requisição.");
      return j;
    } finally { clearTimeout(rel); }
  }

  function corpoJson(obj) {
    return { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(obj || {}) };
  }

  /* --------------------------------------------------------------- render */

  function htmlSinal(d) {
    var novo = visitaAnterior && Date.parse(d.criado_em) > visitaAnterior;
    var fontes = (d.sinais || []).slice(0, 2).map(function (s) {
      var u = urlSegura(s.url);
      var titulo = esc2(s.titulo);
      var link = u ? '<a href="' + esc2(u) + '" target="_blank" rel="noopener noreferrer">' + titulo + "</a>" : titulo;
      return "<li>" + link + '<span class="tr-sinal-fonte">' + esc2(s.fonte) + (s.data ? " · " + esc2(dataCurta(s.data)) : "") + "</span></li>";
    }).join("");
    var afin = d.afinidade && d.afinidade.resumo
      ? '<p class="tr-sinal-afin"><strong>Combina com você:</strong> sua nota de ' + esc2(dataCurta(d.afinidade.data)) + ' — “' + esc2(d.afinidade.resumo) + "”</p>"
      : "";
    return '<article class="tr-sinal" data-id="' + esc2(d.id) + '">' +
      '<div class="tr-sinal-topo"><span class="tr-sinal-frente">' + esc2(NOME_FRENTE[d.frente] || d.frente) + "</span>" +
      (novo ? '<span class="tr-sinal-novo">novo</span>' : "") + "</div>" +
      '<h3 class="tr-sinal-titulo">' + esc2(d.titulo) + "</h3>" +
      '<p class="tr-sinal-agora">' + esc2(d.porque_agora) + "</p>" +
      (d.dor ? '<p class="tr-sinal-dor">' + esc2(d.dor) + "</p>" : "") +
      (fontes ? '<ul class="tr-sinal-fontes">' + fontes + "</ul>" : "") + afin +
      '<div class="tr-sinal-acoes">' +
      '<button type="button" class="tr-btn-primario-card" data-acao="rh-investigar" data-id="' + esc2(d.id) + '">Investigar</button>' +
      '<button type="button" class="tr-btn-acao-card" data-acao="rh-conversar" data-id="' + esc2(d.id) + '">Conversar</button>' +
      '<button type="button" class="tr-btn-acao-card" data-acao="rh-salvar" data-id="' + esc2(d.id) + '">Salvar</button>' +
      '<button type="button" class="tr-btn-acao-card tr-btn-discreto" data-acao="rh-descartar" data-id="' + esc2(d.id) + '">Descartar</button>' +
      "</div></article>";
  }

  function htmlMovimento(m) {
    var sobe = m.estado === "subindo";
    var u = m.manchete && urlSegura(m.manchete.url);
    var manchete = m.manchete
      ? '<span class="tr-mov-manchete">' + (u ? '<a href="' + esc2(u) + '" target="_blank" rel="noopener noreferrer">' + esc2(m.manchete.titulo) + "</a>" : esc2(m.manchete.titulo)) +
        " <em>" + esc2(m.manchete.fonte) + "</em></span>"
      : "";
    return '<div class="tr-mov ' + (sobe ? "sobe" : "desce") + '" data-acao="abrir-dossie" data-id="' + esc2(m.id) + '">' +
      '<span class="tr-mov-pct">' + (sobe ? "▲" : "▼") + " " + (m.variacaoPct > 0 ? "+" : "") + m.variacaoPct + "%</span>" +
      '<div class="tr-mov-corpo"><strong>' + esc2(m.nome) + "</strong>" +
      '<span class="tr-mov-sub">' + m.mencoes7d + " matérias em 7 dias, contra " + m.anteriores + " nos 7 anteriores</span>" + manchete + "</div></div>";
  }

  function desenhar() {
    if (!raiz) return;
    if (!dados) { raiz.hidden = true; return; }
    var r = dados.resumo || {};
    var temAlgo = (dados.novas || []).length || (dados.movimentos || []).length;
    var chips = [];
    if (r.novas) chips.push('<span class="tr-hoje-chip novo">' + r.novas + (r.novas === 1 ? " sinal novo" : " sinais novos") + "</span>");
    if (r.subindo) chips.push('<span class="tr-hoje-chip sobe">▲ ' + r.subindo + " subindo</span>");
    if (r.esfriando) chips.push('<span class="tr-hoje-chip desce">▼ ' + r.esfriando + " esfriando</span>");

    var aviso = "";
    if (dados.banco && dados.banco.ok === false) {
      aviso = '<p class="tr-hoje-aviso">O histórico ainda não está sendo guardado. ' + esc2(dados.banco.dica || "") + "</p>";
    }
    var vazio = !temAlgo
      ? '<p class="tr-hoje-vazio">' + (atualizando ? "Buscando sinais na imprensa…" : "Nada se mexeu desde a última coleta. Volte amanhã: o radar olha de novo sozinho.") + "</p>"
      : "";

    raiz.hidden = false;
    raiz.innerHTML =
      '<div class="tr-hoje-cab"><div><h2 class="tr-hoje-titulo">Hoje no radar</h2>' +
      '<span class="tr-hoje-meta">' + (atualizando ? "Atualizando sinais…" : "Coletado " + esc2(quandoColetou(dados.coletadoEm))) + "</span></div>" +
      '<button type="button" class="icone-btn" data-acao="rh-atualizar" title="Buscar sinais agora" aria-label="Buscar sinais agora"' + (atualizando ? " disabled" : "") + ">" +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 6"/><path d="M20 5v6h-6"/></svg></button></div>' +
      (chips.length ? '<div class="tr-hoje-chips">' + chips.join("") + "</div>" : "") + aviso + vazio +
      ((dados.novas || []).length ? '<div class="tr-sinais">' + dados.novas.map(htmlSinal).join("") + "</div>" : "") +
      ((dados.movimentos || []).length
        ? '<h3 class="tr-hoje-sub">Movimento na imprensa</h3><div class="tr-movs">' + dados.movimentos.map(htmlMovimento).join("") + "</div>"
        : "");
  }

  /* ------------------------------------------------------------- dados */

  async function carregar() {
    try {
      dados = await chamar("/hoje", null, 20000);
    } catch (e) {
      dados = null;
    }
    desenhar();
  }

  async function coletar(forcar) {
    if (atualizando) return;
    atualizando = true; desenhar();
    try {
      var r = await chamar("/coletar", corpoJson({ forcar: Boolean(forcar) }), 65000);
      if (forcar && !r.pulada && typeof mostrarToast === "function") {
        mostrarToast((r.novas || 0) + " sinais novos, " + (r.itens || 0) + " oportunidades medidas");
      }
    } catch (e) {
      if (typeof mostrarToast === "function") mostrarToast("Não consegui buscar agora: " + e.message);
    }
    atualizando = false;
    await carregar();
    // o ranking da lista usa o pulso: recarrega pra reordenar
    if (typeof carregarDadosRadar === "function") carregarDadosRadar(true, true);
  }

  function sinalPorId(id) {
    return ((dados && dados.novas) || []).filter(function (d) { return d.id === id; })[0];
  }

  function tirarCartao(id) {
    var el = raiz.querySelector('.tr-sinal[data-id="' + id + '"]');
    if (el) { el.classList.add("saindo"); setTimeout(function () { carregar(); }, 260); }
  }

  async function aoClicar(e) {
    // link de manchete abre a materia e nao deve abrir o dossie por baixo
    if (e.target.closest("a") && raiz.contains(e.target)) { e.stopPropagation(); return; }
    var b = e.target.closest("[data-acao^='rh-']");
    if (!b || !raiz.contains(b)) return;
    e.stopPropagation();
    var acao = b.dataset.acao, id = b.dataset.id;

    if (acao === "rh-atualizar") { coletar(true); return; }

    if (acao === "rh-conversar") {
      var d = sinalPorId(id);
      if (!d) return;
      var fim = function (t) { return /[.!?]$/.test(t) ? t : t + "."; };
      var porque = String(d.porque_agora || "").trim();
      if (porque.length > 150) porque = porque.slice(0, 150).replace(/\s+\S*$/, "") + "…";
      var msg = "Vi no radar: " + fim(String(d.titulo || "").trim()) + " " + (porque ? fim(porque) + " " : "") + "Vale a pena pra mim? Me ajuda a pensar.";
      location.href = "/conversa?abrir=" + encodeURIComponent(msg);
      return;
    }

    if (acao === "rh-salvar" || acao === "rh-descartar") {
      b.disabled = true;
      try {
        await chamar("/descobertas", Object.assign(corpoJson({ id: id, status: acao === "rh-salvar" ? "salva" : "descartada" }), { method: "PATCH" }), 15000);
        if (typeof mostrarToast === "function") mostrarToast(acao === "rh-salvar" ? "Salvo pra depois." : "Descartado. Não volta mais.");
        tirarCartao(id);
      } catch (err) { b.disabled = false; if (typeof mostrarToast === "function") mostrarToast(err.message); }
      return;
    }

    if (acao === "rh-investigar") {
      var txt = b.textContent;
      b.disabled = true; b.textContent = "Investigando…";
      try {
        var r = await chamar("/descobertas/investigar", corpoJson({ id: id }), 70000);
        if (typeof mostrarToast === "function") mostrarToast("Dossiê pronto.");
        await carregar();
        if (typeof carregarDadosRadar === "function") await carregarDadosRadar(true, true);
        if (r.item && typeof abrirDossie6Perguntas === "function") abrirDossie6Perguntas(r.item.id);
      } catch (err) {
        b.disabled = false; b.textContent = txt;
        if (typeof mostrarToast === "function") mostrarToast("Não deu pra investigar: " + err.message);
      }
    }
  }

  /* ---------------------------------------------------------------- init */

  async function iniciar() {
    raiz = document.getElementById("radarHoje");
    if (!raiz) return;
    visitaAnterior = Number(ler(CHAVE_VISITA)) || 0;
    raiz.addEventListener("click", aoClicar);

    await carregar();
    // marca a visita DEPOIS de desenhar: o "novo" compara com a visita anterior
    gravar(CHAVE_VISITA, String(Date.now()));

    // dados velhos: uma coleta por sessao, sem travar a tela
    var jaTentou = false;
    try { jaTentou = sessionStorage.getItem(CHAVE_COLETA) === "1"; } catch (e) {}
    if (dados && dados.defasado && !jaTentou) {
      try { sessionStorage.setItem(CHAVE_COLETA, "1"); } catch (e) {}
      coletar(false);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();

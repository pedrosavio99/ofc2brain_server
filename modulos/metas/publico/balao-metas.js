/* Modulo METAS - balao flutuante com as metas do dia.
 *
 * Entra por UMA linha de <script> na pagina. Injeta o proprio CSS e o proprio
 * markup, entao nao ha HTML pra manter em paralelo.
 *
 * Nao sabe o que e Duolingo nem Treino: desenha o formato que /metas/api/hoje
 * devolve (estado, titulo, detalhe, imagem, destaque, link). Meta nova no
 * servidor aparece aqui sem mudar este arquivo.
 *
 * O fetch passa pelo pin.js, que precisa estar carregado ANTES deste script.
 */
(function () {
  "use strict";

  var API = "/metas/api/hoje";
  var ICONE = "/cerebro-mini.svg";
  // reabrir o painel depois disso busca de novo; antes, usa o que ja tem
  var VALIDADE_MS = 60 * 1000;

  if (document.getElementById("balaoMetas")) return;

  var css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/metas/balao-metas.css";
  document.head.appendChild(css);

  var raiz = document.createElement("div");
  raiz.id = "balaoMetas";
  raiz.className = "bm";
  raiz.innerHTML =
    '<div class="bm-painel" id="bmPainel" role="dialog" aria-label="Metas de hoje">' +
      '<div class="bm-cab"><strong>Metas de hoje</strong><span id="bmResumo"></span></div>' +
      '<ul class="bm-lista" id="bmLista"><li class="bm-aviso">Carregando…</li></ul>' +
    "</div>" +
    '<button class="bm-botao" id="bmBotao" type="button" aria-expanded="false" ' +
      'aria-controls="bmPainel" aria-label="Metas de hoje">' +
      '<img src="' + ICONE + '" alt="" draggable="false" />' +
      '<span class="bm-selo" id="bmSelo" hidden></span>' +
    "</button>";
  document.body.appendChild(raiz);

  var botao = document.getElementById("bmBotao");
  var selo = document.getElementById("bmSelo");
  var lista = document.getElementById("bmLista");
  var resumo = document.getElementById("bmResumo");

  var dados = null;
  var buscadoEm = 0;
  var emVoo = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var MARCA = { feita: "✓", andamento: "…", pendente: "", erro: "!" };
  var ROTULO_ESTADO = { feita: "feita", andamento: "em andamento", pendente: "pendente", erro: "não verificada" };
  // marcador generico quando a meta nao manda imagem
  var ALVO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>';

  function figura(m) {
    var d = m.destaque || {};
    var fogo = d.tipo === "ofensiva"
      ? '<span class="bm-fogo' + (d.ativo ? "" : " apagado") + '">' +
          '<span class="bm-chama">🔥</span>' + esc(d.valor) + "</span>"
      : "";
    var dentro = m.imagem
      ? '<img src="' + esc(m.imagem) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
      : ALVO;
    return '<span class="bm-figura">' + dentro + fogo + "</span>";
  }

  function item(m) {
    var estado = MARCA.hasOwnProperty(m.estado) ? m.estado : "erro";
    var miolo =
      figura(m) +
      '<span class="bm-texto"><strong>' + esc(m.titulo) + "</strong>" +
        "<span>" + esc(m.detalhe) + "</span></span>" +
      '<span class="bm-marca" aria-label="' + ROTULO_ESTADO[estado] + '">' + MARCA[estado] + "</span>";
    // com link o card vira atalho pro modulo (ex.: /treino)
    return m.link
      ? '<li><a class="bm-item ' + estado + '" href="' + esc(m.link) + '">' + miolo + "</a></li>"
      : '<li><div class="bm-item ' + estado + '">' + miolo + "</div></li>";
  }

  function desenhar() {
    if (!dados || !dados.total) {
      selo.hidden = true;
      resumo.textContent = "";
      lista.innerHTML = '<li class="bm-aviso">Nenhuma meta configurada.</li>';
      return;
    }
    selo.hidden = false;
    selo.textContent = dados.feitas + "/" + dados.total;
    selo.classList.toggle("completo", dados.feitas === dados.total);
    resumo.textContent = dados.feitas === dados.total
      ? "tudo feito"
      : dados.feitas + " de " + dados.total;
    lista.innerHTML = dados.metas.map(item).join("");

    // avatar que nao carrega vira o marcador generico, sem icone quebrado
    lista.querySelectorAll(".bm-figura img").forEach(function (img) {
      img.addEventListener("error", function () {
        img.insertAdjacentHTML("afterend", ALVO);
        img.remove();
      }, { once: true });
    });
  }

  function desenharFalha() {
    selo.hidden = true;
    resumo.textContent = "";
    lista.innerHTML = '<li class="bm-aviso">Não consegui carregar as metas.' +
      '<button type="button" id="bmTentar">Tentar de novo</button></li>';
    document.getElementById("bmTentar").addEventListener("click", function (e) {
      e.stopPropagation();
      lista.innerHTML = '<li class="bm-aviso">Carregando…</li>';
      carregar();
    });
  }

  function carregar() {
    // uma busca por vez: abrir e voltar pra aba ao mesmo tempo nao duplica
    if (emVoo) return emVoo;
    emVoo = fetch(API, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        dados = d;
        buscadoEm = Date.now();
        desenhar();
      })
      .catch(function (err) {
        console.warn("[metas] " + err.message);
        // se ja havia dado, mantem na tela em vez de trocar por erro
        if (!dados) desenharFalha();
      })
      .then(function () { emVoo = null; });
    return emVoo;
  }

  function velho() { return Date.now() - buscadoEm > VALIDADE_MS; }

  function abrir() {
    raiz.classList.add("aberto");
    botao.setAttribute("aria-expanded", "true");
    if (velho()) carregar();
  }

  function fechar() {
    raiz.classList.remove("aberto");
    botao.setAttribute("aria-expanded", "false");
  }

  botao.addEventListener("click", function () {
    if (raiz.classList.contains("aberto")) fechar(); else abrir();
  });

  // toque fora ou Esc fecha
  document.addEventListener("pointerdown", function (e) {
    if (raiz.classList.contains("aberto") && !raiz.contains(e.target)) fechar();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && raiz.classList.contains("aberto")) fechar();
  });

  // voltou pro app depois de fazer a licao ou o treino: o selo se atualiza
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && velho()) carregar();
  });

  carregar();
})();

/* Modulo TRENDRADAR - entrada no menu do Segundo Cerebro.
 *
 * Mesmo padrao dos demais modulos: MutationObserver em #sheetCorpo para
 * garantir que o atalho permaneca visivel no grupo compartilhado #grupoModulos.
 */
(function () {
  var ROTA = "/trendradar";
  var ROTULO = "TrendRadar";
  var DESCRICAO = "Radar estratégico de tendências e oportunidades B2B";
  var ID = "mTrendradar";
  var ICONE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>';

  var corpo = document.getElementById("sheetCorpo");
  var titulo = document.getElementById("sheetTitulo");
  if (!corpo || !titulo) return;

  function inserir() {
    if (titulo.textContent !== "Opções") return;
    if (document.getElementById(ID)) return;

    var grupo = document.getElementById("grupoModulos");
    if (!grupo) {
      var bloco = document.createElement("div");
      bloco.innerHTML = '<p class="grupo-titulo">Módulos</p><div class="grupo" id="grupoModulos"></div>';
      while (bloco.lastChild) corpo.insertBefore(bloco.lastChild, corpo.firstChild);
      grupo = document.getElementById("grupoModulos");
    }

    var botao = document.createElement("button");
    botao.className = "item";
    botao.id = ID;
    botao.innerHTML =
      ICONE +
      '<div class="item-txt"><strong>' +
      ROTULO +
      "</strong>" +
      "<span>" +
      DESCRICAO +
      "</span></div>";
    botao.addEventListener("click", function () {
      location.href = ROTA;
    });
    grupo.appendChild(botao);
  }

  new MutationObserver(inserir).observe(corpo, { childList: true });
  inserir();
})();

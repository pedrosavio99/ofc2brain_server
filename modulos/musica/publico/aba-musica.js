/* Modulo MUSICA - entrada no menu do Segundo Cerebro.
 *
 * Mesmo padrao do aba-treino.js e do aba-refeicao.js: MutationObserver e nao
 * insercao unica, porque o abrirMenu() do app reescreve o #sheetCorpo inteiro
 * a cada chamada. O grupo "Modulos" e compartilhado.
 */
(function () {
  var ROTA = "/musica";
  var ROTULO = "Música";
  var DESCRICAO = "Player e rádio infinita";
  var ID = "mMusica";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 18V5l10-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>';

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
    botao.innerHTML = ICONE + '<div class="item-txt"><strong>' + ROTULO + "</strong>" +
      "<span>" + DESCRICAO + "</span></div>";
    botao.addEventListener("click", function () { location.href = ROTA; });
    grupo.appendChild(botao);
  }

  new MutationObserver(inserir).observe(corpo, { childList: true });
  inserir();
})();

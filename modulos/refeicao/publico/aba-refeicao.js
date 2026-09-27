/* Modulo REFEICAO - entrada no menu do Segundo Cerebro.
 *
 * Mesmo padrao do aba-treino.js: MutationObserver e nao insercao unica,
 * porque o abrirMenu() do app reescreve o #sheetCorpo inteiro a cada chamada.
 * O grupo "Modulos" e compartilhado: quem roda primeiro cria, os outros
 * penduram o botao dentro dele.
 */
(function () {
  var ROTA = "/refeicao";
  var ROTULO = "Refeição";
  var DESCRICAO = "Diário e calorias do dia";
  var ID = "mRefeicao";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 3v7a2 2 0 0 0 2 2v9M9 3v9M7 3v9M15 3c-1.5 1.5-2 3.5-2 6 0 2 .8 3 2 3v9M15 3c1.2 1.2 2 3 2 5"/></svg>';

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

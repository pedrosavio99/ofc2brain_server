/* Modulo FDSFLIX - entrada no menu do Segundo Cerebro.
 *
 * Mesmo padrao dos demais modulos: MutationObserver e nao insercao unica,
 * porque o abrirMenu() do app reescreve o #sheetCorpo inteiro a cada chamada.
 * O grupo "Modulos" e compartilhado: quem roda primeiro cria, os outros
 * penduram o botao dentro dele.
 */
(function () {
  var ROTA = "/fdsflix";
  var ROTULO = "fdsFlix";
  var DESCRICAO = "Filmes e séries, sem anúncios";
  var ID = "mFdsflix";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M10 9.2v5.6l4.6-2.8z"/></svg>';

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

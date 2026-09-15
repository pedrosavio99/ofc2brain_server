/* Modulo CONVERSA - entrada no menu do Segundo Cerebro.
 *
 * Copia fiel do aba-trabalho.js, trocando so ROTA, ROTULO, DESCRICAO, ICONE e
 * o id do botao, que e o que o proprio arquivo de la manda fazer pra modulo
 * novo. A versao anterior tentava reaproveitar o grupo "Modulos" do trabalho e
 * nao funcionou; nao vale complicar por causa de um titulo repetido.
 *
 * MutationObserver e nao insercao unica: o abrirMenu() do app reescreve o
 * #sheetCorpo inteiro a cada chamada, e se rechama sozinho quando voce troca o
 * tema. Item inserido na mao sumiria nesse momento.
 */
(function () {
  var ROTA = "/conversa";
  var ROTULO = "Conversa";
  var DESCRICAO = "Falar com o seu segundo cérebro";
  var ID = "mConversa";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 12a8 8 0 01-8 8H5l1.8-3A8 8 0 1120 12z"/>' +
    '<path d="M9 11h6M9 14.5h3.5"/></svg>';

  var corpo = document.getElementById("sheetCorpo");
  var titulo = document.getElementById("sheetTitulo");
  if (!corpo || !titulo) return;

  function inserir() {
    // guarda dupla: so no menu de opcoes, e so se ainda nao estiver la.
    // o segundo teste tambem impede o observer de se disparar em loop.
    if (titulo.textContent !== "Opções") return;
    if (document.getElementById(ID)) return;

    var bloco = document.createElement("div");
    bloco.innerHTML =
      '<p class="grupo-titulo">Módulos</p><div class="grupo">' +
        '<button class="item" id="' + ID + '">' + ICONE +
        '<div class="item-txt"><strong>' + ROTULO + "</strong>" +
        "<span>" + DESCRICAO + "</span></div></button>" +
      "</div>";

    // no topo: modulo e destino, nao precisa rolar o menu inteiro pra achar
    while (bloco.firstChild) corpo.insertBefore(bloco.firstChild, corpo.firstChild);

    document.getElementById(ID).addEventListener("click", function () {
      location.href = ROTA;
    });
  }

  new MutationObserver(inserir).observe(corpo, { childList: true });
  inserir();
})();

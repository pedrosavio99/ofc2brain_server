/* Modulo TRABALHO - entrada no menu do Segundo Cerebro.
 *
 * Este e o unico script do modulo que roda dentro da pagina principal. Ele
 * acrescenta um item no menu de tres pontinhos e manda pra /trabalho. Nao
 * toca no estado, nao mexe nas abas, nao altera nada que ja existe.
 *
 * Por que MutationObserver em vez de inserir uma vez: o abrirMenu() do app
 * reescreve o #sheetCorpo inteiro a cada chamada, e ele se rechama sozinho
 * quando voce troca o tema. Item inserido na mao sumiria nesse momento. O
 * observer devolve o item toda vez que o menu e remontado.
 *
 * Padrao pra novos modulos: copie este arquivo e troque ROTA, ROTULO,
 * DESCRICAO, ICONE e o id do botao.
 */
(function () {
  var ROTA = "/trabalho";
  var ROTULO = "Trabalho";
  var DESCRICAO = "Suas tarefas no ClickUp";
  var ID = "mTrabalho";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6.5l1.6 1.6L8.5 5"/><path d="M4 13l1.6 1.6L8.5 11.5"/><path d="M4 19.5l1.6 1.6L8.5 18"/>' +
    '<path d="M12 7h8M12 13.5h8M12 20h8"/></svg>';

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

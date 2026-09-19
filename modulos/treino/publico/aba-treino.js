/* Modulo TREINO - entrada no menu do Segundo Cerebro.
 *
 * Mesmo padrao do aba-conversa.js: MutationObserver e nao insercao unica,
 * porque o abrirMenu() do app reescreve o #sheetCorpo inteiro a cada chamada
 * e se rechama sozinho quando voce troca o tema. Item inserido na mao sumiria
 * nesse momento.
 */
(function () {
  var ROTA = "/treino";
  var ROTULO = "Treino";
  var DESCRICAO = "Ficha do dia e calorias";
  var ID = "mTreino";
  var ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/></svg>';

  var corpo = document.getElementById("sheetCorpo");
  var titulo = document.getElementById("sheetTitulo");
  if (!corpo || !titulo) return;

  function inserir() {
    // guarda dupla: so no menu de opcoes, e so se ainda nao estiver la.
    // o segundo teste tambem impede o observer de se disparar em loop.
    if (titulo.textContent !== "Opções") return;
    if (document.getElementById(ID)) return;

    /* Grupo COMPARTILHADO entre os modulos. Antes cada aba criava o proprio
       titulo "Módulos", e com tres modulos apareciam tres titulos iguais
       seguidos. Agora o primeiro a rodar cria o grupo e os outros penduram o
       botao dentro dele. Qual roda primeiro nao importa. */
    var grupo = document.getElementById("grupoModulos");
    if (!grupo) {
      var bloco = document.createElement("div");
      bloco.innerHTML = '<p class="grupo-titulo">Módulos</p><div class="grupo" id="grupoModulos"></div>';
      // no topo: modulo e destino, nao precisa rolar o menu inteiro pra achar
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

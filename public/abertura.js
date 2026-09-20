/* Tela de abertura do Segundo Cerebro.
 *
 * O SVG e uma animacao SMIL de 6,5s que se apaga sozinha no fim de cada ciclo
 * e recomeca. Isso da o ponto natural de saida: a virada do ciclo, quando a
 * arte ja esta invisivel. Esconder no meio cortaria o desenho no ar.
 *
 * A regra combinada:
 *   1. A abertura roda pelo menos UM ciclo inteiro, mesmo que o carregamento
 *      termine em 200ms.
 *   2. Se o carregamento demorar mais que um ciclo, o SVG repete, e a saida
 *      acontece na primeira virada DEPOIS que ele terminar.
 *
 * O #abertura e a <style> dele vivem no index.html, nao aqui: markup injetado
 * por JS pisca antes do script rodar.
 */
(function () {
  "use strict";

  var CICLO = 6500;      // precisa bater com o dur= do SVG
  var TETO = 4 * CICLO;  // trava de seguranca: nunca prende a tela pra sempre

  var caixa = document.getElementById("abertura");
  if (!caixa) return;

  /* Uma vez por sessao. Sem isto, voltar de um modulo pro inicio faria voce
     assistir 6,5s de animacao de novo, o que cansa rapido.
     Pra ver sempre, comente as quatro linhas abaixo. */
  try {
    if (sessionStorage.getItem("2brain-abertura")) { caixa.remove(); return; }
    sessionStorage.setItem("2brain-abertura", "1");
  } catch (e) {}

  // quem nao quer animacao nao deve levar 6,5s de animacao na cara
  var quieto = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (quieto) { caixa.remove(); return; }

  var t0 = Date.now();
  var saindo = false;

  function sair() {
    if (saindo) return;
    saindo = true;
    caixa.classList.add("saindo");
    // espera a transicao antes de tirar do DOM
    setTimeout(function () { if (caixa.parentNode) caixa.remove(); }, 700);
  }

  /** Quanto falta ate a proxima virada de ciclo, garantindo um ciclo inteiro. */
  function ateAVirada() {
    var passado = Date.now() - t0;
    return CICLO - (passado % CICLO);
  }

  /* Chamado pelo app.js quando as notas terminam de carregar.
     Se nunca for chamado (erro no app), o TETO abaixo resolve. */
  window.aberturaPronta = function () {
    setTimeout(sair, ateAVirada());
  };

  setTimeout(sair, TETO);
})();

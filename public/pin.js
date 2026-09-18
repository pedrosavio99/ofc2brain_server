/* Porta de entrada por PIN, lado da tela.
 *
 * Envolve o fetch global em vez de mexer em cada arquivo. Assim o app.js, o
 * conversa.js e o trabalho.js ganham o header sem serem tocados, e modulo novo
 * ja nasce coberto. Tem que carregar ANTES dos outros scripts.
 *
 * O PIN fica no localStorage depois de validado, pra nao ter que digitar toda
 * hora. Isso quer dizer que quem tiver o navegador tem o acesso: a protecao e
 * contra quem acha a URL, nao contra quem senta na sua cadeira.
 */
(function () {
  "use strict";

  var CHAVE = "2brain-pin";
  var original = window.fetch.bind(window);
  var pin = "";
  try { pin = localStorage.getItem(CHAVE) || ""; } catch (e) {}

  var esperando = null; // promessa unica: 10 chamadas em 401 abrem UM modal so

  function guardar(v) {
    pin = v || "";
    try { v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); } catch (e) {}
  }

  /* So carimba chamada pra ca. URL absoluta pra outro dominio (Supabase, uma
     API externa) nao pode levar o PIN junto. */
  function daCasa(entrada) {
    try {
      var u = new URL(typeof entrada === "string" ? entrada : entrada.url, window.location.href);
      return u.origin === window.location.origin;
    } catch (e) { return false; }
  }

  function comHeader(init) {
    var o = Object.assign({}, init || {});
    var h = new Headers((init && init.headers) || {});
    if (pin) h.set("x-pin", pin);
    o.headers = h;
    return o;
  }

  // ---- modal ----
  function pedirPin(aviso) {
    if (esperando) return esperando;
    esperando = new Promise(function (resolve) {
      var fundo = document.createElement("div");
      fundo.setAttribute("role", "dialog");
      fundo.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;" +
        "justify-content:center;padding:20px;background:rgba(0,0,0,.55);backdrop-filter:blur(3px)";

      var caixa = document.createElement("div");
      caixa.style.cssText =
        "width:100%;max-width:340px;background:#fff;color:#111;border-radius:16px;" +
        "padding:22px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
        "box-shadow:0 18px 50px rgba(0,0,0,.3)";

      var titulo = document.createElement("strong");
      titulo.textContent = "Digite seu PIN";
      titulo.style.cssText = "display:block;font-size:17px;margin-bottom:6px";

      var sub = document.createElement("p");
      sub.textContent = aviso || "Este segundo cérebro é protegido.";
      sub.style.cssText = "margin:0 0 14px;font-size:13.5px;color:#666;line-height:1.35";

      var campo = document.createElement("input");
      campo.type = "password";
      campo.autocomplete = "current-password";
      campo.style.cssText =
        "width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;" +
        "border:1px solid #d5d5d5;border-radius:10px;font-family:inherit";

      var erro = document.createElement("p");
      erro.style.cssText = "margin:8px 0 0;font-size:13px;color:#c0392b;min-height:18px";

      var botao = document.createElement("button");
      botao.textContent = "Entrar";
      botao.style.cssText =
        "width:100%;margin-top:14px;padding:11px;font-size:15px;font-weight:600;" +
        "border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;font-family:inherit";

      caixa.appendChild(titulo); caixa.appendChild(sub); caixa.appendChild(campo);
      caixa.appendChild(erro); caixa.appendChild(botao);
      fundo.appendChild(caixa);
      document.body.appendChild(fundo);
      setTimeout(function () { campo.focus(); }, 50);

      async function tentar() {
        var v = campo.value.trim();
        if (!v) return;
        botao.disabled = true; erro.textContent = ""; botao.textContent = "Conferindo...";
        try {
          /* Valida em /acesso ANTES de guardar. Guardar primeiro e descobrir
             depois deixaria um PIN errado no navegador, e toda chamada seguinte
             cairia em 401 sem explicacao. */
          var r = await original("/acesso", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: v }),
          });
          var d = await r.json().catch(function () { return {}; });
          if (r.ok && d.ok) {
            guardar(v);
            if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
            esperando = null;
            resolve(true);
            return;
          }
          erro.textContent = d.erro || "PIN incorreto.";
        } catch (e) {
          erro.textContent = "Nao deu pra conferir: " + e.message;
        }
        botao.disabled = false; botao.textContent = "Entrar";
        campo.select();
      }

      botao.addEventListener("click", tentar);
      campo.addEventListener("keydown", function (e) { if (e.key === "Enter") tentar(); });
      // sem botao de fechar de proposito: sem PIN nao ha nada pra ver atras dele
    });
    return esperando;
  }

  // ---- fetch envolvido ----
  window.fetch = async function (entrada, init) {
    if (!daCasa(entrada)) return original(entrada, init);

    var resposta = await original(entrada, comHeader(init));
    if (resposta.status !== 401) return resposta;

    /* 401 pode ser outra coisa. So tratamos como PIN quando o servidor marca,
       pra nao abrir modal em cima de um 401 de outro motivo. */
    var corpo = null;
    try { corpo = await resposta.clone().json(); } catch (e) {}
    if (!corpo || !corpo.pin) return resposta;

    // PIN guardado virou invalido (voce trocou a variavel): limpa e pergunta.
    if (pin) guardar("");
    await pedirPin(corpo.erro === "PIN incorreto." ? "O PIN guardado nao vale mais." : null);
    // uma repeticao so: se falhar de novo, devolve o erro em vez de fazer laco
    return original(entrada, comHeader(init));
  };

  /* Na abertura, pergunta se este deploy exige PIN. Sem isto a primeira
     chamada de dado e que descobriria, e a tela piscaria conteudo vazio antes
     do modal. /acesso passa sem PIN de proposito. */
  original("/acesso")
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d && d.exigido && !pin) pedirPin(); })
    .catch(function () {});
})();

/* Modulo CONVERSA - a tela.
 *
 * Tres camadas, duas requisicoes:
 *   camada 0  aqui mesmo, instantanea, zero rede
 *   camada 1  POST /contexto   embedding + pgvector. Sem LLM.
 *   camada 2  POST /responder  o modelo, em 1 a 3 mensagens
 *
 * As camadas 0 e 1 aparecem como STATUS, nao como fala dele. Isso e de
 * proposito: o que ele "diz" fica guardado no banco e vira memoria depois.
 * Enrolacao de espera nao pode entrar nesse caminho.
 */
(function () {
  "use strict";

  var API = "/conversa/api";
  var CHAVE_SESSAO = "2brain-conversa-id";

  var fluxo = document.getElementById("fluxo");
  var corpo = document.getElementById("corpo");
  var campo = document.getElementById("campo");
  var btnEnviar = document.getElementById("btnEnviar");
  var btnNova = document.getElementById("btnNova");
  var btnAlma = document.getElementById("btnAlma");
  var folha = document.getElementById("folhaAlma");
  var listaTracos = document.getElementById("listaTracos");
  var tracoNovo = document.getElementById("tracoNovo");
  var tracoCat = document.getElementById("tracoCat");
  var btnAddTraco = document.getElementById("btnAddTraco");
  var almaMeta = document.getElementById("almaMeta");
  // Existiam no HTML e nao eram lidos por ninguem: a textarea nunca era
  // preenchida e o Salvar nao tinha handler.
  var almaTexto = document.getElementById("almaTexto");
  var btnSalvarAlma = document.getElementById("btnSalvarAlma");
  var btnFecharAlma = document.getElementById("btnFecharAlma");
  var btnDestilar = document.getElementById("btnDestilar");

  var gaveta = document.getElementById("gaveta");
  var lista = document.getElementById("lista");
  var btnGaveta = document.getElementById("btnGaveta");
  var btnFecharGaveta = document.getElementById("btnFecharGaveta");
  var btnNovaGaveta = document.getElementById("btnNovaGaveta");

  var conversaId = null;
  var ocupado = false;

  /* Camada 0. Sai ANTES de a requisicao partir, entao nao pode afirmar nada
     sobre conteudo: e so sinal de vida. Quem fala de nota e a camada 1. */
  var ABERTURAS = ["Deixa eu ver aqui", "Peraí", "Hmm, deixa eu olhar", "Já te falo"];

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function paraBaixo() { corpo.scrollTop = corpo.scrollHeight; }

  function bolha(texto, quem) {
    var d = document.createElement("div");
    d.className = "cv-bolha " + quem;
    // textContent e nao innerHTML: o texto vem do modelo e das suas notas.
    d.textContent = texto;
    fluxo.appendChild(d); paraBaixo(); return d;
  }

  function status(texto, comPontos) {
    var d = document.createElement("div");
    d.className = "cv-status"; d.textContent = texto;
    if (comPontos !== false) d.insertAdjacentHTML("beforeend", '<span class="cv-pontos"><i></i><i></i><i></i></span>');
    fluxo.appendChild(d); paraBaixo(); return d;
  }

  function trocarStatus(el, texto) {
    if (!el) return;
    el.textContent = texto;
    el.insertAdjacentHTML("beforeend", '<span class="cv-pontos"><i></i><i></i><i></i></span>');
    paraBaixo();
  }

  function sumir(el) {
    if (!el) return;
    el.classList.add("some");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }

  /* Carregando da abertura. Antes a tela subia vazia e parecia pronta enquanto
     a sessao ainda estava sendo criada: voce digitava e nada acontecia. */
  var aviso = null;
  function carregando(texto) {
    if (!aviso) {
      aviso = document.createElement("div");
      aviso.className = "cv-status";
      fluxo.appendChild(aviso);
    }
    aviso.textContent = texto;
    paraBaixo();
  }
  function fimDoCarregando() {
    if (aviso && aviso.parentNode) aviso.parentNode.removeChild(aviso);
    aviso = null;
  }

  function erro(msg) { var d = document.createElement("div"); d.className = "cv-erro"; d.textContent = msg; fluxo.appendChild(d); paraBaixo(); }
  function rodape(texto) { var d = document.createElement("div"); d.className = "cv-fontes"; d.textContent = texto; fluxo.appendChild(d); paraBaixo(); }

  /* Teto de espera. Sem ele, quando o Gemini cai e o Groq esta em descanso de
     cota, a tela fica parada minutos sem nada e parece travamento. */
  async function pedir(caminho, opcoes, limiteMs) {
    var ctrl = new AbortController();
    var relogio = setTimeout(function () { ctrl.abort(); }, limiteMs || 45000);
    var r;
    try {
      r = await fetch(API + caminho, Object.assign({ signal: ctrl.signal }, opcoes || {}));
    } catch (e) {
      clearTimeout(relogio);
      if (e.name === "AbortError") throw new Error("Demorou demais. Os dois modelos estao sem cota agora.");
      throw e;
    }
    clearTimeout(relogio);
    var dados = null;
    try { dados = await r.json(); } catch (e) {}
    if (!r.ok) {
      // o status vai junto: quem chama precisa distinguir 404 de 500 sem ler texto
      var err = new Error((dados && dados.erro) || "Falhou (" + r.status + ")");
      err.status = r.status;
      err.dados = dados;
      throw err;
    }
    return dados;
  }

  /* Ritmo entre mensagens. Curta espera pouco, longa espera mais: e o tempo
     de leitura que faz parecer alguem digitando, em vez de um bloco caindo. */
  function pausaDe(texto) { return Math.max(450, Math.min(String(texto).length * 22, 1700)); }

  function travar(v) { ocupado = v; btnEnviar.disabled = v; campo.disabled = v; }

  async function garantirSessao() {
    var salvo = null;
    try { salvo = localStorage.getItem(CHAVE_SESSAO); } catch (e) {}
    if (salvo) {
      try {
        var h = await pedir("/historico?conversa_id=" + encodeURIComponent(salvo) + "&n=30", {});
        conversaId = salvo;
        (h.turnos || []).forEach(function (t) { bolha(t.texto, t.papel === "pessoa" ? "pessoa" : "cerebro"); });
        return;
      } catch (e) {
        // conversa sumiu do banco (faxina dos 90 dias, base trocada). Abre outra.
      }
    }
    var nova = await pedir("/sessao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    conversaId = nova.id;
    try { localStorage.setItem(CHAVE_SESSAO, conversaId); } catch (e) {}
  }

  /* A conversa guardada no navegador pode ter morrido no banco: base trocada,
     faxina, exclusao em outro aparelho. Quando isso aparece no meio do envio,
     jogamos o id fora e abrimos outra, em vez de deixar voce preso num erro. */
  function sessaoMorreu(e) {
    return e && (e.status === 404 || /conversa nao encontrada/i.test(e.message || ""));
  }

  async function enviar(reenvio) {
    var texto = campo.value.trim();
    if (!texto || ocupado) return;
    /* Sem sessao o envio saia em silencio: voce apertava Enter e nao acontecia
       nada, sem nenhuma pista de que o banco e que estava fora. */
    if (!conversaId) { semSessao(); return; }

    campo.value = ""; campo.style.height = "auto";
    bolha(texto, "pessoa"); travar(true);

    var sinal = status(ABERTURAS[Math.floor(Math.random() * ABERTURAS.length)]);

    try {
      var ctx;
      try {
        ctx = await pedir("/contexto", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversa_id: conversaId, texto: texto }),
        });
      } catch (e) {
        // uma recuperacao so: reenvio evita laco se a conversa nova tambem falhar
        if (!sessaoMorreu(e) || reenvio) throw e;
        sumir(sinal); travar(false);
        try { localStorage.removeItem(CHAVE_SESSAO); } catch (e2) {}
        conversaId = null;
        await garantirSessao();
        campo.value = texto;
        // a bolha antiga fica: a mensagem e a mesma, so a conversa que e outra
        if (fluxo.lastElementChild) fluxo.removeChild(fluxo.lastElementChild);
        return enviar(true);
      }

      // camada 1: o que a busca ja devolveu, sem modelo nenhum
      trocarStatus(sinal, ctx.frase);

      var corpoReq = JSON.stringify({ conversa_id: conversaId, ordem: ctx.ordem });
      var cab = { method: "POST", headers: { "Content-Type": "application/json" }, body: corpoReq };

      /* Os dois saem JUNTOS. Esperar a rapida pra so entao pedir a boa faria a
         rapida virar atraso, que e o oposto do que ela existe pra fazer.
         O catch na rapida e proposital: se o Groq estourar cota, a conversa
         continua com o status da camada 1 e a resposta do Gemini. */
      var pRapida = pedir("/rapida", cab, 12000).catch(function () { return null; });
      var pReal = pedir("/responder", cab);

      var chegouReal = false;
      pReal.then(function () { chegouReal = true; }, function () { chegouReal = true; });

      var rap = await pRapida;
      if (rap && rap.mensagens && rap.mensagens.length && !chegouReal) {
        sumir(sinal);
        await derramar(rap.mensagens, function () { return chegouReal; });
      }

      // acabou a rapida e o forte ainda nao voltou: narra em vez de ficar mudo
      var encerrarNarracao = null;
      if (!chegouReal) {
        sumir(sinal);
        encerrarNarracao = narrarEspera(ctx.notas || [], function () { return chegouReal; });
      }

      var resp;
      try { resp = await pReal; }
      finally { if (encerrarNarracao) encerrarNarracao(); }
      sumir(sinal);

      /* Respiro antes do conteudo: sem ele a resposta densa cola na ultima
         mensagem rapida e as duas viram um bloco so. */
      if (rap && rap.mensagens && rap.mensagens.length) await esperar(500);

      await derramar(resp.mensagens || [], null);

      if (ctx.achado && ctx.achado.fortes > 0) {
        rodape(ctx.achado.fortes + (ctx.achado.fortes === 1 ? " nota usada" : " notas usadas"));
      }
    } catch (e) {
      sumir(sinal);
      erro(e.message);
      campo.value = texto; // devolve o que voce digitou em vez de engolir
    } finally {
      travar(false); campo.focus();
    }
  }

  // --- alma: lista de tracos ---
  function desenharTracos(tracos) {
    listaTracos.innerHTML = "";
    if (!tracos || !tracos.length) {
      var v = document.createElement("div");
      v.className = "cv-vazio";
      v.textContent = "Nenhum traço ainda. Ele aprende conversando, ou você escreve um aí em cima.";
      listaTracos.appendChild(v);
      return;
    }
    tracos.forEach(function (t) {
      var li = document.createElement("div");
      li.className = "cv-traco" + (t.ativo === false ? " off" : "");

      var txt = document.createElement("div");
      txt.className = "cv-traco-txt";
      txt.textContent = t.traco;
      var sub = document.createElement("div");
      sub.className = "cv-traco-sub";
      sub.textContent = t.categoria + (t.exemplo ? ' · "' + String(t.exemplo).slice(0, 40) + '"' : "");
      if (t.fixado) {
        var pin = document.createElement("span");
        pin.className = "cv-pin";
        pin.textContent = "  FIXADO";
        sub.appendChild(pin);
      }
      txt.appendChild(sub);

      var vezes = document.createElement("span");
      vezes.className = "cv-vezes";
      vezes.textContent = "x" + (t.vezes || 1);
      vezes.title = "quantas vezes apareceu";

      // desligar tira do prompt sem apagar o historico de repeticao
      var olho = miniBotao(t.ativo === false ? SVG_OLHO_OFF : SVG_OLHO, t.ativo === false ? "Ligar" : "Desligar", "cv-olho");
      olho.addEventListener("click", async function () {
        try { await pedir("/tracos/" + t.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: t.ativo === false }) }); await abrirAlma(); }
        catch (e) { alert(e.message); }
      });

      var lixo = miniBotao(SVG_LIXO, "Apagar", "cv-lixo");
      lixo.addEventListener("click", async function () {
        if (!confirm('Apagar "' + t.traco + '"?')) return;
        try { await pedir("/tracos/" + t.id, { method: "DELETE" }); await abrirAlma(); }
        catch (e) { alert(e.message); }
      });

      li.appendChild(txt); li.appendChild(vezes); li.appendChild(olho); li.appendChild(lixo);
      listaTracos.appendChild(li);
    });
  }

  async function abrirAlma() {
    folha.hidden = false;
    almaMeta.textContent = "carregando...";
    try {
      var a = await pedir("/alma", {});
      desenharTracos(a.tracos || []);
      // a observacao escrita por voce vive em alma.perfil
      if (almaTexto) almaTexto.value = a.perfil || "";
      var ativos = (a.tracos || []).filter(function (t) { return t.ativo !== false; }).length;
      almaMeta.textContent = ativos + " traço(s) no prompt · " + (a.turnos_totais || 0) +
        " turnos · " + (a.precisa_destilar ? "tem material novo" : "em dia");
    } catch (e) {
      listaTracos.innerHTML = "";
      almaMeta.textContent = e.message;
    }
  }

  async function addTraco() {
    var t = tracoNovo.value.trim();
    if (!t) return;
    btnAddTraco.disabled = true;
    try {
      // nasce fixado: o destilador nao reescreve o que voce escreveu
      await pedir("/tracos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ traco: t, categoria: tracoCat.value }) });
      tracoNovo.value = "";
      await abrirAlma();
    } catch (e) { alert(e.message); }
    finally { btnAddTraco.disabled = false; }
  }

  async function salvarAlma() {
    if (!almaTexto) return;
    btnSalvarAlma.disabled = true;
    var antes = almaMeta.textContent;
    almaMeta.textContent = "salvando...";
    try {
      await pedir("/alma", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfil: almaTexto.value }),
      });
      almaMeta.textContent = "observação salva.";
      setTimeout(function () { if (almaMeta.textContent === "observação salva.") almaMeta.textContent = antes; }, 2000);
    } catch (e) { almaMeta.textContent = e.message; }
    finally { btnSalvarAlma.disabled = false; }
  }

  async function destilarAgora() {
    btnDestilar.disabled = true;
    almaMeta.textContent = "lendo suas conversas...";
    try {
      var r = await pedir("/destilar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forcar: true }) }, 60000);
      // redesenha SEMPRE, mesmo com novos = 0: traco repetido virou contagem maior
      desenharTracos(r.tracos || []);
      almaMeta.textContent = r.novos > 0
        ? r.novos + " traço(s) novo(s). " + (r.observacao || "")
        : "Nada novo desta vez. " + (r.observacao || r.motivo || "Converse mais um pouco.");
    } catch (e) { almaMeta.textContent = e.message; }
    finally { btnDestilar.disabled = false; }
  }

  async function novaConversa() {
    if (ocupado) return;
    try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) {}
    fluxo.innerHTML = ""; conversaId = null;
    await garantirSessao(); campo.focus();
  }

  /* Derrama mensagens uma a uma, com pontinhos entre elas. `parar` e uma
     funcao: quando ela vira true, o resto do enchimento e descartado, porque
     a resposta de verdade ja chegou e enchimento depois dela e so atraso. */
  var MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  function quando(iso) {
    var p = String(iso || "").split("-");
    return p.length >= 2 && MES[Number(p[1]) - 1] ? "de " + MES[Number(p[1]) - 1] : "";
  }

  /* A espera do modelo forte deixava a tela muda. Agora o status narra sobre as
     notas que a busca JA trouxe: zero chamada de modelo, e so cita nota que
     existe de verdade. E status, nao balao: nao vira turno nem vira memoria. */
  function narrarEspera(notas, parar) {
    var el = status("Pensando", true);
    var frases = [];
    (notas || []).slice(0, 6).forEach(function (n) {
      var q = quando(n.criado_em);
      var resumo = String(n.resumo || "").slice(0, 70);
      if (resumo) frases.push("Relendo aquela " + (q ? q + " " : "") + "sobre " + resumo);
      if (n.area) frases.push("Puxando o que você escreveu em " + n.area);
    });
    if (notas && notas.length > 1) frases.push("Cruzando as " + notas.length + " notas");
    frases.push("Juntando as pontas");
    frases.push("Quase lá");

    var i = 0;
    var t = setInterval(function () {
      if (parar()) { clearInterval(t); return; }
      trocarStatus(el, frases[i % frases.length]);
      i++;
    }, 3200);

    return function encerrar() { clearInterval(t); sumir(el); };
  }

  async function derramar(msgs, parar) {
    for (var i = 0; i < msgs.length; i++) {
      if (parar && parar()) return;
      if (i > 0) {
        var p = status("", true);
        await esperar(pausaDe(msgs[i]));
        if (p.parentNode) p.parentNode.removeChild(p);
        if (parar && parar()) return;
      }
      bolha(msgs[i], "cerebro");
    }
  }

  // ---- gaveta ----
  var SVG_ESTRELA = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 4l2.3 4.9 5.2.7-3.8 3.6.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z"/></svg>';
  var SVG_LIXO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
  var SVG_OLHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
  var SVG_OLHO_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l16 16"/><path d="M2 12s4-6 10-6c1.6 0 3 .4 4.2 1M22 12s-4 6-10 6c-1.6 0-3-.4-4.2-1"/></svg>';
  var SVG_LAPIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';

  async function abrirGaveta() {
    gaveta.hidden = false;
    lista.innerHTML = '<div class="cv-vazio">carregando...</div>';
    try {
      var r = await pedir("/conversas", {});
      desenharLista(r.conversas || []);
    } catch (e) {
      lista.innerHTML = "";
      var d = document.createElement("div");
      d.className = "cv-vazio";
      d.textContent = e.message;
      lista.appendChild(d);
    }
  }

  function desenharLista(cs) {
    lista.innerHTML = "";
    if (!cs.length) {
      var v = document.createElement("div");
      v.className = "cv-vazio";
      v.textContent = "Nenhuma conversa ainda.";
      lista.appendChild(v);
      return;
    }
    cs.forEach(function (c) {
      var item = document.createElement("div");
      item.className = "cv-item" + (c.id === conversaId ? " ativo" : "") + (c.favorita ? " fav" : "");

      var abrir = document.createElement("button");
      abrir.className = "cv-item-abrir";
      // textContent: titulo vem da sua propria frase, entao e texto livre
      abrir.textContent = c.titulo || "Sem título";
      abrir.title = c.titulo || "Sem título";
      abrir.addEventListener("click", function () { trocarConversa(c.id); });

      var estrela = miniBotao(SVG_ESTRELA, c.favorita ? "Desfavoritar" : "Favoritar", "cv-estrela");
      estrela.addEventListener("click", async function () {
        try { await pedir("/conversas/" + c.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorita: !c.favorita }) }); await abrirGaveta(); }
        catch (e) { alert(e.message); }
      });

      var lapis = miniBotao(SVG_LAPIS, "Renomear", "cv-lapis");
      lapis.addEventListener("click", async function () {
        var novo = prompt("Nome da conversa:", c.titulo || "");
        if (novo === null) return;
        try { await pedir("/conversas/" + c.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titulo: novo }) }); await abrirGaveta(); }
        catch (e) { alert(e.message); }
      });

      var lixo = miniBotao(SVG_LIXO, "Excluir", "cv-lixo");
      lixo.addEventListener("click", async function () {
        // sem desfazer: o cascade leva os turnos junto e nao volta
        if (!confirm('Excluir "' + (c.titulo || "esta conversa") + '"? Não dá pra desfazer.')) return;
        try {
          await pedir("/conversas/" + c.id, { method: "DELETE" });
          if (c.id === conversaId) { try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) {} fluxo.innerHTML = ""; conversaId = null; await garantirSessao(); }
          await abrirGaveta();
        } catch (e) { alert(e.message); }
      });

      item.appendChild(abrir); item.appendChild(estrela); item.appendChild(lapis); item.appendChild(lixo);
      lista.appendChild(item);
    });
  }

  function miniBotao(svg, titulo, classe) {
    var b = document.createElement("button");
    b.className = "cv-mini " + classe;
    b.title = titulo;
    b.setAttribute("aria-label", titulo);
    b.innerHTML = svg;   // svg fixo do proprio arquivo, nao vem de fora
    return b;
  }

  async function trocarConversa(id) {
    if (ocupado) return;
    gaveta.hidden = true;
    fluxo.innerHTML = "";
    conversaId = id;
    try { localStorage.setItem(CHAVE_SESSAO, id); } catch (e) {}
    try {
      var h = await pedir("/historico?conversa_id=" + encodeURIComponent(id) + "&n=50", {});
      (h.turnos || []).forEach(function (t) { bolha(t.texto, t.papel === "pessoa" ? "pessoa" : "cerebro"); });
    } catch (e) { erro(e.message); }
    campo.focus();
  }

  btnGaveta.addEventListener("click", abrirGaveta);
  btnFecharGaveta.addEventListener("click", function () { gaveta.hidden = true; });
  btnNovaGaveta.addEventListener("click", async function () { gaveta.hidden = true; await novaConversa(); });
  gaveta.addEventListener("click", function (e) { if (e.target === gaveta) gaveta.hidden = true; });

  btnEnviar.addEventListener("click", enviar);
  btnNova.addEventListener("click", novaConversa);
  btnAlma.addEventListener("click", abrirAlma);
  btnFecharAlma.addEventListener("click", function () { folha.hidden = true; });
  btnDestilar.addEventListener("click", destilarAgora);
  btnSalvarAlma.addEventListener("click", salvarAlma);
  btnAddTraco.addEventListener("click", addTraco);
  tracoNovo.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addTraco(); } });
  folha.addEventListener("click", function (e) { if (e.target === folha) folha.hidden = true; });

  /* Enter envia, Shift+Enter quebra linha. isComposing na condicao por causa
     do teclado com acento: sem isso o Enter que fecha o acento manda a mensagem. */
  campo.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
  });

  campo.addEventListener("input", function () {
    campo.style.height = "auto";
    campo.style.height = Math.min(campo.scrollHeight, 140) + "px";
  });

  function semSessao() {
    erro("Sem conversa aberta. O banco nao respondeu: rode o SQL do modulo no Supabase.");
    var b = document.createElement("button");
    b.className = "cv-btn-sec";
    b.textContent = "Tentar de novo";
    // Tenta de novo pelo MESMO caminho da abertura: se o banco continuar fora,
    // voce ve o motivo outra vez, e nao uma mensagem crua do supabase-js.
    b.addEventListener("click", function () {
      if (b.parentNode) b.parentNode.removeChild(b);
      abrirComHealth();
    });
    fluxo.appendChild(b);
    paraBaixo();
  }

  /* Abertura em dois tempos: primeiro pergunta ao servidor se o banco responde,
     so depois tenta abrir a sessao.

     Sem isso, qualquer falha caia na mesma mensagem generica culpando o SQL do
     Supabase, inclusive quando o problema era chave errada, projeto pausado ou
     nada disso. O /health agora devolve o motivo e a tela repete o motivo. */
  var MOTIVO = {
    sem_config: "As variaveis do Supabase nao estao no ambiente deste deploy.",
    sem_tabelas: "As tabelas do modulo nao existem. Rode supabase/conversa.sql no seu projeto.",
    sem_permissao: "O Supabase recusou a chave. Confira a SUPABASE_SECRET_KEY.",
    inacessivel: "O Supabase nao respondeu. Pode estar pausado ou fora do ar.",
  };

  async function abrirComHealth() {
    travar(true);
    carregando("Conectando...");
    var h = null;
    try {
      h = await pedir("/health", {}, 12000);
    } catch (e) {
      fimDoCarregando(); travar(false);
      erro("O servidor do modulo nao respondeu: " + e.message);
      semSessao();
      return;
    }

    if (h && h.banco && h.banco.ok === false) {
      fimDoCarregando(); travar(false);
      erro(MOTIVO[h.banco.estado] || h.banco.detalhe || "O banco nao respondeu.");
      semSessao();
      return;
    }

    carregando("Abrindo sua conversa...");
    try {
      await garantirSessao();
      fimDoCarregando(); travar(false);
      campo.focus();
    } catch (e) {
      fimDoCarregando(); travar(false);
      erro("Nao consegui abrir a conversa: " + e.message);
      semSessao();
    }
  }

  abrirComHealth();
})();

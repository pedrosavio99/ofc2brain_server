/* Segundo cerebro - links curtos.
   Depende de app.js: usa $, esc, avisar, abrirSheet e esqueletos. Carregar
   DEPOIS do app.js. Quem abre e o menu "..." do inicio (mLinks), por
   window.SegundoCerebroLinks.abrir().

   Fluxo: cola um ou varios links -> eles entram na lista -> em cada um voce
   escolhe o encurtador e o link curto fica salvo no Supabase. "Gerar de novo"
   troca o link curto (por exemplo quando o antigo expirou) sem perder o atual
   se a nova tentativa falhar. "Apresentar" abre o link curto gigante em tela
   cheia, pra ditar ou projetar no computador de outra pessoa. */
(function () {
  "use strict";

  var BASE = "/links/api";
  var SERVICOS = [["isgd", "is.gd"], ["dagd", "da.gd"], ["tiny", "TinyURL"]];
  var ROTULO = { isgd: "is.gd", dagd: "da.gd", tiny: "TinyURL", manual: "colado" };

  var LK = {
    links: [],
    busca: "",
    carregando: false,
    erro: "",
    gerar: {},   // id -> true quando o painel de gerar esta aberto
    alias: {},   // id -> texto digitado (sobrevive ao re-render da lista)
    status: {},  // id -> { texto, manual, erro }
    ocupado: {}, // id -> true enquanto o servidor trabalha
  };

  /* ------------------------------------------------------------ helpers */

  function noModal() { return !!document.getElementById("lkRaiz"); }

  function chamar(metodo, caminho, corpo) {
    var o = { method: metodo, headers: {} };
    if (corpo !== undefined) {
      o.headers["content-type"] = "application/json";
      o.body = JSON.stringify(corpo);
    }
    return fetch(BASE + caminho, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.erro || "Não deu certo.");
          e.dica = d.dica || "";
          e.manual = d.manual || "";
          throw e;
        }
        return d;
      });
    });
  }

  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }
  function semProtocolo(u) { return String(u || "").replace(/^https?:\/\//, ""); }
  function achar(id) { return LK.links.filter(function (l) { return l.id === id; })[0]; }

  function idade(iso) {
    if (!iso) return "";
    var d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d <= 0) return "gerado hoje";
    if (d === 1) return "gerado ontem";
    if (d < 60) return "gerado há " + d + " dias";
    return "gerado há " + Math.round(d / 30) + " meses";
  }

  function copiar(texto, msg) {
    function plano() {
      var a = document.createElement("textarea");
      a.value = texto;
      a.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(a);
      a.select();
      try { document.execCommand("copy"); avisar(msg); } catch (e) { avisar("Não consegui copiar"); }
      a.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { avisar(msg); }, plano);
    } else plano();
  }

  function dicaAlias(a, servico) {
    if (!a) return "Sem nome personalizado, o endereço sai aleatório.";
    if (a.length < 5) return "Use 5 letras ou mais. Com menos, o is.gd sorteia o endereço (da.gd aceita 3).";
    return servico === "tiny"
      ? "O TinyURL ignora o nome. Para ter o nome, use is.gd ou da.gd."
      : "O nome vale para is.gd e da.gd. Se já estiver em uso, o site avisa.";
  }

  /* ------------------------------------------------------------ tela */

  function abrir() {
    abrirSheet("Links curtos",
      '<div id="lkRaiz">' +
        '<details class="lk-add" id="lkAdd">' +
          '<summary><svg class="lk-add-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
            '<span>Adicionar links</span>' +
            '<svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></summary>' +
          '<div class="lk-form">' +
            '<p class="lk-sub">Guarde links grandes e gere versões curtas, fáceis de digitar em outro computador.</p>' +
            '<textarea class="campo" id="lkLongos" rows="3" placeholder="Cole um ou vários links, um por linha"></textarea>' +
            '<input class="campo" id="lkTitulo" autocomplete="off" placeholder="Nome (só vale quando for um link)">' +
            '<button class="btn btn-largo" id="lkAdicionar" type="button">Adicionar à lista</button>' +
            '<p class="lk-msg" id="lkMsg" role="status"></p>' +
          "</div>" +
        "</details>" +
        '<div class="lk-cab"><p class="grupo-titulo" id="lkConta">Salvos</p>' +
          '<input class="campo lk-busca" id="lkBusca" type="search" placeholder="Buscar" aria-label="Buscar links"></div>' +
        '<div id="lkLista">' + esqueletos(2) + "</div>" +
      "</div>");

    $("#lkAdicionar").addEventListener("click", adicionar);
    $("#lkBusca").addEventListener("input", function () { LK.busca = this.value; desenhar(); });
    var lista = $("#lkLista");
    lista.addEventListener("click", aoClicar);
    lista.addEventListener("input", aoDigitar);
    carregar();
  }

  function carregar() {
    LK.carregando = true;
    LK.erro = "";
    chamar("GET", "/links").then(function (d) {
      LK.links = d.links || [];
    }).catch(function (e) {
      LK.erro = e.message + (e.dica ? " " + e.dica : "");
    }).then(function () {
      LK.carregando = false;
      desenhar();
      // lista vazia: o formulario e o proximo passo, entao ja abre
      var ac = $("#lkAdd");
      if (ac && !LK.erro && !LK.links.length) ac.open = true;
    });
  }

  function dizer(texto, erro) {
    var m = $("#lkMsg");
    if (!m) return;
    m.textContent = texto || "";
    m.classList.toggle("erro", !!erro);
  }

  function adicionar() {
    var campo = $("#lkLongos");
    var linhas = campo.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!linhas.length) { dizer("Cole pelo menos um link.", true); campo.focus(); return; }
    var btn = $("#lkAdicionar");
    btn.disabled = true;
    dizer("Salvando…");
    chamar("POST", "/links", { urls: linhas, titulo: $("#lkTitulo").value }).then(function (d) {
      if (!noModal()) return;
      var n = d.criados.length;
      LK.links = d.criados.concat(LK.links);
      campo.value = "";
      $("#lkTitulo").value = "";
      var partes = [];
      if (n) partes.push(n + (n === 1 ? " link adicionado." : " links adicionados."));
      if (d.repetidos) partes.push(d.repetidos + " já estava na lista.");
      if (d.invalidas) partes.push(d.invalidas + " inválido(s) ignorado(s).");
      dizer(partes.join(" "), !n);
      if (n) {
        $("#lkAdd").open = false; // volta o foco para a lista
        avisar(partes.join(" "));
      }
      desenhar();
    }).catch(function (e) {
      dizer(e.message + (e.dica ? " " + e.dica : ""), true);
    }).then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------ lista */

  function visiveis() {
    var f = LK.busca.trim().toLowerCase();
    return LK.links.filter(function (l) {
      return !f || (l.titulo + " " + l.url_longa + " " + (l.url_curta || "")).toLowerCase().indexOf(f) > -1;
    });
  }

  function painelGerar(l) {
    var st = LK.status[l.id] || {};
    var ocupado = !!LK.ocupado[l.id];
    var alias = LK.alias[l.id] !== undefined ? LK.alias[l.id] : (l.alias || "");
    var botoes = SERVICOS.map(function (s) {
      var igual = l.servico === s[0];
      return '<button class="lk-btn' + (igual ? " sugerido" : "") + '" data-act="gerar" data-svc="' + s[0] + '" data-id="' + l.id + '" type="button"' +
        (ocupado ? " disabled" : "") + ">" + s[1] + "</button>";
    }).join("");
    return '<div class="lk-gerar">' +
      '<label class="lk-rot">Final do endereço (opcional)' +
        '<input class="campo" data-alias="' + l.id + '" autocomplete="off" placeholder="Ex.: tccpedro" value="' + esc(alias) + '"></label>' +
      '<div class="lk-dica" data-dica="' + l.id + '">' + esc(dicaAlias(alias)) + "</div>" +
      '<div class="lk-svcs"><span>Encurtar com</span>' + botoes + "</div>" +
      '<div class="lk-dica' + (st.erro ? " erro" : "") + '">' +
        (ocupado ? "Encurtando…" : esc(st.texto || (l.url_curta ? "O link atual continua valendo até o novo ser gerado." : ""))) +
        (st.manual ? ' <a href="' + esc(st.manual) + '" target="_blank" rel="noopener">Abrir no site</a> e cole o resultado abaixo.' : "") +
      "</div>" +
      '<div class="lk-colar"><input class="campo" data-colar="' + l.id + '" autocomplete="off" placeholder="Ou cole aqui um link curto que você gerou" aria-label="Link curto">' +
      '<button class="lk-btn" data-act="colar" data-id="' + l.id + '" type="button">Salvar</button></div>' +
    "</div>";
  }

  function cartao(l) {
    var titulo = esc(l.titulo || host(l.url_longa));
    var meta = l.url_curta
      ? esc((ROTULO[l.servico] || "") + (l.curto_em ? (l.servico ? " · " : "") + idade(l.curto_em) : ""))
      : "sem link curto";
    var abertoGerar = !l.url_curta || LK.gerar[l.id];
    var acoes = "";
    if (l.url_curta) {
      acoes +=
        '<button class="lk-btn forte" data-act="cs" data-id="' + l.id + '" type="button">Copiar curto</button>' +
        '<button class="lk-btn" data-act="pres" data-id="' + l.id + '" type="button">Apresentar</button>' +
        '<button class="lk-btn" data-act="regerar" data-id="' + l.id + '" type="button">' + (LK.gerar[l.id] ? "Fechar" : "Gerar de novo") + "</button>";
    }
    acoes +=
      '<button class="lk-btn" data-act="cl" data-id="' + l.id + '" type="button">Copiar longo</button>' +
      '<button class="lk-btn perigo" data-act="del" data-id="' + l.id + '" type="button">Excluir</button>';

    return '<div class="lk-card" data-card="' + l.id + '">' +
      '<div class="lk-topo"><strong>' + titulo + '</strong><span class="lk-meta">' + meta + "</span></div>" +
      (l.url_curta ? '<div class="lk-curto">' + esc(semProtocolo(l.url_curta)) + "</div>" : "") +
      '<div class="lk-longo" title="' + esc(l.url_longa) + '">' + esc(l.url_longa) + "</div>" +
      (abertoGerar ? painelGerar(l) : "") +
      '<div class="lk-acoes">' + acoes + "</div>" +
    "</div>";
  }

  function desenhar() {
    if (!noModal()) return;
    var lista = $("#lkLista");
    var conta = $("#lkConta");
    if (conta) conta.textContent = LK.links.length ? "Salvos (" + LK.links.length + ")" : "Salvos";

    if (LK.carregando) { lista.innerHTML = esqueletos(2); return; }
    if (LK.erro) {
      lista.innerHTML = '<div class="vazio"><h3>Não deu pra carregar</h3><p>' + esc(LK.erro) + "</p></div>" +
        '<button class="btn btn-suave btn-largo" id="lkTentar" type="button">Tentar de novo</button>';
      $("#lkTentar").addEventListener("click", function () { LK.carregando = true; desenhar(); carregar(); });
      return;
    }
    var rows = visiveis();
    if (!rows.length) {
      lista.innerHTML = '<div class="vazio"><h3>' + (LK.links.length ? "Nada encontrado" : "Nenhum link salvo") + "</h3><p>" +
        (LK.links.length ? "Nenhum link bate com essa busca." : "Cole um ou vários links acima para começar.") + "</p></div>";
      return;
    }
    lista.innerHTML = rows.map(cartao).join("");
  }

  /* ------------------------------------------------------------ acoes */

  function aoDigitar(e) {
    var el = e.target;
    var id = el.getAttribute("data-alias");
    if (!id) return;
    var limpo = el.value.replace(/[^A-Za-z0-9_]/g, "");
    if (el.value !== limpo) el.value = limpo;
    LK.alias[id] = limpo;
    var d = $("#lkLista").querySelector('[data-dica="' + id + '"]');
    if (d) d.textContent = dicaAlias(limpo);
  }

  function gerar(id, servico) {
    var l = achar(id);
    if (!l) return;
    LK.ocupado[id] = true;
    LK.status[id] = {};
    desenhar();
    var alias = LK.alias[id] !== undefined ? LK.alias[id] : (l.alias || "");
    chamar("POST", "/links/" + id + "/encurtar", { servico: servico, alias: alias }).then(function (d) {
      Object.assign(l, d.link);
      delete LK.gerar[id];
      delete LK.status[id];
      avisar("Link curto salvo");
    }).catch(function (e) {
      LK.status[id] = { erro: true, texto: "Erro: " + e.message, manual: e.manual };
    }).then(function () {
      delete LK.ocupado[id];
      desenhar();
    });
  }

  function colar(id) {
    var inp = $("#lkLista").querySelector('[data-colar="' + id + '"]');
    var l = achar(id);
    if (!inp || !l) return;
    if (!inp.value.trim()) { avisar("Cole o link curto primeiro"); return; }
    chamar("PATCH", "/links/" + id, { url_curta: inp.value }).then(function (d) {
      Object.assign(l, d.link);
      delete LK.gerar[id];
      delete LK.status[id];
      desenhar();
      avisar("Link curto salvo");
    }).catch(function (e) { avisar(e.message); });
  }

  var armado = null; // { id, timer } do botao Excluir esperando confirmacao

  function excluir(btn, id) {
    if (!armado || armado.id !== id) {
      if (armado) { clearTimeout(armado.timer); desarmar(); }
      btn.textContent = "Confirmar exclusão";
      btn.classList.add("armado");
      armado = { id: id, btn: btn, timer: setTimeout(desarmar, 3000) };
      return;
    }
    clearTimeout(armado.timer);
    armado = null;
    chamar("DELETE", "/links/" + id).then(function () {
      LK.links = LK.links.filter(function (x) { return x.id !== id; });
      desenhar();
      avisar("Link excluído");
    }).catch(function (e) { avisar(e.message); });
  }

  function desarmar() {
    if (armado && armado.btn.isConnected) {
      armado.btn.textContent = "Excluir";
      armado.btn.classList.remove("armado");
    }
    armado = null;
  }

  function aoClicar(e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = b.getAttribute("data-id");
    var act = b.getAttribute("data-act");
    var l = achar(id);
    if (!l) return;

    if (act === "del") return excluir(b, id);
    if (act === "gerar") return gerar(id, b.getAttribute("data-svc"));
    if (act === "colar") return colar(id);
    if (act === "cs") return copiar(l.url_curta, "Link curto copiado");
    if (act === "cl") return copiar(l.url_longa, "Link longo copiado");
    if (act === "pres") return apresentar(l);
    if (act === "regerar") {
      if (LK.gerar[id]) delete LK.gerar[id]; else LK.gerar[id] = true;
      delete LK.status[id];
      desenhar();
    }
  }

  /* ------------------------------------------------------------ apresentar */

  function apresentar(l) {
    var el = document.getElementById("lkPres");
    if (!el) {
      el = document.createElement("div");
      el.id = "lkPres";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");
      el.setAttribute("aria-label", "Modo apresentação");
      el.innerHTML = '<div class="lk-pres-cap"></div><div class="lk-pres-big"></div>' +
        '<div class="lk-pres-cap">Toque ou pressione Esc para fechar</div>';
      el.addEventListener("click", fecharPres);
      document.body.appendChild(el);
    }
    el.children[0].textContent = l.titulo || host(l.url_longa);
    el.children[1].textContent = semProtocolo(l.url_curta);
    el.classList.add("aberto");
  }

  function fecharPres() {
    var el = document.getElementById("lkPres");
    if (el) el.classList.remove("aberto");
  }

  // Captura: o Esc fecha so a apresentacao, e o modal de tras continua aberto.
  document.addEventListener("keydown", function (e) {
    var el = document.getElementById("lkPres");
    if (e.key === "Escape" && el && el.classList.contains("aberto")) {
      e.stopImmediatePropagation();
      fecharPres();
    }
  }, true);

  window.SegundoCerebroLinks = { abrir: abrir };
})();

/**
 * Segundo Cérebro - Navegação Universal do Ecossistema
 *
 * Padroniza a barra de navegação (Navbar) e o menu entre TODOS os módulos:
 *  - Início (Segundo Cérebro / Memória)
 *  - Conversa (Assistente IA integrado)
 *  - Treino (Fichas, cargas e séries)
 *  - Refeições (Nutrição, calorias e macros)
 *  - Trabalho (ClickUp e tarefas)
 *  - Música (Player Sua Música e rádio)
 *
 * Novos módulos só precisam importar estilos.css e navegacao.js.
 */
(function () {
  "use strict";

  var MODULOS = [
    {
      id: "inicio",
      nome: "Segundo cérebro",
      rota: "/",
      descricao: "Mural de ideias, memórias e sinapses",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 2a5 5 0 0 0-5 5v1a5 5 0 0 0-3 4.5A4.5 4.5 0 0 0 8.5 17H9v3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3h.5a4.5 4.5 0 0 0 4.5-4.5A5 5 0 0 0 17 8V7a5 5 0 0 0-5-5z"/>' +
        '<path d="M9 12h6M10 8h4M10 16h4"/></svg>',
    },
    {
      id: "conversa",
      nome: "Conversa",
      rota: "/conversa",
      descricao: "Assistente IA conectado ao seu ecossistema",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
        '<path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>',
    },
    {
      id: "treino",
      nome: "Treino",
      rota: "/treino",
      descricao: "Fichas, cargas, sessões e gasto calórico",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 7v10M18 7v10M2 9v6M22 9v6M6 12h12"/></svg>',
    },
    {
      id: "refeicao",
      nome: "Refeições",
      rota: "/refeicao",
      descricao: "Nutrição, macronutrientes e diário alimentar",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>',
    },
    {
      id: "trabalho",
      nome: "Trabalho",
      rota: "/trabalho",
      descricao: "Tarefas do ClickUp, daily e prazos",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    },
    {
      id: "musica",
      nome: "Música",
      rota: "/musica",
      descricao: "Player Sua Música e rádio infinita",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    },
    {
      id: "trendradar",
      nome: "TrendRadar",
      rota: "/trendradar",
      descricao: "Radar estratégico de tendências e oportunidades B2B",
      icone:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    },
  ];

  var TEMAS = {
    sistema: "Tema do sistema",
    claro: "Tema claro",
    escuro: "Tema escuro",
  };

  function detectarModuloAtual() {
    var p = window.location.pathname.replace(/\/$/, "");
    if (!p || p === "" || p === "/index.html") return "inicio";
    var prim = p.split("/")[1];
    for (var i = 0; i < MODULOS.length; i++) {
      if (MODULOS[i].id === prim) return prim;
    }
    return document.body ? document.body.dataset.modulo || "inicio" : "inicio";
  }

  function aplicarTema(tema) {
    if (!TEMAS[tema]) tema = "sistema";
    document.documentElement.dataset.tema = tema;
    try {
      localStorage.setItem("2brain-tema", tema);
    } catch (e) {}
  }

  function criarEstruturaModal() {
    if (document.getElementById("ecoCortina") && document.getElementById("ecoSheet")) return;

    var cortina = document.getElementById("ecoCortina");
    if (!cortina) {
      cortina = document.createElement("div");
      cortina.className = "cortina";
      cortina.id = "ecoCortina";
      cortina.setAttribute("aria-hidden", "true");
      document.body.appendChild(cortina);
    }

    var sheet = document.getElementById("ecoSheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "sheet eco-sheet-modal";
      sheet.id = "ecoSheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.innerHTML =
        '<div class="puxador"></div>' +
        '<div class="sheet-cab">' +
          '<h3 id="ecoSheetTitulo">Ecossistema Segundo cérebro</h3>' +
          '<button class="icone-btn" id="ecoBtnFechaSheet" aria-label="Fechar">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="sheet-corpo" id="ecoSheetCorpo"></div>';
      document.body.appendChild(sheet);
    }

    cortina.addEventListener("click", fecharMenuEcossistema);
    var btnFecha = document.getElementById("ecoBtnFechaSheet");
    if (btnFecha) btnFecha.addEventListener("click", fecharMenuEcossistema);
  }

  function abrirMenuEcossistema() {
    criarEstruturaModal();
    var cortina = document.getElementById("ecoCortina");
    var sheet = document.getElementById("ecoSheet");
    var corpo = document.getElementById("ecoSheetCorpo");
    if (!sheet || !corpo) return;

    var moduloAtual = detectarModuloAtual();
    var temaAtual = document.documentElement.dataset.tema || "sistema";

    // Bloco dos Módulos do Ecossistema
    var modulosHtml = MODULOS.map(function (m) {
      var ativo = m.id === moduloAtual;
      return (
        '<a href="' + m.rota + '" class="item eco-modulo-item ' + (ativo ? "ativo" : "") + '">' +
        m.icone +
        '<div class="item-txt">' +
          '<strong>' + m.nome + (ativo ? ' <span class="badge-modulo-atual">atual</span>' : "") + "</strong>" +
          "<span>" + m.descricao + "</span>" +
        "</div>" +
        (ativo
          ? '<span class="eco-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg></span>'
          : '<svg class="eco-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>') +
        "</a>"
      );
    }).join("");

    // Bloco de Temas
    var checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg>';
    var temasHtml = Object.keys(TEMAS).map(function (k) {
      return (
        '<button class="item eco-tema-btn" data-tema="' + k + '">' +
          '<div class="item-txt"><strong>' + TEMAS[k] + "</strong></div>" +
          (temaAtual === k ? checkSvg : "") +
        "</button>"
      );
    }).join("");

    // Bloco de Sessão / Logout
    var logoutIcon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>' +
      '</svg>';

    var sessaoHtml =
      '<p class="grupo-titulo">Sessão</p>' +
      '<div class="grupo">' +
        '<button class="item destrutivo" id="ecoBtnSair">' +
          logoutIcon +
          '<div class="item-txt">' +
            '<strong>Sair da conta</strong>' +
            '<span>Apaga o PIN salvo e bloqueia este navegador</span>' +
          '</div>' +
        '</button>' +
      '</div>';

    corpo.innerHTML =
      '<p class="grupo-titulo">Módulos do ecossistema</p>' +
      '<div class="grupo">' + modulosHtml + "</div>" +
      '<p class="grupo-titulo">Aparência</p>' +
      '<div class="grupo">' + temasHtml + "</div>" +
      sessaoHtml;

    // Event listener de Sair da conta
    var btnSair = corpo.querySelector("#ecoBtnSair");
    if (btnSair) {
      btnSair.addEventListener("click", function () {
        if (window.SegundoCerebroPin && window.SegundoCerebroPin.sair) {
          window.SegundoCerebroPin.sair();
        } else {
          if (!window.confirm("Deseja sair da sua conta e apagar o PIN salvo neste dispositivo?")) return;
          try {
            localStorage.removeItem("2brain-pin");
            localStorage.removeItem("2brain-conversa-id");
          } catch (e) {}
          window.location.href = "/";
          setTimeout(function () { window.location.reload(); }, 60);
        }
      });
    }

    // Event listeners dos temas
    corpo.querySelectorAll(".eco-tema-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        aplicarTema(btn.dataset.tema);
        abrirMenuEcossistema();
      });
    });

    cortina.classList.add("visivel", "aberta");
    sheet.classList.add("visivel", "aberto");
  }

  function fecharMenuEcossistema() {
    var cortina = document.getElementById("ecoCortina");
    var sheet = document.getElementById("ecoSheet");
    if (cortina) cortina.classList.remove("visivel", "aberta");
    if (sheet) sheet.classList.remove("visivel", "aberto");
  }

  function padronizarNavbar() {
    var barra = document.getElementById("barra");
    if (!barra) return;

    var barraInt = barra.querySelector(".barra-int");
    if (!barraInt) return;

    var moduloAtualId = detectarModuloAtual();
    var infoModulo = null;
    for (var i = 0; i < MODULOS.length; i++) {
      if (MODULOS[i].id === moduloAtualId) {
        infoModulo = MODULOS[i];
        break;
      }
    }
    if (!infoModulo) {
      infoModulo = { id: moduloAtualId, nome: document.title || "Módulo", rota: "/" };
    }

    var isInicio = moduloAtualId === "inicio" || window.location.pathname === "/";

    // 1. Marca / Hierarquia do lado esquerdo
    var marcaExistente = barraInt.querySelector(".barra-marca, .voltar-barra, .voltar");
    var marcaBloco = barraInt.querySelector(".barra-marca-bloco");

    if (!marcaBloco) {
      marcaBloco = document.createElement("div");
      marcaBloco.className = "barra-marca-bloco";

      var marcaLink = document.createElement("a");
      marcaLink.href = "/";
      marcaLink.className = "barra-marca";
      marcaLink.title = "Ir para início do Segundo cérebro";
      marcaLink.setAttribute("aria-label", "Segundo cérebro");
      marcaLink.innerHTML =
        '<img src="/cerebro-mini.svg" alt="" width="28" height="28" draggable="false" />';

      marcaBloco.appendChild(marcaLink);

      if (!isInicio) {
        var sep = document.createElement("span");
        sep.className = "barra-separador-modulo";
        sep.textContent = "/";
        sep.setAttribute("aria-hidden", "true");

        var modAtual = document.createElement("span");
        modAtual.className = "barra-modulo-atual";
        modAtual.textContent = infoModulo.nome;

        marcaBloco.appendChild(sep);
        marcaBloco.appendChild(modAtual);
      }

      if (marcaExistente) {
        barraInt.replaceChild(marcaBloco, marcaExistente);
      } else {
        barraInt.insertBefore(marcaBloco, barraInt.firstChild);
      }
    } else {
      var nomeExistente = marcaBloco.querySelector(".barra-marca-nome");
      if (nomeExistente) nomeExistente.remove();
      var linkMarca = marcaBloco.querySelector(".barra-marca");
      if (linkMarca && !linkMarca.getAttribute("aria-label")) {
        linkMarca.setAttribute("aria-label", "Segundo cérebro");
      }
    }

    // 2. Título ao rolar (remove duplicados desnecessários na barra)
    var titulosAntigos = barraInt.querySelectorAll(".barra-titulo");
    titulosAntigos.forEach(function (t) {
      t.remove();
    });

    // 3. Ações no lado direito
    var acoes = barraInt.querySelector(".barra-acoes");
    if (!acoes) {
      acoes = document.createElement("div");
      acoes.className = "barra-acoes";
      acoes.id = "barraAcoes";
      barraInt.appendChild(acoes);
    }

    // 4. Navegação desktop entre módulos (visível apenas em telas desktop via CSS)
    var navDesktop = barraInt.querySelector(".barra-modulos-desktop");
    if (!navDesktop) {
      navDesktop = document.createElement("nav");
      navDesktop.className = "barra-modulos-desktop";
      navDesktop.setAttribute("aria-label", "Módulos do ecossistema");
      navDesktop.innerHTML = MODULOS.map(function (m) {
        var ativo = m.id === moduloAtualId;
        if (m.id === "musica") {
          return (
            '<div class="barra-desktop-musica-slot" id="navMusicaSlot">' +
              '<a href="' + m.rota + '" class="barra-desktop-item ' + (ativo ? "ativo" : "") + '" title="' + m.descricao + '">' +
                '<span class="barra-desktop-ico">' + m.icone + '</span>' +
                '<span class="barra-desktop-nome">' + m.nome + '</span>' +
              '</a>' +
            '</div>'
          );
        }
        return (
          '<a href="' + m.rota + '" class="barra-desktop-item ' + (ativo ? "ativo" : "") + '" title="' + m.descricao + '">' +
            '<span class="barra-desktop-ico">' + m.icone + '</span>' +
            '<span class="barra-desktop-nome">' + m.nome + '</span>' +
          '</a>'
        );
      }).join("");
      barraInt.insertBefore(navDesktop, acoes);
      iniciarMiniplayerUniversal();
    } else {
      iniciarMiniplayerUniversal();
    }

    // Garante que o botão de Menu do Ecossistema exista
    var btnEco = barraInt.querySelector("#btnMenuEco, #btnMenu");
    if (!btnEco && !isInicio) {
      btnEco = document.createElement("button");
      btnEco.className = "icone-btn btn-menu-eco";
      btnEco.id = "btnMenuEco";
      btnEco.setAttribute("aria-label", "Menu do ecossistema");
      btnEco.setAttribute("title", "Menu do ecossistema");
      btnEco.innerHTML =
        '<svg viewBox="0 0 24 24" fill="currentColor">' +
        '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>' +
        '</svg>';
      acoes.appendChild(btnEco);
      btnEco.addEventListener("click", abrirMenuEcossistema);
    } else if (btnEco && !isInicio) {
      // Se não for o início e já tiver um btnMenu ou btnMenuEco, adiciona o handler
      btnEco.addEventListener("click", function (e) {
        // Se a página tem um menu próprio (como trabalho ou treino), o menu do ecossistema
        // pode ser aberto ou coordenado. Se for btnMenuEco, abre direto.
        if (btnEco.id === "btnMenuEco") {
          e.stopImmediatePropagation();
          abrirMenuEcossistema();
        }
      });
    }

    // Adiciona listener de rolagem suave na barra
    var rolouAntes = false;
    function aoRolar() {
      var rolou = window.scrollY > 12;
      if (rolou !== rolouAntes) {
        barra.classList.toggle("rolou", rolou);
        rolouAntes = rolou;
      }
    }
    window.addEventListener("scroll", aoRolar, { passive: true });
    aoRolar();
  }

  /* ============================================================
     Miniplayer Universal de Música na Navbar
     Sincroniza áudio, fila e controles entre abas e telas.
     ============================================================ */

  var canalMusica = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("2brain-musica") : null;
  var audioGlobal = null;
  var ultimoEstadoMusica = null;
  var ultimoTempoGravado = 0;

  var ICONE_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ICONE_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function lerEstadoMusicaStorage() {
    try {
      var est = JSON.parse(localStorage.getItem("mus:estado"));
      if (est && est.faixa) return est;
    } catch (e) {}
    try {
      var fila = JSON.parse(localStorage.getItem("mus:fila")) || [];
      var idx = JSON.parse(localStorage.getItem("mus:indice"));
      if (idx == null) idx = -1;
      var f = fila[idx];
      if (f) {
        return {
          tocando: false,
          indice: idx,
          faixa: {
            id: f.id,
            titulo: f.titulo,
            artista: f.artista,
            cd: f.cd,
            capa: f.capa,
            audio: f.audio,
            link: f.link,
          },
          radio: JSON.parse(localStorage.getItem("mus:radio")) || "nao",
          totalFila: fila.length,
        };
      }
    } catch (e) {}
    return null;
  }

  function renderizarMiniplayerNavbar(estado) {
    var slot = document.getElementById("navMusicaSlot");
    if (!slot) return;
    ultimoEstadoMusica = estado;

    var moduloAtual = detectarModuloAtual();
    var isMusica = moduloAtual === "musica";

    var infoMusica = MODULOS.filter(function (m) { return m.id === "musica"; })[0];
    var iconePadrao = infoMusica ? infoMusica.icone : "";

    // Se não há música ativa ou fila vazia, mostra botão tradicional
    if (!estado || !estado.faixa) {
      slot.innerHTML =
        '<a href="/musica" class="barra-desktop-item ' + (isMusica ? "ativo" : "") + '" title="Player Sua Música e rádio">' +
          '<span class="barra-desktop-ico">' + iconePadrao + '</span>' +
          '<span class="barra-desktop-nome">Música</span>' +
        '</a>';
      atualizarBotaoMobile(null);
      return;
    }

    var f = estado.faixa;
    var tocando = !!estado.tocando;

    slot.innerHTML =
      '<div class="nav-miniplayer ' + (tocando ? "tocando " : "") + (isMusica ? "ativo" : "") + '" id="navMiniplayer">' +
        '<button type="button" class="nav-mp-pill" id="navMpToggle" title="' + (tocando ? "Pausar" : "Tocar") + ': ' + escHtml(f.titulo) + '">' +
          '<div class="nav-mp-capa-wrap">' +
            (f.capa
              ? '<img src="' + escHtml(f.capa) + '" class="nav-mp-capa" alt="" referrerpolicy="no-referrer" />'
              : '<span class="nav-mp-capa-padrao">' + iconePadrao + '</span>') +
            '<div class="nav-mp-ondas" aria-hidden="true"><span></span><span></span><span></span></div>' +
          '</div>' +
          '<span class="nav-mp-tit">' + escHtml(f.titulo) + '</span>' +
          '<span class="nav-mp-ico-acao">' + (tocando ? ICONE_PAUSE : ICONE_PLAY) + '</span>' +
        '</button>' +
        '<a href="/musica" class="nav-mp-expandir" title="Abrir player completo de Música">' +
          '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>' +
        '</a>' +
      '</div>';

    var btnToggle = slot.querySelector("#navMpToggle");
    if (btnToggle) {
      btnToggle.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        alternarPlayUniversal();
      });
    }

    atualizarBotaoMobile(estado);
  }

  function atualizarBotaoMobile(estado) {
    var acoes = document.getElementById("barraAcoes");
    if (!acoes) return;

    var btnMobile = acoes.querySelector("#navMobileMusicaBtn");
    if (!estado || !estado.faixa || !estado.tocando) {
      if (btnMobile) btnMobile.remove();
      return;
    }

    if (!btnMobile) {
      btnMobile = document.createElement("a");
      btnMobile.href = "/musica";
      btnMobile.className = "nav-mobile-musica-btn";
      btnMobile.id = "navMobileMusicaBtn";
      btnMobile.title = "Música tocando: " + estado.faixa.titulo;
      acoes.insertBefore(btnMobile, acoes.firstChild);
    }

    btnMobile.innerHTML =
      '<div class="nav-mp-capa-wrap" style="width:24px;height:24px;border-radius:50%">' +
        (estado.faixa.capa
          ? '<img src="' + escHtml(estado.faixa.capa) + '" class="nav-mp-capa" alt="" referrerpolicy="no-referrer" />'
          : '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1 14.5v-9l6 4.5z"/></svg>') +
        '<div class="nav-mp-ondas" style="opacity:1;border-radius:50%"><span></span><span></span><span></span></div>' +
      '</div>';
  }

  function alternarPlayUniversal() {
    var estado = ultimoEstadoMusica || lerEstadoMusicaStorage();
    if (!estado || !estado.faixa) return;

    var modulo = detectarModuloAtual();
    if (modulo === "musica") {
      var bTocar = document.getElementById("bTocar");
      if (bTocar) bTocar.click();
      return;
    }

    tocarOuPausarLocal(estado);
  }

  function obterAudioGlobal() {
    if (!audioGlobal) {
      audioGlobal = new Audio();
      audioGlobal.preload = "auto";
      audioGlobal.addEventListener("timeupdate", function () {
        if (Date.now() - ultimoTempoGravado > 1500) {
          ultimoTempoGravado = Date.now();
          var est = lerEstadoMusicaStorage() || {};
          est.tempo = audioGlobal.currentTime;
          est.tocando = !audioGlobal.paused;
          try { localStorage.setItem("mus:estado", JSON.stringify(est)); } catch (e) {}
        }
      });
      audioGlobal.addEventListener("play", function () {
        var est = lerEstadoMusicaStorage() || {};
        est.tocando = true;
        est.timestamp = Date.now();
        est.origem = "nav";
        try { localStorage.setItem("mus:estado", JSON.stringify(est)); } catch (e) {}
        renderizarMiniplayerNavbar(est);
        if (canalMusica) canalMusica.postMessage({ tipo: "estado", estado: est });
      });
      audioGlobal.addEventListener("pause", function () {
        var est = lerEstadoMusicaStorage() || {};
        est.tocando = false;
        est.timestamp = Date.now();
        est.origem = "nav";
        try { localStorage.setItem("mus:estado", JSON.stringify(est)); } catch (e) {}
        renderizarMiniplayerNavbar(est);
        if (canalMusica) canalMusica.postMessage({ tipo: "estado", estado: est });
      });
      audioGlobal.addEventListener("ended", function () {
        avancarLocal();
      });
      window.addEventListener("beforeunload", function () {
        if (audioGlobal && !audioGlobal.paused) {
          var est = lerEstadoMusicaStorage() || {};
          est.tocando = true;
          est.tempo = audioGlobal.currentTime;
          est.timestamp = Date.now();
          try { localStorage.setItem("mus:estado", JSON.stringify(est)); } catch (e) {}
        }
      });
    }
    return audioGlobal;
  }

  function tocarOuPausarLocal(estado, forcarPlay) {
    var a = obterAudioGlobal();
    if (!estado || !estado.faixa) return;

    if (a.paused || forcarPlay) {
      if (estado.faixa.audio) {
        var precisaTrocarSrc = (a.src !== estado.faixa.audio && a.src.indexOf(encodeURI(estado.faixa.audio)) === -1);
        var targetTime = (typeof estado.tempo === "number" && estado.tempo > 0.5) ? estado.tempo : 0;

        if (precisaTrocarSrc) {
          var url = estado.faixa.audio;
          // Fragmento nativo de mídia (#t=XX.X): inicia stream direto na posição
          if (targetTime > 0 && url.indexOf("#") === -1) {
            url += "#t=" + (Math.round(targetTime * 10) / 10);
          }
          a.src = url;

          if (targetTime > 0) {
            // Silencia no primeiro milissegundo de buffer para evitar tocar o começo da música
            a.muted = true;
            var aplicarTempo = function () {
              try {
                if (Math.abs(a.currentTime - targetTime) > 1.2) {
                  a.currentTime = targetTime;
                }
              } catch (e) {}
              a.muted = false;
            };
            a.addEventListener("loadedmetadata", aplicarTempo, { once: true });
            a.addEventListener("canplay", function () { a.muted = false; }, { once: true });
            setTimeout(function () { a.muted = false; }, 350);
          }
        } else if (targetTime > 0 && Math.abs(a.currentTime - targetTime) > 2) {
          try { a.currentTime = targetTime; } catch (e) {}
        }

        var p = a.play();
        if (p !== undefined) {
          p.then(function () {
            estado.tocando = true;
            renderizarMiniplayerNavbar(estado);
          }).catch(function (err) {
            console.log("[nav-miniplayer] aguardando interação:", err.message);
            function aoInteragir() {
              a.play().then(function () {
                estado.tocando = true;
                renderizarMiniplayerNavbar(estado);
              }).catch(function () {});
              window.removeEventListener("pointerdown", aoInteragir, true);
              window.removeEventListener("keydown", aoInteragir, true);
            }
            window.addEventListener("pointerdown", aoInteragir, true);
            window.addEventListener("keydown", aoInteragir, true);
          });
        }
      }
    } else {
      a.pause();
      estado.tocando = false;
      renderizarMiniplayerNavbar(estado);
    }
  }

  function avancarLocal() {
    try {
      var fila = JSON.parse(localStorage.getItem("mus:fila")) || [];
      var idx = JSON.parse(localStorage.getItem("mus:indice")) || 0;
      if (idx < fila.length - 1) {
        idx++;
        localStorage.setItem("mus:indice", JSON.stringify(idx));
        var f = fila[idx];
        if (f) {
          var novoEstado = {
            tocando: true,
            indice: idx,
            faixa: f,
            totalFila: fila.length,
            origem: "nav",
            timestamp: Date.now(),
          };
          localStorage.setItem("mus:estado", JSON.stringify(novoEstado));
          renderizarMiniplayerNavbar(novoEstado);
          var a = obterAudioGlobal();
          a.src = f.audio;
          a.play().catch(function () {});
        }
      }
    } catch (e) {}
  }

  function iniciarMiniplayerUniversal() {
    var estado = lerEstadoMusicaStorage();
    var moduloAtual = detectarModuloAtual();

    renderizarMiniplayerNavbar(estado);

    // Se o usuário estava com a música tocando e mudou de tela (ex: /treino, /refeicao)
    if (moduloAtual !== "musica" && estado && estado.tocando && estado.faixa && estado.faixa.audio) {
      tocarOuPausarLocal(estado, true);
    }

    if (canalMusica) {
      canalMusica.addEventListener("message", function (e) {
        var d = e.data;
        if (!d) return;
        if (d.tipo === "estado" && d.estado) {
          if (d.estado.origem === "master" && d.estado.tocando && audioGlobal && !audioGlobal.paused) {
            audioGlobal.pause();
          }
          renderizarMiniplayerNavbar(d.estado);
        }
      });
    }

    window.addEventListener("storage", function (e) {
      if (e.key === "mus:estado" || e.key === "mus:fila" || e.key === "mus:indice") {
        renderizarMiniplayerNavbar(lerEstadoMusicaStorage());
      }
    });

    // Salva o timestamp exato do áudio no momento do clique no link,
    // antes do navegador iniciar o descarregamento da página
    document.addEventListener("click", function (e) {
      var link = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!link || !link.href) return;
      if (audioGlobal && !audioGlobal.paused) {
        var est = lerEstadoMusicaStorage() || {};
        est.tocando = true;
        est.tempo = audioGlobal.currentTime;
        est.timestamp = Date.now();
        try { localStorage.setItem("mus:estado", JSON.stringify(est)); } catch (err) {}
      }
    }, true);

    // Pré-carrega páginas internas no hover para transição instantânea sem pausa
    document.addEventListener("pointerenter", function (e) {
      var link = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!link || !link.href) return;
      var href = link.getAttribute("href");
      if (href && href.startsWith("/") && !href.startsWith("//") && !href.includes("#") && href.length > 1) {
        if (!link.dataset.prefetched) {
          link.dataset.prefetched = "1";
          var prefetch = document.createElement("link");
          prefetch.rel = "prefetch";
          prefetch.href = href;
          document.head.appendChild(prefetch);
        }
      }
    }, true);
  }

  // Inicialização automática quando o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", padronizarNavbar);
  } else {
    padronizarNavbar();
  }

  // Expõe a API global para módulos e extensões
  window.SegundoCerebroNav = {
    modulos: MODULOS,
    detectarModuloAtual: detectarModuloAtual,
    abrirMenu: abrirMenuEcossistema,
    fecharMenu: fecharMenuEcossistema,
    aplicarTema: aplicarTema,
    padronizarNavbar: padronizarNavbar,
  };
})();

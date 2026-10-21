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

    corpo.innerHTML =
      '<p class="grupo-titulo">Módulos do ecossistema</p>' +
      '<div class="grupo">' + modulosHtml + "</div>" +
      '<p class="grupo-titulo">Aparência</p>' +
      '<div class="grupo">' + temasHtml + "</div>";

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
      marcaLink.innerHTML =
        '<img src="/cerebro-mini.svg" alt="" width="22" height="22" draggable="false" />' +
        '<span class="barra-marca-nome">Segundo cérebro</span>';

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
        return (
          '<a href="' + m.rota + '" class="barra-desktop-item ' + (ativo ? "ativo" : "") + '" title="' + m.descricao + '">' +
            '<span class="barra-desktop-ico">' + m.icone + '</span>' +
            '<span class="barra-desktop-nome">' + m.nome + '</span>' +
          '</a>'
        );
      }).join("");
      barraInt.insertBefore(navDesktop, acoes);
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

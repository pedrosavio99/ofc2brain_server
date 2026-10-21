/**
 * Papel: Cliente SPA do modulo TrendRadar integrado ao Segundo Cerebro.
 * Organiza as 6 frentes de mercado na tela principal e concentra todas as ferramentas
 * avancadas (Pesquisar Alvo, Importar CSV, Relatorio MD/PDF, Sintese IA, Cotas API,
 * Motor de IA, Filtros de Entidade/Objetivo e Tema) no menu ••• da navbar.
 * O que NAO faz: nunca acessa banco diretamente nem expoe chaves secretas no navegador.
 */

const CHAVE_STORAGE = "segundo_cerebro_trendradar_v2";
const CHAVE_TEMA = "tema_preferido";

const FRENTES_META = {
  todas: { rotulo: "Todas as 6 Frentes", curto: "Todas" },
  saude: { rotulo: "1. Saúde & Clínicas B2B", curto: "Saúde & Clínicas" },
  fintech: { rotulo: "2. FinTech, E-commerce & Fiscal", curto: "FinTech & Fiscal" },
  regtech: { rotulo: "3. RegTech, RH & Conformidade", curto: "RegTech & RH" },
  govtech: { rotulo: "4. GovTech, Jurídico & Dados", curto: "GovTech & Dados" },
  operacoes: { rotulo: "5. Obras & Operações de Campo", curto: "Obras & Campo" },
  ia_devtools: { rotulo: "6. Engenharia IA & Anti-Hype", curto: "Engenharia IA & Anti-Hype" }
};

const OBJETIVOS_META = {
  todos: {
    rotulo: "Todos os 4 Objetivos",
    descricao: "Visão integrada: Carreira Dev + SaaS + Serviços B2B + Agente Autônomo."
  },
  carreira: {
    rotulo: "1. Carreira Dev",
    descricao: "Projetos de alto impacto técnico para entrevistas e portfólio sênior."
  },
  saas: {
    rotulo: "2. Criar SaaS",
    descricao: "Produtos com receita recorrente (MRR), dor aguda e baixo churn."
  },
  empresas: {
    rotulo: "3. Serviços B2B",
    descricao: "Soluções de retorno imediato para vender implantação ou auditoria para empresas."
  },
  agente: {
    rotulo: "4. Agente Autônomo",
    descricao: "Fluxos que o agente monitora e consolida em relatórios Markdown/PDF."
  }
};

const ENTIDADES_META = {
  todos: "Todos os Alvos",
  assunto: "Assuntos",
  empresa: "Empresas",
  pessoa: "Pessoas / ICP",
  problema: "Problemas"
};

const STATUS_VALIDACAO_META = {
  pronto_para_piloto: "Pronto para Piloto B2B",
  validado_com_cliente: "Validado com Cliente",
  em_investigacao: "Em Investigação Técnica",
  descartado_ou_pivote: "Alerta de Hype / Pivotar"
};

const CSV_EXEMPLO_TRENDS = `Semana,automacao clinica odontologica: (Brasil)
2026-05-01,31
2026-06-01,39
2026-07-01,48
2026-08-01,61
2026-09-01,74
2026-10-01,86`;

const estado = {
  carregando: true,
  erro: null,
  usuario: null,
  itens: [],
  insight: null,
  cotas: null,
  abaGrupo: "frente",
  frente: "todas",
  entidade: "todos",
  objetivo: "todos",
  busca: "",
  selecionados: [],
  ultimoRelatorio: null
};

/* ==========================================================================
   1. PERSISTENCIA LOCAL DE PREFERENCIAS E TEMA
   ========================================================================== */
function carregarPreferencias() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || "{}");
    if (salvo.abaGrupo) estado.abaGrupo = salvo.abaGrupo;
    if (salvo.frente) estado.frente = salvo.frente;
    if (salvo.entidade) estado.entidade = salvo.entidade;
    if (salvo.objetivo) estado.objetivo = salvo.objetivo;
    if (Array.isArray(salvo.selecionados)) estado.selecionados = salvo.selecionados;
  } catch (_err) {
    // Usa padroes
  }
}

function salvarPreferencias() {
  try {
    localStorage.setItem(
      CHAVE_STORAGE,
      JSON.stringify({
        abaGrupo: estado.abaGrupo,
        frente: estado.frente,
        entidade: estado.entidade,
        objetivo: estado.objetivo,
        selecionados: estado.selecionados
      })
    );
  } catch (_err) {
    // Ignora falha de storage
  }
}

function obterTemaAtual() {
  return localStorage.getItem("2brain-tema") || localStorage.getItem(CHAVE_TEMA) || "sistema";
}

function aplicarTema(modo) {
  if (!modo || modo === "sistema") {
    document.documentElement.dataset.tema = "sistema";
    localStorage.setItem("2brain-tema", "sistema");
    localStorage.removeItem(CHAVE_TEMA);
  } else {
    document.documentElement.dataset.tema = modo;
    localStorage.setItem("2brain-tema", modo);
    localStorage.setItem(CHAVE_TEMA, modo);
  }
}

function inicializarTema() {
  const salvo = localStorage.getItem("2brain-tema") || localStorage.getItem(CHAVE_TEMA);
  if (salvo === "escuro" || salvo === "claro" || salvo === "sistema") {
    document.documentElement.dataset.tema = salvo;
  }
}

function alternarTema() {
  const atual = document.documentElement.getAttribute("data-tema");
  const escuroSistema =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const proximo = atual
    ? atual === "escuro"
      ? "claro"
      : "escuro"
    : escuroSistema
      ? "claro"
      : "escuro";
  aplicarTema(proximo);
  mostrarToast("Tema alterado para modo " + proximo + ".");
}

/* ==========================================================================
   2. UTILITARIOS DE ESCAPE, TOAST E INDICADOR SEGMENTADO
   ========================================================================== */
function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let timerToast = null;
function mostrarToast(mensagem) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = mensagem;
  el.classList.add("visivel");
  if (timerToast) clearTimeout(timerToast);
  timerToast = setTimeout(() => {
    el.classList.remove("visivel");
  }, 2800);
}

function moverIndicador() {
  const nav = document.getElementById("abasGrupo");
  const ind = document.getElementById("indicadorGrupo");
  if (!nav || !ind) return;
  const ativo = nav.querySelector("button.ativo");
  if (!ativo) return;
  ind.style.width = ativo.offsetWidth + "px";
  ind.style.transform = "translateX(" + (ativo.offsetLeft - 2) + "px)";
}

/* ==========================================================================
   3. COMUNICACAO COM A API DO MODULO (/trendradar/api/*)
   ========================================================================== */
async function carregarDadosRadar(silencioso = false, forcar = false) {
  if (!silencioso) {
    estado.carregando = true;
    estado.erro = null;
    renderizarTudo();
  }

  try {
    const params = new URLSearchParams({ objetivo: estado.objetivo });
    if (forcar) params.set("forcar", "1");
    const resp = await fetch("/trendradar/api/oportunidades?" + params.toString(), {
      headers: { Accept: "application/json" }
    });
    const dados = await resp.json();

    if (!resp.ok || dados.erro) {
      throw new Error(dados.erro || "Falha ao carregar oportunidades do TrendRadar.");
    }

    estado.usuario = dados.usuario || null;
    estado.itens = Array.isArray(dados.itens) ? dados.itens : [];
    estado.insight = dados.insight || null;
    estado.cotas = dados.cotas || null;
    estado.carregando = false;
    estado.erro = null;
    renderizarTudo();
  } catch (err) {
    estado.carregando = false;
    estado.erro = err.message || "Não foi possível comunicar com o servidor do TrendRadar.";
    renderizarTudo();
  }
}

async function definirModeloIa(modelo) {
  try {
    mostrarToast("Alternando motor de IA para " + (modelo || "Automático") + "...");
    const resp = await fetch("/trendradar/api/ia/modelo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelo })
    });
    const dados = await resp.json();
    if (!resp.ok || dados.erro) {
      throw new Error(dados.erro || "Falha ao trocar modelo de IA.");
    }
    await carregarDadosRadar(true);
    const fonteAtual = estado.insight?.modelo || estado.insight?.fonte || "local";
    mostrarToast("Motor ativo: " + fonteAtual);
  } catch (err) {
    mostrarToast(err.message || "Erro ao alterar modelo de IA.");
  }
}

/* ==========================================================================
   4. FILTRAGEM E AGRUPAMENTO DE OPORTUNIDADES
   ========================================================================== */
function obterItensFiltrados() {
  const termo = estado.busca.trim().toLowerCase();

  return estado.itens.filter((item) => {
    if (
      estado.frente !== "todas" &&
      item.frente !== estado.frente &&
      !item.visivelEmTodasFrentes
    ) {
      return false;
    }
    if (estado.entidade !== "todos" && (item.tipoEntidade || "assunto") !== estado.entidade) {
      return false;
    }
    if (!termo) return true;

    const entidadesStr = (item.entidadesRelacionadas || []).join(" ");
    const doresStr = (item.reclamacoes || []).map((r) => r.dor).join(" ");
    const regioesStr = (item.regioes || []).map((r) => r.regiao).join(" ");
    const alvo = [
      item.nome,
      item.termoBusca,
      item.categoria,
      item.classificacaoCurva,
      item.icpPagador,
      entidadesStr,
      doresStr,
      regioesStr
    ]
      .join(" ")
      .toLowerCase();

    return alvo.includes(termo);
  });
}

function agruparItens(itens) {
  const grupos = new Map();

  for (const item of itens) {
    let chave = "Geral";
    if (estado.abaGrupo === "frente") {
      chave = FRENTES_META[item.frente]?.rotulo || item.categoria || "Outras Frentes";
    } else if (estado.abaGrupo === "objetivo") {
      const obj = item.objetivoPrincipal || "saas";
      chave = OBJETIVOS_META[obj]?.rotulo || "Aplicação Multi-Objetivo";
    } else if (estado.abaGrupo === "curva") {
      chave = item.classificacaoCurva || "Crescimento Consistente";
    } else if (estado.abaGrupo === "validacao") {
      chave = STATUS_VALIDACAO_META[item.statusValidacao] || "Em Investigação Técnica";
    }

    if (!grupos.has(chave)) {
      grupos.set(chave, []);
    }
    grupos.get(chave).push(item);
  }

  return Array.from(grupos.entries());
}

function obterEstatisticasResumo() {
  const todos = estado.itens;
  const consistentes = todos.filter(
    (i) => i.consistenciaScore >= 75 && i.crescimentoPct >= 30
  ).length;
  const prontosPiloto = todos.filter(
    (i) =>
      i.statusValidacao === "pronto_para_piloto" ||
      i.statusValidacao === "validado_com_cliente"
  ).length;
  const alertasHype = todos.filter(
    (i) =>
      i.consistenciaScore < 60 ||
      String(i.classificacaoCurva).toLowerCase().includes("pico")
  ).length;
  return {
    total: todos.length,
    consistentes,
    prontosPiloto,
    alertasHype
  };
}

/* ==========================================================================
   5. GERADOR DE SPARKLINE SVG (CURVA DE TENDENCIA)
   ========================================================================== */
function gerarSvgSparkline(serie = [], corHex = "#007aff") {
  const pontos = Array.isArray(serie) && serie.length >= 2 ? serie : [
    { data: "M1", valor: 30 },
    { data: "M2", valor: 50 },
    { data: "M3", valor: 75 }
  ];

  const largura = 280;
  const altura = 40;
  const padX = 6;
  const padY = 5;

  const valores = pontos.map((p) => Number(p.valor || 0));
  const minVal = Math.min(...valores, 0);
  const maxVal = Math.max(...valores, 100);
  const amplitude = Math.max(10, maxVal - minVal);

  const coords = pontos.map((p, idx) => {
    const x = padX + (idx / (pontos.length - 1)) * (largura - padX * 2);
    const y =
      altura -
      padY -
      ((Number(p.valor || 0) - minVal) / amplitude) * (altura - padY * 2);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), valor: p.valor, data: p.data };
  });

  const pontosLinha = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const pontosArea = `${coords[0].x},${altura} ${pontosLinha} ${coords[coords.length - 1].x},${altura}`;
  const ultimo = coords[coords.length - 1];

  return `
    <svg class="tr-sparkline-svg" viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${pontosArea}" fill="${esc(corHex)}" fill-opacity="0.12"></polygon>
      <polyline fill="none" stroke="${esc(corHex)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pontosLinha}"></polyline>
      <circle cx="${ultimo.x}" cy="${ultimo.y}" r="3.5" fill="${esc(corHex)}"></circle>
    </svg>
  `;
}

function classeBadgeCurva(classificacao = "") {
  const c = String(classificacao).toLowerCase();
  if (c.includes("consistente")) return "consistente";
  if (c.includes("emergente")) return "emergente";
  if (c.includes("pico") || c.includes("hype")) return "hype";
  return "estavel";
}

function rotuloTipoEntidade(tipo = "assunto") {
  const mapa = {
    assunto: "Assunto",
    empresa: "Empresa",
    pessoa: "Pessoa / ICP",
    problema: "Problema",
    agente: "Agente"
  };
  return mapa[tipo] || "Assunto";
}

/* ==========================================================================
   6. RENDERIZACAO DA TELA PRINCIPAL
   ========================================================================== */
function renderizarSubtituloCabecalho() {
  const el = document.getElementById("subtituloCabecalho");
  if (el) el.textContent = "TrendRadar";

  const resumoEl = document.getElementById("resumoTopo");
  if (!resumoEl) return;

  if (estado.erro) {
    resumoEl.textContent = "Não foi possível sincronizar o TrendRadar.";
    return;
  }
  if (estado.carregando) {
    resumoEl.textContent = "Carregando panorama das 6 frentes de mercado…";
    return;
  }

  const stats = obterEstatisticasResumo();
  const partes = [
    `${stats.total} oportunidades`,
    `${stats.consistentes} consistentes`,
    `${stats.prontosPiloto} prontas para piloto`
  ];
  if (estado.objetivo !== "todos") {
    partes.push(OBJETIVOS_META[estado.objetivo]?.rotulo.replace(/^\d+\.\s*/, "") || "");
  }
  if (estado.entidade !== "todos") {
    partes.push(ENTIDADES_META[estado.entidade] || "");
  }
  resumoEl.textContent = partes.filter(Boolean).join(" · ");
}

function renderizarBannerCota() {
  const banner = document.getElementById("bannerAlertaCota");
  if (!banner) return;

  const alertas = estado.cotas?.alertas || [];
  if (alertas.length === 0) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }

  const temEsgotado = alertas.some((a) => a.nivel === "esgotado");
  banner.hidden = false;
  banner.className = "tr-alerta-cota" + (temEsgotado ? " esgotado" : "");

  banner.innerHTML = alertas
    .map(
      (a) => `
      <div class="tr-alerta-cota-linha">
        <span class="tr-alerta-cota-titulo">
          ${a.nivel === "esgotado" ? "Limite de API atingido" : "Aviso preventivo de cota"} — ${esc(a.provedor)}
        </span>
        <button type="button" class="tr-btn-acao-card" data-acao="abrir-cotas">
          Gerenciar Cotas
        </button>
      </div>
      <p class="tr-alerta-cota-msg">${esc(a.mensagem)}</p>
    `
    )
    .join("");
}

function renderizarAbasGrupo() {
  const container = document.getElementById("abasGrupo");
  if (!container) return;
  const botoes = container.querySelectorAll("button[data-grupo]");
  botoes.forEach((btn) => {
    btn.classList.toggle("ativo", btn.dataset.grupo === estado.abaGrupo);
  });
  requestAnimationFrame(moverIndicador);
}

function renderizarFiltrosFrente() {
  const container = document.getElementById("filtros");
  if (!container) return;

  const contagemPorFrente = { todas: estado.itens.length };
  for (const item of estado.itens) {
    const f = item.frente || "fintech";
    contagemPorFrente[f] = (contagemPorFrente[f] || 0) + 1;
  }

  let htmlChips = Object.entries(FRENTES_META)
    .map(([chave, meta]) => {
      const ativo = estado.frente === chave ? "ativo" : "";
      const qtd = contagemPorFrente[chave] || 0;
      return `
        <button
          type="button"
          class="chip ${ativo}"
          data-acao="filtrar-frente"
          data-frente="${esc(chave)}"
        >
          <span>${esc(meta.curto)}</span>
          <span class="n">${qtd}</span>
        </button>
      `;
    })
    .join("");

  if (estado.entidade !== "todos") {
    htmlChips =
      `<button type="button" class="chip ativo" data-acao="filtrar-entidade" data-entidade="todos" title="Remover filtro de tipo de alvo">
        Alvo: ${esc(ENTIDADES_META[estado.entidade])} ✕
      </button>` + htmlChips;
  }

  if (estado.objetivo !== "todos") {
    htmlChips =
      `<button type="button" class="chip ativo" data-acao="selecionar-objetivo" data-lente-objetivo="todos" title="Remover filtro de objetivo">
        Lente: ${esc(OBJETIVOS_META[estado.objetivo]?.rotulo.replace(/^\d+\.\s*/, ""))} ✕
      </button>` + htmlChips;
  }

  container.innerHTML = `
    <p class="tr-rot-filtro">Frentes de mercado</p>
    <div class="faixa-chips">
      <div class="chips">${htmlChips}</div>
    </div>
  `;
}

function renderizarCartaoOportunidade(item) {
  const selecionado = estado.selecionados.includes(item.id);
  const classeCurva = classeBadgeCurva(item.classificacaoCurva);
  const primeiraDor =
    item.reclamacoes && item.reclamacoes[0]
      ? item.reclamacoes[0].dor
      : "Lacuna operacional identificada no mercado.";
  const topRegiao =
    item.regioes && item.regioes[0] ? item.regioes[0].regiao : "Nacional (BR)";
  const objetivoFoco = estado.objetivo === "todos" ? "saas" : estado.objetivo;
  const textoObjetivo =
    item.objetivos?.[objetivoFoco] || item.objetivos?.saas || "";

  const serie = item.serieHistorica || [];
  const primeiroPonto = serie[0]?.data || "Início";
  const ultimoPonto = serie[serie.length - 1]?.data || "Atual";
  const entidades = Array.isArray(item.entidadesRelacionadas)
    ? item.entidadesRelacionadas.slice(0, 4)
    : [];
  const corBarra = item.corHex || "var(--acento)";

  return `
    <article
      class="nota tr-cartao ${selecionado ? "selecionado" : ""}"
      style="--cor-area:${esc(corBarra)}"
      data-id="${esc(item.id)}"
      data-acao="abrir-dossie"
    >
      <div class="tr-cabecalho-cartao">
        <div class="tr-badges">
          <span class="tr-badge-entidade">${esc(rotuloTipoEntidade(item.tipoEntidade))}</span>
          <span class="tr-badge-curva ${classeCurva}">
            ${esc(item.classificacaoCurva)}
          </span>
        </div>
        <span class="tr-badge-score" title="Score de Oportunidade">
          ${Number(item.pontuacao || 0)}/100
        </span>
      </div>

      <div>
        <h3 class="cartao-titulo">${esc(item.nome)}</h3>
        <div class="cartao-sub">
          <span>${esc(item.categoria)}</span>
          <span>·</span>
          <span>Busca: "${esc(item.termoBusca || item.nome)}"</span>
        </div>
      </div>

      ${
        entidades.length > 0
          ? `<div class="tr-entidades-chips">
              ${entidades.map((e) => `<span class="tr-entidade-chip">${esc(e)}</span>`).join("")}
            </div>`
          : ""
      }

      <div class="tr-sparkline-box">
        <div class="tr-sparkline-cabeca">
          <span>Evolução (${esc(primeiroPonto)} → ${esc(ultimoPonto)})</span>
          <strong>+${Number(item.crescimentoPct || 0)}%</strong>
        </div>
        ${gerarSvgSparkline(serie, item.corHex || "#5856d6")}
      </div>

      <div class="tr-metricas-grade">
        <div class="tr-metrica">
          <span class="tr-metrica-rotulo">Consistência</span>
          <span class="tr-metrica-valor">${Number(item.consistenciaScore || 0)}%</span>
        </div>
        <div class="tr-metrica">
          <span class="tr-metrica-rotulo">Região Líder</span>
          <span class="tr-metrica-valor" title="${esc(topRegiao)}">${esc(topRegiao)}</span>
        </div>
        <div class="tr-metrica">
          <span class="tr-metrica-rotulo">Validação</span>
          <span class="tr-metrica-valor">${esc(STATUS_VALIDACAO_META[item.statusValidacao] || "Em Análise")}</span>
        </div>
      </div>

      <p class="tr-dor-preview">
        <strong>Dor recorrente:</strong> ${esc(primeiraDor)}
      </p>

      ${
        estado.objetivo !== "todos" && textoObjetivo
          ? `<p class="tr-dor-preview">
              <strong>Aplicação (${esc(OBJETIVOS_META[objetivoFoco]?.rotulo || "Foco")}):</strong> ${esc(textoObjetivo)}
            </p>`
          : ""
      }

      <div class="tr-rodape-cartao">
        <div class="tr-fontes-lista">
          ${(item.fontesCruzadas || [])
            .slice(0, 3)
            .map((f) => `<span class="tr-fonte-tag">${esc(f)}</span>`)
            .join("")}
        </div>
        <div class="tr-acoes-card">
          <button
            type="button"
            class="tr-btn-acao-card ${selecionado ? "ativo" : ""}"
            data-acao="alternar-selecao"
            data-id="${esc(item.id)}"
            title="Selecionar para Relatório Comparativo"
          >
            ${selecionado ? "✓ Selecionado" : "+ Selecionar"}
          </button>
          <button
            type="button"
            class="tr-btn-primario-card"
            data-acao="abrir-dossie"
            data-id="${esc(item.id)}"
          >
            Dossiê 6Q
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderizarConteudoPrincipal() {
  const container = document.getElementById("conteudo");
  if (!container) return;

  if (estado.carregando) {
    const um = '<div class="esqueleto"><div class="linha"></div><div class="linha"></div><div class="linha"></div></div>';
    container.innerHTML = `<div class="grade-cartoes">${um}${um}${um}${um}</div>`;
    return;
  }

  if (estado.erro) {
    container.innerHTML = `
      <div class="vazio">
        <span class="emoji">⚠️</span>
        <h3>Não foi possível carregar o TrendRadar</h3>
        <p>${esc(estado.erro)}</p>
        <div style="margin-top:14px">
          <button type="button" class="btn" data-acao="atualizar-radar">
            Tentar novamente
          </button>
        </div>
      </div>
    `;
    return;
  }

  const filtrados = obterItensFiltrados();

  if (filtrados.length === 0) {
    container.innerHTML = `
      <div class="vazio">
        <span class="emoji">🧭</span>
        <h3>Nenhuma oportunidade encontrada neste filtro</h3>
        <p>Limpe os filtros ou clique na lupa (+) no topo para pesquisar qualquer assunto, empresa ou problema.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-suave" data-acao="resetar-filtros">
            Mostrar todas as 6 frentes
          </button>
          <button type="button" class="btn" data-acao="abrir-investigar">
            + Pesquisar Novo Alvo
          </button>
        </div>
      </div>
    `;
    return;
  }

  const grupos = agruparItens(filtrados);
  container.innerHTML = grupos
    .map(([tituloGrupo, itensGrupo]) => {
      const corBolinha = itensGrupo[0]?.corHex || "var(--acento)";
      return `
      <section class="tr-grupo">
        <div class="tr-grupo-rot">
          <span class="bolinha" style="background:${esc(corBolinha)}"></span>
          <span>${esc(tituloGrupo)}</span>
          <span class="conta">${itensGrupo.length} ${itensGrupo.length === 1 ? "oportunidade" : "oportunidades"}</span>
        </div>
        <div class="grade-cartoes">
          ${itensGrupo.map(renderizarCartaoOportunidade).join("")}
        </div>
      </section>
    `;
    })
    .join("");
}

function renderizarBarraSelecao() {
  const barra = document.getElementById("barraSelecao");
  const contador = document.getElementById("contadorSelecao");
  const titulo = document.getElementById("tituloSelecao");
  if (!barra || !contador || !titulo) return;

  const qtd = estado.selecionados.length;
  if (qtd === 0) {
    barra.hidden = true;
    return;
  }

  barra.hidden = false;
  contador.textContent = String(qtd);
  titulo.textContent =
    qtd === 1
      ? "1 oportunidade selecionada"
      : `${qtd} oportunidades selecionadas`;
}

function renderizarTudo() {
  renderizarSubtituloCabecalho();
  renderizarBannerCota();
  renderizarAbasGrupo();
  renderizarFiltrosFrente();
  renderizarConteudoPrincipal();
  renderizarBarraSelecao();
}

/* ==========================================================================
   7. CONTROLE DO SHEET E MENU ••• DA NAVBAR (TODAS AS FUNCOES INTEGRADAS)
   ========================================================================== */
function abrirSheet(titulo, htmlCorpo) {
  const cortina = document.getElementById("cortina");
  const sheet = document.getElementById("sheet");
  const elTitulo = document.getElementById("sheetTitulo");
  const elCorpo = document.getElementById("sheetCorpo");

  if (!cortina || !sheet || !elTitulo || !elCorpo) return;

  elTitulo.textContent = titulo;
  elCorpo.innerHTML = htmlCorpo;
  cortina.classList.add("aberta", "visivel");
  sheet.classList.add("aberto", "visivel");
  sheet.setAttribute("aria-hidden", "false");
}

function fecharSheet() {
  const cortina = document.getElementById("cortina");
  const sheet = document.getElementById("sheet");
  if (!cortina || !sheet) return;
  cortina.classList.remove("aberta", "visivel");
  sheet.classList.remove("aberto", "visivel");
  sheet.setAttribute("aria-hidden", "true");
}

function htmlBotaoVoltarMenu() {
  return `
    <button type="button" class="tr-nav-voltar" data-acao="abrir-menu">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m15 18-6-6 6-6"/></svg>
      Voltar às opções
    </button>
  `;
}

/* --- 7.0 MENU DE OPCOES E FERRAMENTAS DO TRENDRADAR --- */
function abrirMenuOpcoes() {
  const stats = obterEstatisticasResumo();
  const modeloPreferido = estado.usuario?.modeloPreferido || "gemini-2.5-flash";
  const fonteIaAtiva =
    estado.insight?.fonte === "gemini" || estado.insight?.fonte === "groq"
      ? `${estado.insight.fonte.toUpperCase()} (${estado.insight.modelo || "Ativo"})`
      : "Heurística Determinística";

  const alertasCotaQtd = estado.cotas?.alertas?.length || 0;

  const html = `
    <div class="faixa-resumo">
      <div class="celula-resumo">
        <span class="num">${stats.total}</span>
        <span class="rot">Oportunidades</span>
      </div>
      <div class="celula-resumo">
        <span class="num">${stats.consistentes}</span>
        <span class="rot">Consistentes</span>
      </div>
      <div class="celula-resumo">
        <span class="num">${stats.prontosPiloto}</span>
        <span class="rot">Piloto B2B</span>
      </div>
    </div>

    <p class="grupo-titulo">Ferramentas do TrendRadar</p>
    <div class="grupo">
      <button type="button" class="item" data-acao="abrir-investigar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/></svg>
        <div class="item-txt">
          <strong>Pesquisar alvo no radar</strong>
          <span>Investigar assunto, empresa, pessoa ou dor B2B</span>
        </div>
        <span class="valor">Novo</span>
      </button>
      <button type="button" class="item" data-acao="abrir-importar-csv">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <div class="item-txt">
          <strong>Importar CSV do Google Trends</strong>
          <span>Analisar série temporal e detectar hype vs consistência</span>
        </div>
        <span class="valor">CSV</span>
      </button>
      <button type="button" class="item" data-acao="abrir-relatorio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <div class="item-txt">
          <strong>Relatório executivo (MD / PDF)</strong>
          <span>Exportar matriz comparativa e dossiê das 6 perguntas</span>
        </div>
        <span class="valor">${estado.selecionados.length > 0 ? estado.selecionados.length + " sel." : "Exportar"}</span>
      </button>
      <button type="button" class="item" data-acao="abrir-sintese">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
        <div class="item-txt">
          <strong>Síntese executiva da IA</strong>
          <span>${esc(fonteIaAtiva)}</span>
        </div>
        <span class="valor">Ver</span>
      </button>
      <button type="button" class="item" data-acao="abrir-cotas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>
        <div class="item-txt">
          <strong>Cotas e limites de API</strong>
          <span>Monitoramento de SerpApi, NewsAPI, Gemini e Groq</span>
        </div>
        <span class="valor">${alertasCotaQtd > 0 ? alertasCotaQtd + " alerta(s)" : "Normal"}</span>
      </button>
      <button type="button" class="item" data-acao="atualizar-radar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        <div class="item-txt">
          <strong>Atualizar dados do radar</strong>
          <span>Recarregar oportunidades e recalcular síntese</span>
        </div>
        <span class="valor">${stats.alertasHype} anti-hype</span>
      </button>
    </div>

    <p class="grupo-titulo">Motor de IA e Recortes</p>
    <div class="grupo">
      <div class="item" style="cursor:default">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>
        <div class="item-txt">
          <strong>Modelo de IA</strong>
          <span>Cascata automática com rodízio de chaves</span>
        </div>
        <select id="seletorModeloIa" class="tr-select-menu" aria-label="Selecionar modelo de IA">
          <option value="auto" ${modeloPreferido === "auto" ? "selected" : ""}>Auto (Gemini → Groq → Local)</option>
          <option value="gemini-2.5-flash" ${modeloPreferido === "gemini-2.5-flash" ? "selected" : ""}>Gemini 2.5 Flash</option>
          <option value="gemini-2.5-pro" ${modeloPreferido === "gemini-2.5-pro" ? "selected" : ""}>Gemini 2.5 Pro</option>
          <option value="gemini-2.0-flash" ${modeloPreferido === "gemini-2.0-flash" ? "selected" : ""}>Gemini 2.0 Flash</option>
          <option value="llama-3.3-70b-versatile" ${modeloPreferido === "llama-3.3-70b-versatile" ? "selected" : ""}>Groq Llama 3.3 70B</option>
          <option value="heuristica_local" ${modeloPreferido === "heuristica_local" ? "selected" : ""}>Motor Determinístico Local</option>
        </select>
      </div>
      <div style="border-top:1px solid var(--separador)">
        <div style="padding:10px 14px 2px;font-size:11.5px;font-weight:600;color:var(--texto-3);text-transform:uppercase;letter-spacing:0.04em">
          Filtrar por Tipo de Alvo
        </div>
        <div class="tr-pills-menu">
          ${Object.entries(ENTIDADES_META)
            .map(
              ([ch, rot]) => `
              <button
                type="button"
                class="tr-pill-menu ${estado.entidade === ch ? "ativo" : ""}"
                data-acao="filtrar-entidade"
                data-entidade="${esc(ch)}"
              >
                ${esc(rot)}
              </button>
            `
            )
            .join("")}
        </div>
      </div>
      <div style="border-top:1px solid var(--separador)">
        <div style="padding:10px 14px 2px;font-size:11.5px;font-weight:600;color:var(--texto-3);text-transform:uppercase;letter-spacing:0.04em">
          Lente dos 4 Objetivos Simultâneos
        </div>
        <div class="tr-pills-menu">
          ${Object.entries(OBJETIVOS_META)
            .map(
              ([ch, meta]) => `
              <button
                type="button"
                class="tr-pill-menu ${estado.objetivo === ch ? "ativo" : ""}"
                data-acao="selecionar-objetivo"
                data-lente-objetivo="${esc(ch)}"
              >
                ${esc(meta.rotulo)}
              </button>
            `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  abrirSheet("Ferramentas do TrendRadar", html);
}

/* --- 7.1 SINTESE EXECUTIVA DA IA --- */
function abrirModalSintese() {
  const ins = estado.insight || {};
  const rec = ins.recomendacaoPorObjetivo || {};
  const riscos = Array.isArray(ins.riscosCriticos) ? ins.riscosCriticos : [];
  const ehIa = ins.fonte === "gemini" || ins.fonte === "groq";
  const badgeFonte = ehIa
    ? `IA Ativa: ${ins.fonte.toUpperCase()} (${ins.modelo || "LLM"})`
    : "Heurística Determinística Local";

  const html = `
    ${htmlBotaoVoltarMenu()}

    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">${esc(badgeFonte)}</span>
      <h4 class="tr-pergunta-titulo">Resumo Executivo das 6 Frentes</h4>
      <p style="margin:0 0 10px;font-size:13.5px;line-height:1.5;color:var(--texto)">
        ${esc(ins.resumoExecutivo || "Analisando oportunidades multi-fonte...")}
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:var(--texto-2)">
        <strong style="color:var(--texto)">Hipótese Principal de Valor:</strong> ${esc(ins.hipotesePrincipal || "")}
      </p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:var(--texto-2)">
        <strong style="color:var(--texto)">Experimento Comercial Recomendado:</strong> ${esc(ins.validacaoSugerida || "")}
      </p>
    </div>

    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Plano de Ação Integrado</span>
      <h4 class="tr-pergunta-titulo">Aplicação Direta nos 4 Objetivos</h4>
      <ul class="tr-lista-dossie">
        <li><strong>1. Carreira Dev:</strong> ${esc(rec.carreira || "")}</li>
        <li><strong>2. Criar SaaS:</strong> ${esc(rec.saas || "")}</li>
        <li><strong>3. Serviços B2B:</strong> ${esc(rec.empresas || "")}</li>
        <li><strong>4. Agente Autônomo:</strong> ${esc(rec.agente || "")}</li>
      </ul>
    </div>

    ${
      riscos.length > 0
        ? `<div class="tr-dossie-bloco">
            <span class="tr-pergunta-num">Mitigação e Anti-Hype</span>
            <h4 class="tr-pergunta-titulo">Riscos Críticos Monitorados</h4>
            <ul class="tr-lista-dossie">
              ${riscos.map((r) => `<li>${esc(r)}</li>`).join("")}
            </ul>
          </div>`
        : ""
    }

    <div class="tr-acoes-form">
      <button type="button" class="tr-btn-secundario" data-acao="atualizar-radar">
        Recalcular Síntese
      </button>
      <button type="button" class="tr-btn-enviar" data-acao="abrir-relatorio">
        Exportar em Relatório MD/PDF
      </button>
    </div>
  `;

  abrirSheet("Síntese Executiva da IA", html);
}

/* --- 7.2 DOSSIE PROFUNDO DAS 6 PERGUNTAS --- */
function abrirDossie6Perguntas(id) {
  const item = estado.itens.find((x) => x.id === id);
  if (!item) return;

  const regioes = Array.isArray(item.regioes) ? item.regioes : [];
  const top5Regioes = regioes.slice(0, 5);
  const demaisRegioes = regioes.slice(5);
  const fonteRegionalPrincipal = regioes[0]?.fonte || "Distribuição Setorial B2B";
  const reclamacoes = Array.isArray(item.reclamacoes) ? item.reclamacoes : [];
  const concorrentes = Array.isArray(item.concorrentes) ? item.concorrentes : [];
  const evConfirmadas = Array.isArray(item.evidenciasConfirmadas) ? item.evidenciasConfirmadas : [];
  const evFaltantes = Array.isArray(item.evidenciasFaltantes) ? item.evidenciasFaltantes : [];
  const entidades = Array.isArray(item.entidadesRelacionadas) ? item.entidadesRelacionadas : [];

  const html = `
    <div class="tr-dossie-bloco" style="background:var(--superficie-2)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <span class="tr-pergunta-num">${esc(item.categoria)} · ${esc(rotuloTipoEntidade(item.tipoEntidade))}</span>
          <h4 class="tr-pergunta-titulo" style="margin:0">Score ${Number(item.pontuacao)}/100 · ${esc(item.classificacaoCurva)}</h4>
        </div>
        <div>
          <select class="tr-select" data-acao="mudar-status-oportunidade" data-id="${esc(item.id)}" style="width:auto;padding:6px 10px;font-size:12px">
            ${Object.entries(STATUS_VALIDACAO_META)
              .map(
                ([ch, rot]) =>
                  `<option value="${esc(ch)}" ${item.statusValidacao === ch ? "selected" : ""}>${esc(rot)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      ${
        entidades.length > 0
          ? `<div style="margin-top:8px;font-size:12px;color:var(--texto-2)">
              <strong>Empresas / Pessoas / Entidades ligadas:</strong> ${esc(entidades.join(", "))}
            </div>`
          : ""
      }
    </div>

    <!-- PERGUNTA 1 -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Pergunta 1 · Série Temporal</span>
      <h4 class="tr-pergunta-titulo">O interesse por esse tema está crescendo de forma consistente ou foi apenas um pico?</h4>
      <p style="margin:0 0 10px;font-size:13px;color:var(--texto-2);line-height:1.45">
        Classificação estatística: <strong style="color:var(--texto)">${esc(item.classificacaoCurva)}</strong>.
        Crescimento acumulado de <strong>+${Number(item.crescimentoPct)}%</strong> com índice de consistência pós-pico de <strong>${Number(item.consistenciaScore)}%</strong>.
      </p>
      <div class="tr-sparkline-box">
        ${gerarSvgSparkline(item.serieHistorica, item.corHex || "#007aff")}
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--texto-3);margin-top:4px">
          ${(item.serieHistorica || [])
            .map((p) => `<span>${esc(p.data)}: <strong>${Number(p.valor)}</strong></span>`)
            .join("")}
        </div>
      </div>
    </div>

    <!-- PERGUNTA 2 -->
    <div class="tr-dossie-bloco">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <span class="tr-pergunta-num">Pergunta 2 · Concentração Geográfica (${regioes.length} UFs · ${esc(fonteRegionalPrincipal)})</span>
          <h4 class="tr-pergunta-titulo">Em quais regiões esse interesse é maior?</h4>
        </div>
        <button
          type="button"
          class="tr-btn-acao-card"
          data-acao="sincronizar-regioes"
          data-id="${esc(item.id)}"
          title="Consultar Google Trends por Estado (GEO_MAP_0)"
        >
          Sincronizar 27 UFs (Trends)
        </button>
      </div>

      <p style="margin:4px 0 8px;font-size:12px;color:var(--texto-2)">
        <strong>Top 5 Estados de Maior Demanda:</strong>
      </p>
      <div class="tr-regioes-barra">
        ${top5Regioes
          .map(
            (r, idx) => `
          <div class="tr-regiao-linha">
            <span><strong>${idx + 1}º</strong> ${esc(r.regiao)}</span>
            <div class="tr-barra-fundo">
              <div class="tr-barra-preenchimento" style="width:${Math.min(100, Math.max(8, Number(r.indice || 50)))}%"></div>
            </div>
            <strong style="text-align:right">${Number(r.indice || 0)}</strong>
          </div>
        `
          )
          .join("")}
      </div>

      ${
        demaisRegioes.length > 0
          ? `<details style="margin-top:12px;border-top:1px solid var(--separador);padding-top:10px">
              <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--acento);user-select:none">
                Ver todos os 27 Estados do Brasil (+${demaisRegioes.length} UFs restantes)
              </summary>
              <div class="tr-regioes-barra" style="margin-top:10px;max-height:260px;overflow-y:auto;padding-right:4px">
                ${demaisRegioes
                  .map(
                    (r, idx) => `
                  <div class="tr-regiao-linha">
                    <span><strong style="color:var(--texto-3)">${idx + 6}º</strong> ${esc(r.regiao)}</span>
                    <div class="tr-barra-fundo">
                      <div class="tr-barra-preenchimento" style="width:${Math.min(100, Math.max(5, Number(r.indice || 20)))};opacity:0.72"></div>
                    </div>
                    <strong style="text-align:right;color:var(--texto-2)">${Number(r.indice || 0)}</strong>
                  </div>
                `
                  )
                  .join("")}
              </div>
            </details>`
          : ""
      }
    </div>

    <!-- PERGUNTA 3 -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Pergunta 3 · Dores Reais de Usuários</span>
      <h4 class="tr-pergunta-titulo">Existem reclamações recorrentes que um software poderia resolver?</h4>
      <ul class="tr-lista-dossie">
        ${reclamacoes
          .map(
            (r) => `
          <li>
            <strong>[${esc(r.gravidade || "Alta")} · ${esc(r.fonte || "Comunidades")}]</strong>
            ${esc(r.dor)}
          </li>
        `
          )
          .join("")}
      </ul>
    </div>

    <!-- PERGUNTA 4 -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Pergunta 4 · Inteligência Competitiva</span>
      <h4 class="tr-pergunta-titulo">Há concorrentes oferecendo soluções semelhantes e onde eles falham?</h4>
      <ul class="tr-lista-dossie">
        ${concorrentes
          .map(
            (c) => `
          <li>
            <strong>${esc(c.nome)} (${esc(c.precoMedio || "N/A")}):</strong>
            Lacuna explorável: ${esc(c.lacuna)}
          </li>
        `
          )
          .join("")}
      </ul>
    </div>

    <!-- PERGUNTA 5 -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Pergunta 5 · Modelo de Negócios e Validação</span>
      <h4 class="tr-pergunta-titulo">Quem pagaria por uma solução e como poderíamos testar isso?</h4>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.45;color:var(--texto-2)">
        <strong style="color:var(--texto)">Perfil Pagador (ICP):</strong> ${esc(item.icpPagador)}
      </p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:var(--texto-2)">
        <strong style="color:var(--texto)">Experimento Comercial Rápido:</strong> ${esc(item.testeComercial)}
      </p>
    </div>

    <!-- PERGUNTA 6 -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Pergunta 6 · Auditoria de Evidências</span>
      <h4 class="tr-pergunta-titulo">Quais evidências sustentam a recomendação e quais ainda faltam?</h4>
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:var(--sucesso)">Evidências Confirmadas:</p>
      <ul class="tr-lista-dossie" style="margin-bottom:10px">
        ${evConfirmadas.map((e) => `<li>✓ ${esc(e)}</li>`).join("")}
      </ul>
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:var(--alerta)">Evidências Faltantes (Validar no Piloto):</p>
      <ul class="tr-lista-dossie">
        ${evFaltantes.map((e) => `<li>⏳ ${esc(e)}</li>`).join("")}
      </ul>
    </div>

    <!-- 4 OBJETIVOS -->
    <div class="tr-dossie-bloco">
      <span class="tr-pergunta-num">Plano de Ação Simultâneo</span>
      <h4 class="tr-pergunta-titulo">Como explorar esta oportunidade nos 4 Objetivos</h4>
      <ul class="tr-lista-dossie">
        <li><strong>1. Carreira Dev:</strong> ${esc(item.objetivos?.carreira || "")}</li>
        <li><strong>2. Criar SaaS:</strong> ${esc(item.objetivos?.saas || "")}</li>
        <li><strong>3. Serviços B2B:</strong> ${esc(item.objetivos?.empresas || "")}</li>
        <li><strong>4. Agente Autônomo:</strong> ${esc(item.objetivos?.agente || "")}</li>
      </ul>
    </div>

    <div class="tr-acoes-form">
      <button type="button" class="tr-btn-secundario" data-acao="relatorio-individual" data-id="${esc(item.id)}">
        Gerar Relatório MD / PDF deste Item
      </button>
      <button type="button" class="tr-btn-enviar" data-acao="alternar-selecao" data-id="${esc(item.id)}">
        ${estado.selecionados.includes(item.id) ? "Remover da Seleção" : "Incluir no Relatório Comparativo"}
      </button>
    </div>
  `;

  abrirSheet(item.nome, html);
}

/* --- 7.3 MODAL: PESQUISAR ASSUNTO, EMPRESA, PESSOA OU PROBLEMA --- */
function abrirModalInvestigar() {
  const html = `
    ${htmlBotaoVoltarMenu()}

    <form id="formInvestigar" class="tr-form">
      <p style="margin:0;font-size:13px;color:var(--texto-2);line-height:1.45">
        Pesquise qualquer <strong>assunto, empresa, pessoa/profissão ou problema</strong>. O TrendRadar coleta sinais em tempo real (Google Trends, HackerNews, NewsAPI e IA) e gera o dossiê completo das 6 perguntas.
      </p>

      <div class="tr-campo">
        <label>Sugestões rápidas para testar agora:</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button type="button" class="tr-btn-acao-card" data-acao="preencher-alvo-rapido" data-termo="Prospecção de clientes B2B" data-tipo="assunto">Prospecção B2B</button>
          <button type="button" class="tr-btn-acao-card" data-acao="preencher-alvo-rapido" data-termo="Totvs ERP" data-tipo="empresa">Empresa: Totvs</button>
          <button type="button" class="tr-btn-acao-card" data-acao="preencher-alvo-rapido" data-termo="Bling ERP" data-tipo="empresa">Empresa: Bling</button>
          <button type="button" class="tr-btn-acao-card" data-acao="preencher-alvo-rapido" data-termo="Contadores e Escritórios Contábeis" data-tipo="pessoa">Pessoa: Contadores</button>
          <button type="button" class="tr-btn-acao-card" data-acao="preencher-alvo-rapido" data-termo="Glosas médicas e atraso de convênios" data-tipo="problema">Problema: Glosas Médicas</button>
        </div>
      </div>

      <div class="tr-campo">
        <label for="invTipoEntidade">Tipo de Alvo</label>
        <select id="invTipoEntidade" name="tipoEntidade" class="tr-select">
          <option value="assunto">Assunto / Nicho de Mercado</option>
          <option value="empresa">Empresa / Concorrente (ex: Bling, Totvs, Doctoralia, Gupy)</option>
          <option value="pessoa">Pessoa / Profissão / ICP (ex: Contadores, Dentistas, Engenheiros)</option>
          <option value="problema">Problema / Dor Operacional (ex: Glosa médica, Frete reverso)</option>
        </select>
      </div>

      <div class="tr-campo">
        <label for="invTermo">Nome do Assunto, Empresa, Pessoa ou Problema *</label>
        <input
          id="invTermo"
          name="termo"
          type="text"
          class="tr-input"
          placeholder="Ex: automacao contabilidade, Bling ERP, gestores de trafego..."
          required
        />
      </div>

      <div class="tr-campo">
        <label for="invFrente">Frente Estratégica (ou deixe Automático para a IA detectar)</label>
        <select id="invFrente" name="frente" class="tr-select">
          <option value="auto" selected>Detectar Automaticamente pelo Assunto (Recomendado)</option>
          <option value="saude">1. Saúde & Clínicas B2B</option>
          <option value="fintech">2. FinTech, E-commerce & Fiscal</option>
          <option value="regtech">3. RegTech, RH & Conformidade</option>
          <option value="govtech">4. GovTech, Jurídico & Dados Públicos</option>
          <option value="operacoes">5. Obras & Operações de Campo</option>
          <option value="ia_devtools">6. Engenharia IA & Anti-Hype</option>
        </select>
      </div>

      <div class="tr-campo">
        <label for="invIcp">Hipótese de Cliente Pagador (Opcional)</label>
        <input
          id="invIcp"
          name="icpPagador"
          type="text"
          class="tr-input"
          placeholder="Ex: Escritórios de contabilidade com mais de 50 clientes..."
        />
      </div>

      <div class="tr-acoes-form">
        <button type="button" class="tr-btn-secundario" data-acao="abrir-menu">Voltar</button>
        <button type="submit" class="tr-btn-enviar" id="btnSubmitInvestigar">
          Investigar e Adicionar ao Radar
        </button>
      </div>
    </form>
  `;

  abrirSheet("Pesquisar Alvo no Radar", html);
}

/* --- 7.4 MODAL: IMPORTAR CSV DO GOOGLE TRENDS --- */
function abrirModalImportarCsv() {
  const html = `
    ${htmlBotaoVoltarMenu()}

    <form id="formImportarCsv" class="tr-form">
      <p style="margin:0;font-size:13px;color:var(--texto-2);line-height:1.45">
        Cole os dados exportados do <strong>Google Trends (CSV)</strong> no formato <code>Data,Valor</code>. O motor estatístico calcula automaticamente se a curva é <strong>Crescimento Consistente</strong> ou <strong>Pico / Hype</strong>.
      </p>

      <div class="tr-campo">
        <label for="csvNome">Nome da Tendência / Oportunidade</label>
        <input
          id="csvNome"
          name="nome"
          type="text"
          class="tr-input"
          placeholder="Ex: Automação para Clínicas Odontológicas"
        />
      </div>

      <div class="tr-campo">
        <label for="csvFrente">Frente do Radar</label>
        <select id="csvFrente" name="frente" class="tr-select">
          <option value="saude">1. Saúde & Clínicas B2B</option>
          <option value="fintech">2. FinTech, E-commerce & Fiscal</option>
          <option value="regtech">3. RegTech, RH & Conformidade</option>
          <option value="govtech">4. GovTech, Jurídico & Dados Públicos</option>
          <option value="operacoes">5. Obras & Operações de Campo</option>
          <option value="ia_devtools">6. Engenharia IA & Anti-Hype</option>
        </select>
      </div>

      <div class="tr-campo">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label for="csvConteudo">Conteúdo CSV (Data,Valor) *</label>
          <button type="button" class="tr-btn-acao-card" data-acao="carregar-csv-exemplo">
            Preencher CSV de Exemplo
          </button>
        </div>
        <textarea
          id="csvConteudo"
          name="csv"
          class="tr-textarea"
          placeholder="2026-05,32&#10;2026-06,44&#10;2026-07,58&#10;2026-08,71"
          required
        ></textarea>
      </div>

      <div class="tr-acoes-form">
        <button type="button" class="tr-btn-secundario" data-acao="abrir-menu">Voltar</button>
        <button type="submit" class="tr-btn-enviar" id="btnSubmitCsv">
          Processar Série Temporal e Salvar
        </button>
      </div>
    </form>
  `;

  abrirSheet("Importar CSV do Google Trends", html);
}

/* --- 7.5 RENDERIZADOR DE MARKDOWN E MODAL DE RELATORIO EXECUTIVO (MD / PDF) --- */
function converterMarkdownParaHtml(md = "") {
  const linhas = String(md).split(/\r?\n/);
  const saida = [];
  let emLista = false;
  let emTabela = false;
  let cabecalhoTabelaFeito = false;

  const fecharEstruturas = () => {
    if (emLista) {
      saida.push("</ul>");
      emLista = false;
    }
    if (emTabela) {
      saida.push("</tbody></table></div>");
      emTabela = false;
      cabecalhoTabelaFeito = false;
    }
  };

  const formatarInline = (txt) => {
    return esc(txt)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  };

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();

    if (!linha) {
      fecharEstruturas();
      continue;
    }

    if (linha === "---") {
      fecharEstruturas();
      saida.push("<hr />");
      continue;
    }

    if (linha.startsWith("|") && linha.endsWith("|")) {
      if (emLista) {
        saida.push("</ul>");
        emLista = false;
      }
      if (/^\|[\s:|-]+\|$/.test(linha)) {
        continue;
      }
      const colunas = linha
        .slice(1, -1)
        .split("|")
        .map((c) => formatarInline(c.trim()));

      if (!emTabela) {
        emTabela = true;
        cabecalhoTabelaFeito = true;
        saida.push('<div class="tr-markdown-tabela-wrap"><table class="tr-markdown-tabela"><thead><tr>');
        for (const col of colunas) {
          saida.push(`<th>${col}</th>`);
        }
        saida.push("</tr></thead><tbody>");
      } else {
        saida.push("<tr>");
        for (const col of colunas) {
          saida.push(`<td>${col}</td>`);
        }
        saida.push("</tr>");
      }
      continue;
    }

    fecharEstruturas();

    if (linha.startsWith("# ")) {
      saida.push(`<h1>${formatarInline(linha.slice(2))}</h1>`);
    } else if (linha.startsWith("## ")) {
      saida.push(`<h2>${formatarInline(linha.slice(3))}</h2>`);
    } else if (linha.startsWith("### ")) {
      saida.push(`<h3>${formatarInline(linha.slice(4))}</h3>`);
    } else if (linha.startsWith("#### ")) {
      saida.push(`<h4>${formatarInline(linha.slice(5))}</h4>`);
    } else if (linha.startsWith("- ") || /^\d+\.\s/.test(linha)) {
      if (!emLista) {
        saida.push("<ul>");
        emLista = true;
      }
      const textoItem = linha.replace(/^(-|\d+\.)\s+/, "");
      saida.push(`<li>${formatarInline(textoItem)}</li>`);
    } else {
      saida.push(`<p>${formatarInline(linha)}</p>`);
    }
  }

  fecharEstruturas();
  return saida.join("\n");
}

async function abrirModalRelatorio(idsEspecificos = null) {
  const ids =
    Array.isArray(idsEspecificos) && idsEspecificos.length > 0
      ? idsEspecificos
      : estado.selecionados;

  abrirSheet(
    "Relatório Executivo (Markdown & PDF)",
    `<div class="vazio"><span class="emoji">📄</span><h3>Compilando dossiê executivo em Markdown...</h3><p>Sintetizando matriz comparativa, séries históricas e as 6 perguntas de decisão.</p></div>`
  );

  try {
    const resp = await fetch("/trendradar/api/relatorio/gerar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids,
        frente: estado.frente === "todas" ? "" : estado.frente,
        objetivo: estado.objetivo
      })
    });
    const dados = await resp.json();
    if (!resp.ok || dados.erro) {
      throw new Error(dados.erro || "Falha ao gerar relatório executivo.");
    }

    estado.ultimoRelatorio = dados;
    const htmlMarkdown = converterMarkdownParaHtml(dados.relatorioMarkdown || "");

    const html = `
      ${htmlBotaoVoltarMenu()}

      <div class="tr-relatorio-toolbar">
        <div>
          <strong style="font-size:13px">${esc(dados.titulo)}</strong>
          <div style="font-size:11.5px;color:var(--texto-2)">
            ${Number(dados.totalOportunidades)} oportunidade(s) analisada(s) · Pronto para compartilhar
          </div>
        </div>
        <div class="tr-relatorio-toolbar-acoes">
          <button type="button" class="tr-btn-secundario" data-acao="copiar-relatorio-md">
            Copiar Markdown
          </button>
          <button type="button" class="tr-btn-secundario" data-acao="baixar-relatorio-md">
            Baixar .MD
          </button>
          <button type="button" class="tr-btn-enviar" data-acao="imprimir-relatorio-pdf">
            Exportar / Imprimir PDF
          </button>
        </div>
      </div>

      <div class="tr-relatorio-view">
        <div class="tr-markdown-corpo" id="corpoRelatorioRenderizado">
          ${htmlMarkdown}
        </div>
      </div>
    `;

    abrirSheet("Relatório Executivo (Markdown & PDF)", html);
  } catch (err) {
    abrirSheet(
      "Erro ao Gerar Relatório",
      `${htmlBotaoVoltarMenu()}<div class="vazio"><span class="emoji">⚠️</span><h3>Não foi possível gerar o relatório</h3><p>${esc(err.message)}</p></div>`
    );
  }
}

/* --- 7.6 MODAL: MONITOR DE COTAS DE API E SIMULADOR DE ALERTA --- */
function abrirModalCotas() {
  const provedores = estado.cotas?.provedores || [];

  const html = `
    ${htmlBotaoVoltarMenu()}

    <p style="margin:0 0 12px;font-size:13px;color:var(--texto-2);line-height:1.45">
      O TrendRadar monitora em tempo real o consumo de cada API gratuita. Quando uma cota atinge <strong>80%</strong>, um aviso preventivo é exibido; se atingir <strong>100% (HTTP 429)</strong>, o fallback local assume sem derrubar sua operação.
    </p>

    <div class="tr-cotas-lista">
      ${provedores
        .map(
          (p) => `
        <div class="tr-cota-item">
          <div class="tr-cota-cabeca">
            <span>${esc(p.nome)} ${p.configurado ? "· Chave Configurada" : "· Fallback / Demo"}</span>
            <span>${Number(p.usado)} / ${Number(p.limite)} reqs (${Number(p.percentual)}%)</span>
          </div>
          <div class="tr-cota-barra">
            <div class="tr-cota-fill ${esc(p.nivel)}" style="width:${Math.max(4, Number(p.percentual))}%"></div>
          </div>
          ${
            p.ultimoErro
              ? `<p style="margin:6px 0 0;font-size:11.5px;color:var(--perigo)">${esc(p.ultimoErro)}</p>`
              : ""
          }
        </div>
      `
        )
        .join("")}
    </div>

    <div class="tr-dossie-bloco" style="margin-top:14px">
      <span class="tr-pergunta-num">Teste de Resiliência e Fallback</span>
      <h4 class="tr-pergunta-titulo">Simular Alerta de Limite de API</h4>
      <p style="margin:0 0 10px;font-size:12.5px;color:var(--texto-2)">
        Teste agora como o sistema avisa você quando uma chave gratuita (SerpApi ou Gemini) está acabando:
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="tr-btn-secundario" data-acao="simular-cota" data-provedor="serpapi" data-nivel="atencao">
          Simular 85% (Aviso Preventivo)
        </button>
        <button type="button" class="tr-btn-secundario" data-acao="simular-cota" data-provedor="serpapi" data-nivel="esgotado">
          Simular 100% HTTP 429 (Fallback)
        </button>
        <button type="button" class="tr-btn-enviar" data-acao="simular-cota" data-provedor="todos" data-nivel="resetar">
          Resetar Medidores
        </button>
      </div>
    </div>
  `;

  abrirSheet("Monitor de Cotas de API", html);
}

/* ==========================================================================
   8. SUBMISSAO DE FORMULARIOS E ACOES ASSINCRONAS
   ========================================================================== */
async function submeterInvestigacao(form) {
  const btn = document.getElementById("btnSubmitInvestigar");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Investigando fontes e gerando dossiê...";
  }

  const dadosForm = new FormData(form);
  const payload = {
    tipoEntidade: dadosForm.get("tipoEntidade"),
    termo: dadosForm.get("termo"),
    frente: dadosForm.get("frente"),
    icpPagador: dadosForm.get("icpPagador"),
    objetivoPrincipal: estado.objetivo === "todos" ? "saas" : estado.objetivo
  };

  try {
    const resp = await fetch("/trendradar/api/investigar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();
    if (!resp.ok || res.erro) {
      throw new Error(res.erro || "Falha ao investigar o alvo informado.");
    }

    estado.frente = "todas";
    estado.entidade = "todos";
    estado.busca = "";
    const campoBusca = document.getElementById("campoBusca");
    const caixaBusca = document.getElementById("caixaBusca");
    if (campoBusca) campoBusca.value = "";
    if (caixaBusca) caixaBusca.classList.remove("tem-texto");
    salvarPreferencias();

    mostrarToast(`Dossiê "${res.item?.nome || payload.termo}" adicionado ao radar!`);
    await carregarDadosRadar(true);

    if (res.item?.id) {
      abrirDossie6Perguntas(res.item.id);
    } else {
      fecharSheet();
    }
  } catch (err) {
    mostrarToast(err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Investigar e Adicionar ao Radar";
    }
  }
}

async function submeterImportacaoCsv(form) {
  const btn = document.getElementById("btnSubmitCsv");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Analisando curva...";
  }

  const dadosForm = new FormData(form);
  const payload = {
    nome: dadosForm.get("nome"),
    frente: dadosForm.get("frente"),
    csv: dadosForm.get("csv"),
    objetivoPrincipal: estado.objetivo === "todos" ? "saas" : estado.objetivo
  };

  try {
    const resp = await fetch("/trendradar/api/importar-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();
    if (!resp.ok || res.erro) {
      throw new Error(res.erro || "Falha ao importar o CSV.");
    }

    estado.frente = payload.frente || "todas";
    salvarPreferencias();
    mostrarToast(`CSV importado: ${res.item.classificacaoCurva} (+${res.item.crescimentoPct}%)`);
    await carregarDadosRadar(true);
    abrirDossie6Perguntas(res.item.id);
  } catch (err) {
    mostrarToast(err.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Processar Série Temporal e Salvar";
    }
  }
}

async function alterarStatusOportunidade(id, statusValidacao) {
  try {
    const resp = await fetch("/trendradar/api/oportunidades/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, statusValidacao })
    });
    const res = await resp.json();
    if (!resp.ok || res.erro) {
      throw new Error(res.erro || "Falha ao atualizar status.");
    }
    mostrarToast("Status comercial atualizado!");
    await carregarDadosRadar(true);
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function executarSimulacaoCota(provedor, nivel) {
  try {
    const resp = await fetch("/trendradar/api/cotas/simular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provedor, nivel })
    });
    const dados = await resp.json();
    if (resp.ok && dados.cotas) {
      estado.cotas = dados.cotas;
      renderizarBannerCota();
      abrirModalCotas();
      mostrarToast(
        nivel === "resetar"
          ? "Medidores de cota resetados."
          : "Alerta de limite de API simulado!"
      );
    }
  } catch (_err) {
    mostrarToast("Não foi possível simular a cota.");
  }
}

/* ==========================================================================
   9. DELEGACAO GLOBAL DE EVENTOS (CLICKS, INPUTS E ATALHOS)
   ========================================================================== */
function alternarSelecaoItem(id) {
  if (!id) return;
  const idx = estado.selecionados.indexOf(id);
  if (idx >= 0) {
    estado.selecionados.splice(idx, 1);
  } else {
    estado.selecionados.push(id);
  }
  salvarPreferencias();
  renderizarTudo();
}

function configurarEventos() {
  const campoBusca = document.getElementById("campoBusca");
  const caixaBusca = document.getElementById("caixaBusca");

  if (campoBusca) {
    campoBusca.addEventListener("input", (e) => {
      estado.busca = e.target.value || "";
      if (caixaBusca) {
        caixaBusca.classList.toggle("tem-texto", Boolean(estado.busca.trim()));
      }
      renderizarConteudoPrincipal();
    });
  }

  window.addEventListener("resize", moverIndicador);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      fecharSheet();
    }
  });

  document.addEventListener("change", (e) => {
    const selStatus = e.target.closest("[data-acao='mudar-status-oportunidade']");
    if (selStatus) {
      alterarStatusOportunidade(selStatus.dataset.id, selStatus.value);
      return;
    }

    if (e.target && e.target.id === "seletorModeloIa") {
      definirModeloIa(e.target.value);
    }
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id === "formInvestigar") {
      e.preventDefault();
      submeterInvestigacao(e.target);
    } else if (e.target.id === "formImportarCsv") {
      e.preventDefault();
      submeterImportacaoCsv(e.target);
    }
  });

  document.addEventListener("click", async (e) => {
    const alvoAcao = e.target.closest("[data-acao]");
    if (!alvoAcao) return;

    const acao = alvoAcao.dataset.acao;

    if (acao === "alternar-selecao") {
      e.stopPropagation();
      alternarSelecaoItem(alvoAcao.dataset.id);
      const sheet = document.getElementById("sheet");
      if (sheet && sheet.classList.contains("aberto") && alvoAcao.closest(".sheet")) {
        abrirDossie6Perguntas(alvoAcao.dataset.id);
      }
      return;
    }

    if (acao === "abrir-menu") {
      abrirMenuOpcoes();
      return;
    }

    if (acao === "definir-tema") {
      const modo = alvoAcao.dataset.temaAlvo || "sistema";
      aplicarTema(modo);
      mostrarToast("Tema: " + modo);
      abrirMenuOpcoes();
      return;
    }

    if (acao === "alternar-tema") {
      alternarTema();
      return;
    }

    if (acao === "selecionar-objetivo") {
      const novoObj = alvoAcao.dataset.lenteObjetivo || "todos";
      estado.objetivo = novoObj;
      salvarPreferencias();
      renderizarTudo();
      await carregarDadosRadar(true);
      const sheet = document.getElementById("sheet");
      if (sheet && sheet.classList.contains("aberto") && alvoAcao.closest(".sheet")) {
        abrirMenuOpcoes();
      }
      return;
    }

    if (acao === "mudar-aba") {
      estado.abaGrupo = alvoAcao.dataset.grupo || "frente";
      salvarPreferencias();
      renderizarAbasGrupo();
      renderizarConteudoPrincipal();
      return;
    }

    if (acao === "filtrar-frente") {
      estado.frente = alvoAcao.dataset.frente || "todas";
      salvarPreferencias();
      renderizarFiltrosFrente();
      renderizarConteudoPrincipal();
      return;
    }

    if (acao === "filtrar-entidade") {
      estado.entidade = alvoAcao.dataset.entidade || "todos";
      salvarPreferencias();
      renderizarTudo();
      const sheet = document.getElementById("sheet");
      if (sheet && sheet.classList.contains("aberto") && alvoAcao.closest(".sheet")) {
        abrirMenuOpcoes();
      }
      return;
    }

    if (acao === "resetar-filtros") {
      estado.frente = "todas";
      estado.entidade = "todos";
      estado.objetivo = "todos";
      estado.busca = "";
      if (campoBusca) campoBusca.value = "";
      if (caixaBusca) caixaBusca.classList.remove("tem-texto");
      salvarPreferencias();
      renderizarTudo();
      return;
    }

    if (acao === "limpar-busca") {
      estado.busca = "";
      if (campoBusca) campoBusca.value = "";
      if (caixaBusca) caixaBusca.classList.remove("tem-texto");
      renderizarConteudoPrincipal();
      return;
    }

    if (acao === "atualizar-radar") {
      fecharSheet();
      mostrarToast("Atualizando dados e síntese do radar...");
      carregarDadosRadar(false, true);
      return;
    }

    if (acao === "abrir-dossie") {
      const id = alvoAcao.dataset.id || alvoAcao.closest("[data-id]")?.dataset.id;
      if (id) abrirDossie6Perguntas(id);
      return;
    }

    if (acao === "fechar-sheet") {
      fecharSheet();
      return;
    }

    if (acao === "abrir-sintese") {
      abrirModalSintese();
      return;
    }

    if (acao === "abrir-investigar") {
      abrirModalInvestigar();
      return;
    }

    if (acao === "preencher-alvo-rapido") {
      const inputTermo = document.getElementById("invTermo");
      const selectTipo = document.getElementById("invTipoEntidade");
      const selectFrente = document.getElementById("invFrente");
      if (inputTermo) inputTermo.value = alvoAcao.dataset.termo || "";
      if (selectTipo && alvoAcao.dataset.tipo) selectTipo.value = alvoAcao.dataset.tipo;
      if (selectFrente) selectFrente.value = "auto";
      if (inputTermo) inputTermo.focus();
      return;
    }

    if (acao === "abrir-importar-csv") {
      abrirModalImportarCsv();
      return;
    }

    if (acao === "carregar-csv-exemplo") {
      const txt = document.getElementById("csvConteudo");
      const nome = document.getElementById("csvNome");
      if (txt) txt.value = CSV_EXEMPLO_TRENDS;
      if (nome && !nome.value) nome.value = "Automação para Clínicas Odontológicas";
      mostrarToast("CSV de exemplo carregado!");
      return;
    }

    if (acao === "abrir-relatorio") {
      abrirModalRelatorio();
      return;
    }

    if (acao === "relatorio-individual") {
      const id = alvoAcao.dataset.id;
      if (id) abrirModalRelatorio([id]);
      return;
    }

    if (acao === "copiar-relatorio-md") {
      const md = estado.ultimoRelatorio?.relatorioMarkdown || "";
      if (md && navigator.clipboard) {
        await navigator.clipboard.writeText(md);
        mostrarToast("Relatório Markdown copiado para a área de transferência!");
      }
      return;
    }

    if (acao === "baixar-relatorio-md") {
      const md = estado.ultimoRelatorio?.relatorioMarkdown || "";
      const nomeArq = estado.ultimoRelatorio?.nomeArquivoSugerido || "trendradar-relatorio.md";
      if (!md) return;
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArq;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      mostrarToast("Arquivo .MD baixado com sucesso!");
      return;
    }

    if (acao === "imprimir-relatorio-pdf") {
      window.print();
      return;
    }

    if (acao === "abrir-cotas") {
      abrirModalCotas();
      return;
    }

    if (acao === "simular-cota") {
      executarSimulacaoCota(alvoAcao.dataset.provedor, alvoAcao.dataset.nivel);
      return;
    }

    if (acao === "sincronizar-regioes") {
      const id = alvoAcao.dataset.id;
      if (!id) return;
      alvoAcao.disabled = true;
      alvoAcao.textContent = "Sincronizando 27 UFs...";
      try {
        const resp = await fetch("/trendradar/api/oportunidades/regioes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        });
        const res = await resp.json();
        if (!resp.ok || res.erro) {
          throw new Error(res.erro || "Falha ao sincronizar estados.");
        }
        await carregarDadosRadar(true);
        abrirDossie6Perguntas(id);
        mostrarToast("Distribuição dos 27 estados atualizada!");
      } catch (err) {
        mostrarToast(err.message || "Erro ao sincronizar UFs.");
        alvoAcao.disabled = false;
        alvoAcao.textContent = "Sincronizar 27 UFs (Trends)";
      }
      return;
    }

    if (acao === "limpar-selecao") {
      estado.selecionados = [];
      salvarPreferencias();
      renderizarTudo();
    }
  });
}

/* ==========================================================================
   10. INICIALIZACAO
   ========================================================================== */
async function iniciarTrendRadar() {
  inicializarTema();
  carregarPreferencias();
  configurarEventos();
  await carregarDadosRadar(false);

  if (window.location.pathname.endsWith("/relatorio")) {
    abrirModalRelatorio();
  }
}

document.addEventListener("DOMContentLoaded", iniciarTrendRadar);

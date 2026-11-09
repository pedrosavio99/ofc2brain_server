/**
 * TrendRadar: a tela. Tudo que aparece aqui veio da coleta (manchetes reais,
 * contagem de materias, series que VOCE importou). Nao existe catalogo fixo.
 *
 * O que a IA escreve (quem paga, dores, concorrentes) aparece sempre rotulado
 * como "hipotese a validar".
 */
(function () {
  "use strict";

  var FRENTES = {
    saude: { rot: "Saúde", cor: "#34c759" },
    fintech: { rot: "Fintech & Fiscal", cor: "#0a84ff" },
    regtech: { rot: "RegTech & RH", cor: "#af52de" },
    govtech: { rot: "GovTech", cor: "#ff9f0a" },
    operacoes: { rot: "Obras & Campo", cor: "#ff6b35" },
    ia_devtools: { rot: "IA & Dev", cor: "#5e5ce6" },
    outras: { rot: "Outras", cor: "#8e8e93" }
  };
  var ORDENS = ["recentes", "alta", "combina"];
  var CHAVE_PREFS = "tr_radar_prefs_v3";
  var CHAVE_VISITA = "tr_ultima_visita_v2";
  var CHAVE_COLETA = "tr_coleta_tentada_v2";

  var estado = {
    dados: null, carregando: true, erro: null, coletando: false,
    busca: "", ordem: "recentes", frente: "todas", filtro: "todos",
    ultimaVisita: 0, ocupado: {}
  };

  /* ------------------------------------------------------------ utilidades */
  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function $(id) { return document.getElementById(id); }
  function urlSegura(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function plural(n, s, p) { return n + " " + (n === 1 ? s : p); }

  function quando(iso) {
    var t = typeof iso === "number" ? iso : Date.parse(iso);
    if (!t) return "";
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 2) return "agora há pouco";
    if (min < 60) return "há " + min + " min";
    var h = Math.round(min / 60);
    if (h < 24) return "há " + h + " h";
    var d = Math.round(h / 24);
    return d === 1 ? "ontem" : "há " + d + " dias";
  }
  /* SerpApi devolve "State of Santa Catarina" e "Federal District" em ingles. */
  function nomeRegiao(n) {
    return String(n || "").replace(/^State of /i, "").replace(/^Federal District$/i, "Distrito Federal");
  }
  function dataCurta(iso) {
    var m = String(iso || "").match(/^\d{4}-(\d{2})-(\d{2})/);
    return m ? m[2] + "/" + m[1] : "";
  }

  var timerToast = null;
  function toast(msg) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("visivel");
    if (timerToast) clearTimeout(timerToast);
    timerToast = setTimeout(function () { el.classList.remove("visivel"); }, 3200);
  }

  function salvarPrefs() {
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify({ ordem: estado.ordem, frente: estado.frente })); } catch (e) {}
  }
  function lerPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(CHAVE_PREFS) || "{}");
      if (ORDENS.indexOf(p.ordem) >= 0) estado.ordem = p.ordem;
      if (p.frente === "todas" || FRENTES[p.frente]) estado.frente = p.frente;
    } catch (e) {}
    try { estado.ultimaVisita = Number(localStorage.getItem(CHAVE_VISITA)) || 0; } catch (e) {}
  }

  /* tema (mesma chave do resto do app) */
  function aplicarTema(modo) {
    try {
      if (modo === "sistema") { localStorage.setItem("2brain-tema", "sistema"); localStorage.removeItem("tema_preferido"); }
      else { localStorage.setItem("2brain-tema", modo); localStorage.setItem("tema_preferido", modo); }
    } catch (e) {}
    document.documentElement.dataset.tema = modo;
  }
  function temaAtual() {
    try { return localStorage.getItem("2brain-tema") || "sistema"; } catch (e) { return "sistema"; }
  }

  /* --------------------------------------------------------------- API */
  async function api(caminho, opcoes) {
    var resp = await fetch("/trendradar/api" + caminho, Object.assign({ headers: { Accept: "application/json" } }, opcoes || {}));
    var dados = {};
    try { dados = await resp.json(); } catch (e) {}
    if (!resp.ok || dados.erro) throw new Error(dados.erro || "O servidor respondeu " + resp.status + ".");
    return dados;
  }
  function enviar(metodo, caminho, corpo) {
    return api(caminho, { method: metodo, headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(corpo || {}) });
  }

  async function carregar() {
    try {
      estado.dados = await api("/radar");
      estado.erro = null;
    } catch (e) {
      estado.erro = e.message;
    }
    estado.carregando = false;
    desenhar();
  }

  async function coletar(forcar) {
    if (estado.coletando) return;
    estado.coletando = true;
    desenhar();
    try {
      var r = await enviar("POST", "/coletar", { forcar: Boolean(forcar) });
      await carregar();
      if (r.pulada) toast("Os dados já estão em dia.");
      else toast(r.novas ? plural(r.novas, "sinal novo encontrado.", "sinais novos encontrados.") : "Coleta feita. Nenhum assunto novo desta vez.");
    } catch (e) {
      toast("A coleta falhou: " + e.message);
    }
    estado.coletando = false;
    desenhar();
  }

  /* ----------------------------------------------------- filtro e ordem */
  function pulsoN(c) { return c.pulso && c.pulso.estado !== "sem_dado" ? c.pulso : null; }
  function combina(c) { return Boolean(c.afinidade && c.afinidade.nota_id); }

  var FILTROS = {
    todos: function () { return true; },
    novos: function (c) { return ehNovo(c); },
    subindo: function (c) { return c.pulso && c.pulso.estado === "subindo"; },
    esfriando: function (c) { return c.pulso && c.pulso.estado === "esfriando"; },
    combina: combina,
    salvos: function (c) { return c.status === "salva"; },
    investigados: function (c) { return c.status === "investigada"; }
  };

  function ehNovo(c) {
    return c.novo || (c.status === "nova" && estado.ultimaVisita && Date.parse(c.detectadoEm) > estado.ultimaVisita);
  }

  function visiveis() {
    var todos = (estado.dados && estado.dados.cartoes) || [];
    var q = estado.busca.trim().toLowerCase();
    var lista = todos.filter(function (c) {
      if (estado.frente !== "todas" && c.frente !== estado.frente) return false;
      if (!FILTROS[estado.filtro](c)) return false;
      if (!q) return true;
      var palheiro = [c.titulo, c.termo, c.dor, c.porqueAgora].concat((c.sinais || []).map(function (s) { return s.titulo; })).join(" ").toLowerCase();
      return palheiro.indexOf(q) >= 0;
    });
    var porData = function (a, b) { return String(b.detectadoEm).localeCompare(String(a.detectadoEm)); };
    if (estado.ordem === "alta") {
      lista.sort(function (a, b) {
        var ca = a.calor == null ? -1 : a.calor, cb = b.calor == null ? -1 : b.calor;
        return cb - ca || porData(a, b);
      });
    } else if (estado.ordem === "combina") {
      lista.sort(function (a, b) {
        var sa = combina(a) ? a.afinidade.score || 0.01 : 0, sb = combina(b) ? b.afinidade.score || 0.01 : 0;
        return sb - sa || porData(a, b);
      });
    } else lista.sort(porData);
    return lista;
  }

  /* --------------------------------------------------------- desenho */
  function sparkline(serie, cor, grande) {
    var w = grande ? 320 : 96, h = grande ? 64 : 26, pad = 3;
    if (!serie || serie.length < 2) return "";
    var vs = serie.map(function (p) { return Number(p.valor) || 0; });
    var max = Math.max.apply(null, vs), min = Math.min.apply(null, vs);
    var span = max - min || 1;
    var pts = vs.map(function (v, i) {
      return [pad + (i * (w - 2 * pad)) / (vs.length - 1), h - pad - ((v - min) / span) * (h - 2 * pad)];
    });
    var linha = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = linha + " L" + pts[pts.length - 1][0].toFixed(1) + " " + h + " L" + pts[0][0].toFixed(1) + " " + h + " Z";
    var ult = pts[pts.length - 1];
    return '<svg class="tr-spark' + (grande ? " grande" : "") + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + area + '" fill="' + cor + '" opacity=".14"/>' +
      '<path d="' + linha + '" fill="none" stroke="' + cor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + ult[0].toFixed(1) + '" cy="' + ult[1].toFixed(1) + '" r="' + (grande ? 3.4 : 2.6) + '" fill="' + cor + '"/></svg>';
  }

  function pulsoRotulo(c) {
    var p = c.pulso;
    if (!p) return { cls: "nenhum", titulo: "Ainda sem medição", sub: "A primeira leitura da imprensa vem na próxima coleta." };
    if (p.estado === "sem_dado") {
      if (!p.sete && !p.anteriores) {
        return { cls: "pouco", titulo: "Nenhuma matéria com esse termo exato", sub: "Buscando por “" + c.termo + "” nos últimos 14 dias não veio nada. As manchetes abaixo vieram de outra busca." };
      }
      return { cls: "pouco", titulo: "Pouca cobertura na imprensa", sub: plural(p.sete, "matéria", "matérias") + " em 7 dias, " + p.anteriores + " nos 7 anteriores. Pouco para dizer se sobe ou desce." };
    }
    var seta = p.estado === "subindo" ? "▲" : p.estado === "esfriando" ? "▼" : "●";
    var pct = (p.variacaoPct > 0 ? "+" : "") + p.variacaoPct + "%";
    var verbo = p.estado === "subindo" ? "subindo" : p.estado === "esfriando" ? "esfriando" : "estável";
    return { cls: p.estado, titulo: seta + " " + pct + " na imprensa", sub: plural(p.sete, "matéria", "matérias") + " em 7 dias contra " + p.anteriores + " nos 7 anteriores (" + verbo + ")" + (p.amostraPequena ? ". Amostra pequena: leia com cautela." : "") };
  }

  function selosDe(c) {
    var s = [];
    if (ehNovo(c)) s.push('<span class="tr-selo novo">Novo</span>');
    if (c.status === "salva") s.push('<span class="tr-selo salvo">★ Salvo</span>');
    if (c.status === "investigada") s.push('<span class="tr-selo inv">Investigado</span>');
    if (c.origem === "pesquisa") s.push('<span class="tr-selo">Pesquisa sua</span>');
    if (c.origem === "csv") s.push('<span class="tr-selo">CSV seu</span>');
    return s.join("");
  }

  function fonteLinha(s) {
    var u = urlSegura(s.url);
    var txt = esc(s.titulo);
    return '<li>' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>" : txt) +
      '<span class="tr-fonte">' + esc(s.fonte || "") + (s.data ? " · " + esc(dataCurta(s.data)) : "") + "</span></li>";
  }

  function cartaoHtml(c) {
    var f = FRENTES[c.frente] || FRENTES.outras;
    var pr = pulsoRotulo(c);
    var spark = c.serie && c.serie.length >= 2 ? sparkline(c.serie, f.cor, false) : "";
    var fontes = (c.sinais || []).slice(0, 2).map(fonteLinha).join("");
    var corpo = c.porqueAgora || c.dor || "";
    var nota = combina(c)
      ? '<p class="tr-cartao-nota">Combina com uma nota sua' + (c.afinidade.data ? " de " + esc(dataCurta(c.afinidade.data)) : "") + (c.afinidade.resumo ? ': “' + esc(c.afinidade.resumo) + '”' : "") + "</p>"
      : "";
    var ocupado = estado.ocupado[c.id];
    return '<article class="tr-cartao' + (ehNovo(c) ? " e-novo" : "") + '" data-id="' + esc(c.id) + '" style="--cor:' + f.cor + '" tabindex="0">' +
      '<div class="tr-cartao-topo"><span class="tr-frente"><i></i>' + esc(f.rot) + "</span>" + selosDe(c) + "</div>" +
      '<h3 class="tr-cartao-titulo">' + esc(c.titulo) + "</h3>" +
      '<div class="tr-pulso tr-pulso-' + pr.cls + '"><div class="tr-pulso-txt"><strong>' + esc(pr.titulo) + "</strong><span>" + esc(pr.sub) + "</span></div>" + spark + "</div>" +
      (corpo ? '<p class="tr-cartao-corpo">' + esc(corpo) + "</p>" : "") +
      (fontes ? '<ul class="tr-fontes">' + fontes + "</ul>" : "") +
      nota +
      '<div class="tr-acoes">' +
      '<button type="button" class="tr-btn primario" data-acao="abrir" data-id="' + esc(c.id) + '">Ver detalhes</button>' +
      '<button type="button" class="tr-btn" data-acao="conversar" data-id="' + esc(c.id) + '">Conversar</button>' +
      (c.status === "investigada" ? "" :
        '<button type="button" class="tr-btn" data-acao="salvar" data-id="' + esc(c.id) + '"' + (ocupado ? " disabled" : "") + ">" + (c.status === "salva" ? "★ Salvo" : "Salvar") + "</button>") +
      '<button type="button" class="tr-btn discreto" data-acao="descartar" data-id="' + esc(c.id) + '"' + (ocupado ? " disabled" : "") + ' aria-label="Descartar">Descartar</button>' +
      "</div></article>";
  }

  function desenharTopo() {
    var d = estado.dados, el = $("resumoTopo");
    if (!el) return;
    if (estado.erro) { el.textContent = "Não foi possível ler o radar."; return; }
    if (!d) { el.textContent = "Lendo o que a imprensa publicou…"; return; }
    var r = d.resumo;
    el.textContent = r.total
      ? plural(r.total, "alvo", "alvos") + " · " + (d.coletadoEm ? "coletado " + quando(d.coletadoEm) : "ainda sem coleta")
      : "Nada coletado ainda";
  }

  function desenharAviso() {
    var el = $("trAviso"), d = estado.dados, h = "";
    if (!el) return;
    if (estado.coletando) {
      h = '<div class="tr-aviso coleta"><span class="tr-giro"></span><div><strong>Coletando agora</strong><span>Lendo manchetes das 6 frentes e medindo cada assunto. Leva uns 10 a 40 segundos.</span></div></div>';
    } else if (estado.erro) {
      h = '<div class="tr-aviso erro"><div><strong>Não consegui ler o radar</strong><span>' + esc(estado.erro) + '</span></div><button type="button" class="tr-btn" data-acao="recarregar">Tentar de novo</button></div>';
    } else if (d && d.banco && d.banco.ok === false) {
      h = d.banco.motivo === "esquema"
        ? '<div class="tr-aviso atencao"><div><strong>Falta atualizar o banco</strong><span>' + esc(d.banco.dica) + " Enquanto isso, pesquisar e investigar não conseguem salvar.</span></div></div>"
        : '<div class="tr-aviso atencao"><div><strong>O histórico ainda não está sendo guardado</strong><span>' + esc(d.banco.dica || "Rode supabase/trendradar-v2.sql no SQL Editor do Supabase.") + " Até lá, o que o radar achou some quando o servidor reinicia.</span></div></div>";
    }
    el.innerHTML = h;
  }

  function desenharResumo() {
    var el = $("trResumo"), d = estado.dados;
    if (!el) return;
    if (!d || !d.resumo.total) { el.innerHTML = ""; return; }
    var r = d.resumo;
    var novosN = (d.cartoes || []).filter(ehNovo).length;
    var blocos = [
      ["novos", novosN, "Novos"], ["subindo", r.subindo, "Subindo"], ["esfriando", r.esfriando, "Esfriando"],
      ["combina", r.combinamComVoce, "Combinam com você"], ["salvos", r.salvos, "Salvos"], ["investigados", r.investigados, "Investigados"]
    ];
    el.innerHTML = blocos.map(function (b) {
      return '<button type="button" class="tr-tile t-' + b[0] + (estado.filtro === b[0] ? " ativo" : "") + (b[1] ? "" : " zerado") + '" data-acao="filtro" data-filtro="' + b[0] + '">' +
        '<strong>' + b[1] + "</strong><span>" + b[2] + "</span></button>";
    }).join("");
  }

  function desenharFiltros() {
    var el = $("trFiltros"), d = estado.dados;
    if (!el) return;
    if (!d || !d.resumo.total) { el.innerHTML = ""; return; }
    var cont = { todas: d.cartoes.length };
    d.cartoes.forEach(function (c) { cont[c.frente] = (cont[c.frente] || 0) + 1; });
    var chips = ["todas"].concat(Object.keys(FRENTES)).filter(function (k) { return k === "todas" || cont[k]; }).map(function (k) {
      var nome = k === "todas" ? "Todas" : FRENTES[k].rot;
      return '<button type="button" class="chip' + (estado.frente === k ? " ativo" : "") + '" data-acao="frente" data-frente="' + k + '">' +
        (k === "todas" ? "" : '<span class="ponto" style="background:' + FRENTES[k].cor + '"></span>') +
        "<span>" + esc(nome) + '</span><span class="n">' + (cont[k] || 0) + "</span></button>";
    }).join("");
    el.innerHTML = '<div class="faixa-chips"><div class="chips">' + chips + "</div></div>";
  }

  function moverIndicador() {
    var nav = $("trOrdem"), ind = $("trIndicador");
    if (!nav || !ind) return;
    var ativo = nav.querySelector("button.ativo");
    if (!ativo) return;
    ind.style.width = ativo.offsetWidth + "px";
    ind.style.transform = "translateX(" + (ativo.offsetLeft - 2) + "px)";
  }

  function desenharLista() {
    var el = $("trLista"), rod = $("trRodape");
    if (!el) return;
    if (estado.carregando || (estado.coletando && !(estado.dados && estado.dados.cartoes.length))) {
      var um = '<div class="esqueleto"><div class="linha"></div><div class="linha"></div><div class="linha"></div></div>';
      el.innerHTML = um + um + um + um;
      if (rod) rod.textContent = "";
      return;
    }
    if (estado.erro && !estado.dados) { el.innerHTML = ""; return; }
    var d = estado.dados, todos = (d && d.cartoes) || [];
    if (!todos.length) {
      el.innerHTML = '<div class="vazio"><span class="emoji">📡</span><h3>O radar ainda não coletou nada</h3>' +
        "<p>Ele lê manchetes reais das 6 frentes e propõe oportunidades ancoradas nelas. A primeira coleta leva alguns segundos.</p>" +
        '<div class="tr-vazio-acoes"><button type="button" class="btn" data-acao="coletar">Coletar agora</button>' +
        '<button type="button" class="btn btn-suave" data-acao="pesquisar">Pesquisar um assunto</button></div></div>';
      if (rod) rod.textContent = "";
      return;
    }
    var lista = visiveis();
    if (!lista.length) {
      el.innerHTML = '<div class="vazio"><span class="emoji">🔎</span><h3>Nada neste recorte</h3><p>Troque o filtro ou a busca.</p>' +
        '<div class="tr-vazio-acoes"><button type="button" class="btn btn-suave" data-acao="limpar-filtros">Mostrar tudo</button></div></div>';
    } else {
      el.innerHTML = lista.map(cartaoHtml).join("");
    }
    if (rod) rod.textContent = "Manchetes e contagens vêm do Google Notícias, medidas a cada coleta. A contagem mostra atenção da imprensa, não demanda de mercado: valide com clientes antes de construir.";
  }

  function desenhar() {
    desenharTopo();
    desenharAviso();
    desenharResumo();
    desenharFiltros();
    desenharLista();
    document.querySelectorAll("#trOrdem button").forEach(function (b) { b.classList.toggle("ativo", b.dataset.ordem === estado.ordem); });
    requestAnimationFrame(moverIndicador);
    var cb = $("caixaBusca");
    if (cb) cb.classList.toggle("tem-texto", Boolean(estado.busca.trim()));
  }

  /* ----------------------------------------------------------- sheet */
  function abrirSheet(titulo, html) {
    $("sheetTitulo").textContent = titulo;
    $("sheetCorpo").innerHTML = html;
    $("cortina").classList.add("aberta", "visivel");
    var s = $("sheet");
    s.classList.add("aberto", "visivel");
    s.setAttribute("aria-hidden", "false");
  }
  function fecharSheet() {
    $("cortina").classList.remove("aberta", "visivel");
    var s = $("sheet");
    s.classList.remove("aberto", "visivel");
    s.setAttribute("aria-hidden", "true");
    estado.abertoId = null;
  }

  function achar(id) {
    return ((estado.dados && estado.dados.cartoes) || []).filter(function (c) { return c.id === id; })[0] || null;
  }

  function secao(titulo, rotulo, corpo) {
    return '<section class="tr-sec"><h4>' + esc(titulo) + (rotulo ? '<em>' + esc(rotulo) + "</em>" : "") + "</h4>" + corpo + "</section>";
  }

  function detalheHtml(c) {
    var f = FRENTES[c.frente] || FRENTES.outras;
    var pr = pulsoRotulo(c);
    var h = '<div class="tr-det-topo" style="--cor:' + f.cor + '"><span class="tr-frente"><i></i>' + esc(f.rot) + "</span>" + selosDe(c) +
      '<span class="tr-det-quando">detectado ' + esc(quando(c.detectadoEm)) + "</span></div>";

    if (c.porqueAgora) h += secao("Por que agora", "", '<p class="tr-par">' + esc(c.porqueAgora) + "</p>");

    // imprensa
    var fontes = (c.sinais || []);
    h += secao("O que a imprensa publicou", fontes.length ? plural(fontes.length, "matéria", "matérias") : "",
      fontes.length ? '<ul class="tr-fontes cheio">' + fontes.map(fonteLinha).join("") + "</ul>" : '<p class="tr-vazio-txt">Nenhuma manchete guardada para este alvo.</p>');

    // pulso
    var pulsoHtml = '<div class="tr-pulso tr-pulso-' + pr.cls + ' solto"><div class="tr-pulso-txt"><strong>' + esc(pr.titulo) + "</strong><span>" + esc(pr.sub) + "</span></div></div>";
    if (c.serie && c.serie.length >= 2) {
      pulsoHtml += '<div class="tr-grafico">' + sparkline(c.serie, f.cor, true) + '<div class="tr-grafico-eixo"><span>' + esc(dataCurta(c.serie[0].data)) + "</span><span>" +
        esc(dataCurta(c.serie[c.serie.length - 1].data)) + "</span></div></div>" +
        '<p class="tr-nota-pequena">Cada ponto é uma coleta diária (matérias dos 7 dias anteriores àquele dia). A linha cresce a cada dia que o radar roda.</p>';
    } else if (c.pulso) {
      pulsoHtml += '<p class="tr-nota-pequena">Esta é a primeira medição. O gráfico aparece a partir da segunda coleta.</p>';
    }
    h += secao("Pulso na imprensa", "medido", pulsoHtml);

    // Google Trends real (CSV ou SerpApi)
    if (c.trends) {
      var cv = c.curva;
      h += secao("Série do Google Trends", c.origem === "csv" ? "importada por você" : "SerpApi",
        '<div class="tr-grafico">' + sparkline(c.trends, f.cor, true) + '<div class="tr-grafico-eixo"><span>' + esc(c.trends[0].data) + "</span><span>" + esc(c.trends[c.trends.length - 1].data) + "</span></div></div>" +
        (cv ? '<p class="tr-par">' + esc(cv.classificacaoCurva) + ": crescimento de " + (cv.crescimentoPct > 0 ? "+" : "") + cv.crescimentoPct + "% e consistência de " + cv.consistenciaScore + "%. <span class=\"tr-nota-pequena\">Calculado sobre essa série.</span></p>" : ""));
    }
    if (c.regioes) {
      var maxR = Math.max.apply(null, c.regioes.map(function (r) { return r.indice; })) || 1;
      h += secao("Onde mais se busca", "Google Trends",
        '<div class="tr-regioes">' + c.regioes.slice(0, 8).map(function (r) {
          return '<div class="tr-regiao"><span>' + esc(nomeRegiao(r.regiao)) + '</span><div><i style="width:' + Math.max(6, Math.round((r.indice / maxR) * 100)) + '%"></i></div><b>' + r.indice + "</b></div>";
        }).join("") + "</div>");
    }

    // leitura da IA
    var dos = c.dossie;
    if (dos) {
      var li = function (arr) { return arr && arr.length ? "<ul>" + arr.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; };
      h += secao("Leitura da IA", "hipóteses a validar",
        '<div class="tr-hipoteses">' +
        '<p><strong>Quem pagaria:</strong> ' + esc(dos.quemPaga) + "</p>" +
        (dos.dores && dos.dores.length ? "<p><strong>Dores prováveis:</strong></p>" + li(dos.dores) : "") +
        (dos.concorrentesProvaveis && dos.concorrentesProvaveis.length ? "<p><strong>Soluções que provavelmente já existem:</strong></p>" + li(dos.concorrentesProvaveis) : "") +
        (dos.testeRapido ? "<p><strong>Teste em 7 dias:</strong> " + esc(dos.testeRapido) + "</p>" : "") +
        (dos.validar && dos.validar.length ? "<p><strong>O que ainda não se sabe:</strong></p>" + li(dos.validar) : "") +
        '</div><p class="tr-nota-pequena">Escrito por IA a partir das manchetes acima. Nada aqui foi medido: confirme conversando com clientes.</p>');
    } else if (c.dor) {
      h += secao("Leitura da IA", "hipótese a validar", '<p class="tr-par">' + esc(c.dor) + '</p><p class="tr-nota-pequena">Escrito por IA a partir das manchetes. Use “Investigar” para aprofundar com hipóteses e um teste rápido.</p>');
    }

    if (combina(c)) {
      h += secao("Combina com você", "sua nota" + (c.afinidade.data ? " de " + dataCurta(c.afinidade.data) : ""), '<p class="tr-par">“' + esc(c.afinidade.resumo || "") + '”</p>');
    }

    var ocupado = estado.ocupado[c.id];
    h += '<div class="tr-det-acoes">' +
      (c.status === "investigada"
        ? '<button type="button" class="tr-btn primario" data-acao="investigar" data-id="' + esc(c.id) + '"' + (ocupado ? " disabled" : "") + ">" + (ocupado === "inv" ? "Pesquisando…" : "Atualizar pesquisa") + "</button>"
        : '<button type="button" class="tr-btn primario" data-acao="investigar" data-id="' + esc(c.id) + '"' + (ocupado ? " disabled" : "") + ">" + (ocupado === "inv" ? "Pesquisando…" : "Investigar a fundo") + "</button>") +
      '<button type="button" class="tr-btn" data-acao="conversar" data-id="' + esc(c.id) + '">Conversar</button>' +
      (c.status === "investigada" ? "" : '<button type="button" class="tr-btn" data-acao="salvar" data-id="' + esc(c.id) + '">' + (c.status === "salva" ? "★ Salvo" : "Salvar") + "</button>") +
      '<button type="button" class="tr-btn discreto" data-acao="descartar" data-id="' + esc(c.id) + '">Descartar</button></div>';
    return h;
  }

  function abrirDetalhe(id) {
    var c = achar(id);
    if (!c) return;
    estado.abertoId = id;
    abrirSheet(c.titulo, detalheHtml(c));
  }

  /* ------------------------------------------------------------ ações */
  async function mudarStatus(id, status) {
    var c = achar(id);
    if (!c) return;
    estado.ocupado[id] = status;
    desenharLista();
    try {
      await enviar("PATCH", "/descobertas", { id: id, status: status });
      if (status === "descartada") {
        estado.dados.cartoes = estado.dados.cartoes.filter(function (x) { return x.id !== id; });
        estado.dados.resumo = recontar(estado.dados.cartoes);
        if (estado.abertoId === id) fecharSheet();
        toast("Descartado. Esse assunto não volta como novo.");
      } else {
        c.status = status;
        c.novo = false;
        estado.dados.resumo = recontar(estado.dados.cartoes);
        toast(status === "salva" ? "Salvo no seu radar." : "Voltou para a lista.");
        if (estado.abertoId === id) abrirDetalhe(id);
      }
    } catch (e) {
      toast("Não consegui salvar: " + e.message);
    }
    delete estado.ocupado[id];
    desenhar();
  }

  function recontar(cartoes) {
    var por = function (f) { return cartoes.filter(f).length; };
    return {
      total: cartoes.length, novos: por(function (c) { return c.novo; }), salvos: por(function (c) { return c.status === "salva"; }),
      investigados: por(function (c) { return c.status === "investigada"; }),
      subindo: por(function (c) { return c.pulso && c.pulso.estado === "subindo"; }),
      esfriando: por(function (c) { return c.pulso && c.pulso.estado === "esfriando"; }),
      comMedicao: por(function (c) { return c.pulso && c.pulso.estado !== "sem_dado"; }),
      combinamComVoce: por(combina)
    };
  }

  async function investigar(id) {
    var c = achar(id);
    if (!c || estado.ocupado[id]) return;
    estado.ocupado[id] = "inv";
    if (estado.abertoId === id) abrirDetalhe(id);
    desenharLista();
    toast("Lendo a imprensa e montando hipóteses. Leva de 10 a 25 segundos.");
    try {
      var r = await enviar("POST", "/descobertas/investigar", { id: id });
      await carregar();
      toast(r.comIa ? "Pesquisa pronta." : "Imprensa atualizada. A IA não respondeu agora, então ficou sem hipóteses.");
    } catch (e) {
      toast("A pesquisa falhou: " + e.message);
    }
    delete estado.ocupado[id];
    desenhar();
    if (estado.abertoId === id) abrirDetalhe(id);
  }

  function conversar(id) {
    var c = achar(id);
    if (!c) return;
    var fim = function (t) { return /[.!?]$/.test(t) ? t : t + "."; };
    var porque = String(c.porqueAgora || "").trim();
    if (porque.length > 150) porque = porque.slice(0, 150).replace(/\s+\S*$/, "") + "…";
    var msg = "Vi no radar: " + fim(String(c.titulo || "").trim()) + " " + (porque ? fim(porque) + " " : "") + "Vale a pena pra mim? Me ajuda a pensar.";
    location.href = "/conversa?abrir=" + encodeURIComponent(msg);
  }

  /* ------------------------------------------------- pesquisa e CSV */
  function modalPesquisar() {
    abrirSheet("Pesquisar um alvo",
      '<form id="formPesquisar" class="tr-form">' +
      '<p class="tr-par">Digite um assunto, empresa ou dor. O radar lê a imprensa dos últimos 14 dias sobre ele e a IA monta hipóteses a partir das manchetes.</p>' +
      '<input id="campoPesquisa" class="tr-input" type="text" required minlength="3" maxlength="120" placeholder="ex.: glosas médicas, reforma tributária, NR-1" autocomplete="off" />' +
      '<p class="tr-nota-pequena">Quanto mais curto e específico, melhor (2 a 5 palavras).</p>' +
      '<button type="submit" class="btn btn-largo" id="btnPesquisar">Pesquisar</button></form>');
    setTimeout(function () { var c = $("campoPesquisa"); if (c) c.focus(); }, 250);
  }

  async function enviarPesquisa(form) {
    var termo = $("campoPesquisa").value.trim();
    var b = $("btnPesquisar");
    b.disabled = true; b.textContent = "Lendo a imprensa… (10 a 25 s)";
    try {
      var r = await enviar("POST", "/investigar", { termo: termo });
      await carregar();
      abrirDetalhe(r.id);
      if (!r.comImprensa) toast("Quase nada na imprensa sobre esse termo nos últimos 14 dias.");
    } catch (e) {
      b.disabled = false; b.textContent = "Pesquisar";
      toast("A pesquisa falhou: " + e.message);
    }
  }

  function modalCsv() {
    var opts = Object.keys(FRENTES).map(function (k) { return '<option value="' + k + '">' + esc(FRENTES[k].rot) + "</option>"; }).join("");
    abrirSheet("Importar série do Google Trends",
      '<form id="formCsv" class="tr-form">' +
      '<p class="tr-par">Exporte o CSV em trends.google.com e cole aqui. A série entra no radar como ela é, sem ajuste nenhum.</p>' +
      '<input id="csvNome" class="tr-input" type="text" maxlength="120" placeholder="Nome do assunto (opcional se o CSV já trouxer)" />' +
      '<select id="csvFrente" class="tr-input">' + opts.replace('value="outras"', 'value="outras" selected') + "</select>" +
      '<textarea id="csvTexto" class="tr-input" rows="8" required placeholder="Semana,seu termo: (Brasil)&#10;2026-05-01,31&#10;2026-06-01,39&#10;…"></textarea>' +
      '<button type="submit" class="btn btn-largo" id="btnCsv">Importar</button></form>');
  }

  async function enviarCsv() {
    var b = $("btnCsv");
    b.disabled = true; b.textContent = "Importando…";
    try {
      var r = await enviar("POST", "/importar-csv", { csv: $("csvTexto").value, nome: $("csvNome").value, frente: $("csvFrente").value });
      await carregar();
      abrirDetalhe(r.id);
      toast(plural(r.periodos, "período importado.", "períodos importados."));
    } catch (e) {
      b.disabled = false; b.textContent = "Importar";
      toast(e.message);
    }
  }

  /* ----------------------------------------------------------- menu */
  function menu() {
    var d = estado.dados;
    var item = function (acao, titulo, sub, icone) {
      return '<button type="button" class="item" data-acao="' + acao + '">' + icone +
        '<div class="item-txt"><strong>' + titulo + "</strong><span>" + sub + "</span></div></button>";
    };
    var svg = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>"; };
    var tema = temaAtual();
    var pill = function (v, rot) { return '<button type="button" class="tr-pill' + (tema === v ? " ativo" : "") + '" data-acao="tema" data-tema="' + v + '">' + rot + "</button>"; };
    abrirSheet("Ferramentas do TrendRadar",
      '<p class="grupo-titulo">Alimentar o radar</p><div class="grupo">' +
      item("pesquisar", "Pesquisar um alvo", "Assunto, empresa ou dor: imprensa real + hipóteses", svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/>')) +
      item("csv", "Importar série do Google Trends", "Cole o CSV que você exportou", svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>')) +
      item("coletar-forcar", "Coletar agora", d && d.coletadoEm ? "Última coleta " + esc(quando(d.coletadoEm)) + ". A automática roda 1 vez por dia." : "Ainda não houve coleta", svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>')) +
      "</div>" +
      '<p class="grupo-titulo">Levar daqui</p><div class="grupo">' +
      item("markdown", "Copiar radar em Markdown", "O que está na tela agora, com fontes e links", svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')) +
      "</div>" +
      '<p class="grupo-titulo">Aparência</p><div class="tr-pills">' + pill("sistema", "Automática") + pill("claro", "Clara") + pill("escuro", "Escura") + "</div>" +
      '<p class="grupo-titulo">Como funciona</p><p class="tr-par pequeno">Todo dia o radar lê manchetes das 6 frentes, pede à IA oportunidades que elas sustentam (exige 2 veículos diferentes) e mede, para cada assunto, quantas matérias saíram nos últimos 7 dias contra os 7 anteriores. Nada é estimado: onde não há medição, a tela diz isso.</p>');
  }

  function copiarMarkdown() {
    var lista = visiveis();
    if (!lista.length) { toast("Não há nada na tela para copiar."); return; }
    var linhas = ["# TrendRadar", "", "_Coletado " + quando(estado.dados.coletadoEm || Date.now()) + ". Manchetes e contagens: Google Notícias._", ""];
    lista.forEach(function (c) {
      var f = FRENTES[c.frente] || FRENTES.outras, pr = pulsoRotulo(c);
      linhas.push("## " + c.titulo, "- Frente: " + f.rot + " · detectado " + quando(c.detectadoEm), "- Imprensa: " + pr.titulo + " (" + pr.sub + ")");
      if (c.porqueAgora) linhas.push("- Por que agora: " + c.porqueAgora);
      if (c.dor) linhas.push("- Leitura da IA (hipótese): " + c.dor);
      (c.sinais || []).forEach(function (s) {
        var u = urlSegura(s.url);
        linhas.push("- " + (u ? "[" + s.titulo + "](" + u + ")" : s.titulo) + " (" + (s.fonte || "") + ", " + dataCurta(s.data) + ")");
      });
      linhas.push("");
    });
    var texto = linhas.join("\n");
    var ok = function () { toast("Copiado: " + plural(lista.length, "alvo", "alvos") + " em Markdown."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, function () { toast("O navegador bloqueou a cópia."); });
    else toast("Seu navegador não permite copiar daqui.");
  }

  /* ---------------------------------------------------------- eventos */
  var ACOES = {
    abrir: function (el) { abrirDetalhe(el.dataset.id); },
    conversar: function (el) { conversar(el.dataset.id); },
    salvar: function (el) { var c = achar(el.dataset.id); if (c) mudarStatus(c.id, c.status === "salva" ? "nova" : "salva"); },
    descartar: function (el) { mudarStatus(el.dataset.id, "descartada"); },
    investigar: function (el) { investigar(el.dataset.id); },
    filtro: function (el) { estado.filtro = estado.filtro === el.dataset.filtro ? "todos" : el.dataset.filtro; desenhar(); },
    frente: function (el) { estado.frente = el.dataset.frente; salvarPrefs(); desenhar(); },
    ordem: function (el) { estado.ordem = el.dataset.ordem; salvarPrefs(); desenhar(); },
    "limpar-busca": function () { estado.busca = ""; $("campoBusca").value = ""; desenhar(); },
    "limpar-filtros": function () { estado.filtro = "todos"; estado.frente = "todas"; estado.busca = ""; $("campoBusca").value = ""; salvarPrefs(); desenhar(); },
    "fechar-sheet": fecharSheet,
    "abrir-menu": menu,
    "abrir-investigar": modalPesquisar,
    pesquisar: modalPesquisar,
    csv: modalCsv,
    markdown: copiarMarkdown,
    coletar: function () { coletar(true); },
    "coletar-forcar": function () { fecharSheet(); coletar(true); },
    "atualizar-radar": function () { coletar(true); },
    recarregar: function () { estado.carregando = true; desenhar(); carregar(); },
    tema: function (el) { aplicarTema(el.dataset.tema); menu(); }
  };

  function eventos() {
    document.addEventListener("click", function (e) {
      if (e.target.closest("a")) return; // link de manchete: abre a matéria e mais nada
      var el = e.target.closest("[data-acao]");
      if (el && ACOES[el.dataset.acao]) { e.preventDefault(); ACOES[el.dataset.acao](el); return; }
      var cartao = e.target.closest(".tr-cartao");
      if (cartao && !e.target.closest("button")) abrirDetalhe(cartao.dataset.id);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") fecharSheet();
      if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("tr-cartao")) { e.preventDefault(); abrirDetalhe(e.target.dataset.id); }
    });
    document.addEventListener("submit", function (e) {
      if (e.target.id === "formPesquisar") { e.preventDefault(); enviarPesquisa(e.target); }
      else if (e.target.id === "formCsv") { e.preventDefault(); enviarCsv(); }
    });
    var campo = $("campoBusca");
    if (campo) campo.addEventListener("input", function (e) { estado.busca = e.target.value || ""; desenharLista(); var cb = $("caixaBusca"); if (cb) cb.classList.toggle("tem-texto", Boolean(estado.busca.trim())); });
    window.addEventListener("resize", moverIndicador);
    window.addEventListener("pagehide", function () { try { localStorage.setItem(CHAVE_VISITA, String(Date.now())); } catch (e) {} });
  }

  /* ------------------------------------------------------------ início */
  async function iniciar() {
    try { var t = localStorage.getItem("2brain-tema"); if (t) document.documentElement.dataset.tema = t; } catch (e) {}
    lerPrefs();
    eventos();
    desenhar();
    await carregar();
    // dados velhos (ou nunca coletados): coleta sozinho, uma vez por sessao
    var tentou = false;
    try { tentou = sessionStorage.getItem(CHAVE_COLETA) === "1"; } catch (e) {}
    if (estado.dados && estado.dados.defasado && !tentou) {
      try { sessionStorage.setItem(CHAVE_COLETA, "1"); } catch (e) {}
      coletar(false);
    }
  }

  document.addEventListener("DOMContentLoaded", iniciar);
})();

/* Segundo cerebro - insight: geracao, formatos e continuidade.
   Depende de app.js: usa $, esc, api, avisar, abrirSheet, fecharSheet,
   render, cardNota, guardarNotasInsight, IA e S. Carregar DEPOIS do app.js.

   O insight tem dois eixos independentes:
     ANGULO  = quais secoes existem (panorama, contraponto, plano, conexoes)
     TAMANHO = quanto cabe em cada uma (curto, medio, longo)
   Os dois sao escolhidos DEPOIS de ler, como reformulacao de um clique: pedir
   a decisao antes de ver o resultado seria decidir no escuro.

   E o insight deixou de ser um texto que morre na tela: cada pedido de
   continuidade ("explique melhor", "discorde disso") vira um turno empilhado
   no mesmo modal, sem substituir o que veio antes. */

/* Catalogo local (o mesmo que /insight/formatos devolve). Fica hardcoded pra
   tela abrir sem esperar rede; o fetch abaixo so atualiza se o servidor mudar. */
var FORMATOS = {
  angulos: [
    { id: "panorama", rotulo: "Panorama", descricao: "Lê o conjunto e diz o que ele revela" },
    { id: "contraponto", rotulo: "Contraponto", descricao: "Ataca as premissas em vez de concordar" },
    { id: "plano", rotulo: "Plano", descricao: "Quase só ação, na ordem de fazer" },
    { id: "conexoes", rotulo: "Conexões", descricao: "Só as ligações entre as notas" },
  ],
  tamanhos: [
    { id: "curto", rotulo: "Curto" },
    { id: "medio", rotulo: "Médio" },
    { id: "longo", rotulo: "Longo" },
  ],
  atalhos: [
    { id: "explicar", rotulo: "Explique melhor" },
    { id: "exemplos", rotulo: "Mais exemplos" },
    { id: "encurtar", rotulo: "Encurte" },
    { id: "plano", rotulo: "Vira plano" },
    { id: "discordar", rotulo: "Discorde disso" },
  ],
};
var FORMATOS_BUSCADOS = false;

function buscarFormatos() {
  if (FORMATOS_BUSCADOS) return;
  FORMATOS_BUSCADOS = true;
  api("/insight/formatos").then(function (r) { return r.json(); }).then(function (d) {
    if (d && Array.isArray(d.angulos) && d.angulos.length) FORMATOS = d;
  }).catch(function () { /* fica com o catalogo local */ });
}

var INS = { titulo: "Insight", continuando: false };

/* O automatico e o padrao, e a escolha atravessa sessoes (como o tema). */
try { S.insightAuto = localStorage.getItem("2brain-formato-auto") !== "0"; } catch (e) { S.insightAuto = true; }
function definirAuto(ligado) {
  S.insightAuto = !!ligado;
  try { localStorage.setItem("2brain-formato-auto", ligado ? "1" : "0"); } catch (e) {}
}

function limparInsight() {
  S.insight = null;
  S.insightBlocos = null;
  S.insightFonte = null;
  S.insightNotas = null;
  S.insightThread = [];
  S.insightUrl = null;
}

/* ============================================================
   Geracao
   ============================================================ */

/* Guarda a URL SEM o formato. Trocar de angulo e so refazer a mesma consulta
   com outro sufixo, sem precisar reconstruir o escopo do zero. */
function gerarInsight(escopo) {
  if (S.insightCarregando) return;
  var esc0 = escopo || S.insightEscopo || (S.busca ? { tipo: "busca", q: S.busca } : null);
  if (!esc0) return;
  S.insightEscopo = esc0;

  if (esc0.tipo === "periodo") {
    // no periodo, o "tema" e o proprio recorte de tempo: mandamos os resumos
    // como consulta pra busca semantica achar o miolo do que foi guardado.
    var termos = esc0.notas.slice(0, 12).map(function (n) { return n.resumo || n.texto_original; }).join(". ");
    S.insightUrl = "/pesquisa?q=" + encodeURIComponent(termos.slice(0, 900)) + "&limite=12&insight=true";
    INS.titulo = "Insight do período";
  } else {
    S.insightUrl = "/pesquisa?q=" + encodeURIComponent(esc0.q) + "&limite=10&insight=true";
    INS.titulo = "Insight";
  }
  pedirInsight();
}

function gerarInsightAvancado() {
  lerFormIA();
  var q = (IA.q || "").trim();

  var params = [];
  if (q) params.push("q=" + encodeURIComponent(q));
  if (IA.area) params.push("area=" + encodeURIComponent(IA.area));
  if (IA.periodo === "custom") {
    if (IA.de) params.push("desde=" + encodeURIComponent(IA.de));
    if (IA.ate) params.push("ate=" + encodeURIComponent(IA.ate));
  } else if (IA.periodo && IA.periodo !== "tudo") {
    params.push("periodo=" + encodeURIComponent(IA.periodo));
  }
  params.push("limite=" + IA.limite);

  var g = $("#iaGerar");

  S.insightEscopo = { tipo: "avancado" };
  S.insightUrl = "/insight?" + params.join("&");
  INS.titulo = "Insight do recorte";

  var gerar = function () {
    if (g) { g.disabled = true; g.textContent = "Gerando…"; }
    pedirInsight(function () {
      if (g) { g.disabled = false; g.textContent = "Gerar insight"; }
      telaInsightAvancado(); // volta o formulario com os filtros preservados
    });
  };

  if (!S.insightAuto) { gerar(); return; }

  // Automatico: uma chamada curta decide o formato, e a pessoa confirma.
  if (g) { g.disabled = true; g.textContent = "Escolhendo o formato…"; }
  sugerirFormatoIA().then(function (sug) {
    if (g) { g.disabled = false; g.textContent = "Gerar insight"; }
    if (!sug || sug.fallback) {
      // o sugeridor e um ajudante: se ele falhou, nao segura a geracao
      if (sug && sug.motivo === "nenhuma nota neste recorte") {
        avisar("Nenhuma nota neste recorte.");
        return;
      }
      gerar();
      return;
    }
    S.insightAngulo = sug.angulo;
    S.insightTamanho = sug.tamanho;
    telaConfirmarFormato(sug, gerar);
  });
}

/* Manda os ids que o preview ja calculou. Sem eles o servidor refaria a
   selecao e, com frase de base, pagaria um embedding a toa. */
function sugerirFormatoIA() {
  var corpo = {
    ids: (IA_PREVIEW && IA_PREVIEW.ids) || [],
    q: (IA.q || "").trim() || null,
    area: IA.area || null,
    limite: IA.limite,
  };
  if (IA.periodo === "custom") {
    corpo.desde = IA.de || null;
    corpo.ate = IA.ate || null;
  } else if (IA.periodo && IA.periodo !== "tudo") {
    corpo.periodo = IA.periodo;
  }

  return api("/insight/sugerir-formato", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  }).then(function (r) { return r.json(); })
    // qualquer resposta que nao traga um angulo (erro do banco, 500, corpo
    // estranho) conta como fallback: o fluxo segue gerando no padrao
    .then(function (d) { return d && d.angulo ? d : { fallback: true }; })
    .catch(function () { return { fallback: true }; });
}

/* Confirmacao: mostra a escolha e o porque. "Gerar" e um toque; quem quiser
   discordar troca ali mesmo, sem voltar pra tela anterior. */
function telaConfirmarFormato(sug, gerar) {
  abrirSheet("Formato escolhido",
    '<div class="ins-sugestao">' +
      '<p class="ins-sug-rot">o app escolheu</p>' +
      "<h4>" + esc(sug.anguloRotulo) + " · " + esc(String(sug.tamanhoRotulo).toLowerCase()) + "</h4>" +
      (sug.motivo ? "<p>" + esc(sug.motivo) + "</p>" : "") +
      (typeof sug.notasConsideradas === "number"
        ? '<p class="ins-sug-notas">olhando ' + sug.notasConsideradas +
          (sug.notasConsideradas === 1 ? " nota" : " notas") + " do recorte</p>"
        : "") +
    "</div>" +
    '<button class="btn btn-largo" id="insConfirmar">Gerar assim</button>' +
    '<button class="btn btn-suave btn-largo" id="insTrocar" style="margin-top:10px">Escolher eu mesmo</button>' +
    '<p class="dica-compositor" style="display:block;text-align:center;margin-top:12px">' +
      "Depois de ler, dá pra reformular com outro ângulo sem perder nada.</p>");

  $("#insConfirmar").addEventListener("click", function () {
    var b = $("#insConfirmar");
    b.disabled = true;
    b.textContent = "Gerando…";
    gerar();
  });
  $("#insTrocar").addEventListener("click", function () { telaEscolherFormato(gerar); });
}

/* Escolha manual dentro do proprio fluxo, sem voltar pros filtros. */
function telaEscolherFormato(gerar) {
  abrirSheet("Escolher o formato",
    chipsFormato() +
    '<p class="dica-compositor" id="iaFormatoDica" style="display:block;margin:-4px 2px 18px">' +
      esc(descricaoDoFormato()) + "</p>" +
    '<button class="btn btn-largo" id="insConfirmar">Gerar assim</button>');

  var corpo = $("#sheetCorpo");
  ligarChipsFormato(corpo, function () {
    var dica = corpo.querySelector("#iaFormatoDica");
    if (dica) dica.textContent = descricaoDoFormato();
  });
  $("#insConfirmar").addEventListener("click", function () {
    var b = $("#insConfirmar");
    b.disabled = true;
    b.textContent = "Gerando…";
    gerar();
  });
}

/* Uma unica funcao busca o insight, seja de busca, periodo ou recorte: as tres
   rotas aceitam angulo/tamanho e devolvem o mesmo par insight + insight_blocos. */
function pedirInsight(aoFalhar) {
  if (!S.insightUrl || S.insightCarregando) return;
  buscarFormatos();
  // Se o modal ja esta aberto (refazendo com outro angulo, ou vindo do modal
  // avancado), a espera acontece DENTRO dele. So o estado antigo nao e apagado
  // agora: se a geracao falhar, a pessoa volta pro insight que ja tinha em vez
  // de ficar com a tela vazia.
  var comSheet = $("#sheet").classList.contains("aberto");
  S.insightCarregando = true;
  render();
  if (comSheet) {
    abrirSheet(INS.titulo,
      '<p class="dica-compositor" style="display:block;text-align:center;margin-bottom:14px">' +
      "Gerando com o formato escolhido…</p>" + esqueletos(3));
  }

  var url = S.insightUrl + "&angulo=" + encodeURIComponent(S.insightAngulo) +
    "&tamanho=" + encodeURIComponent(S.insightTamanho);

  api(url).then(function (r) { return r.json(); }).then(function (d) {
    if (d.erro) throw new Error(d.erro);
    if (!d.insight) {
      throw new Error(d.motivo ? "Sem insight: " + d.motivo : "O modelo não conseguiu gerar um insight agora.");
    }
    S.insight = d.insight || null;
    S.insightBlocos = d.insight_blocos || null;
    S.insightFonte = d.insight_meta || null;
    if (S.insightEscopo && S.insightEscopo.tipo === "busca" && d.resultados) {
      S.resultadosBusca = d.resultados;
    }
    guardarNotasInsight(d.resultados || d.notas);
    S.insightThread = [];
    abrirInsight(INS.titulo);
  }).catch(function (e) {
    avisar(e.message || "Não deu pra gerar o insight.");
    if (aoFalhar) aoFalhar();
    else if (comSheet && S.insight) abrirInsight(INS.titulo);
    else if (comSheet) fecharSheet();
  }).then(function () {
    S.insightCarregando = false;
    render();
  });
}

/* ============================================================
   Continuidade
   ============================================================ */

/* O servidor nao guarda estado: mandamos de volta o insight, os ids das notas
   que o alimentaram e as ultimas rodadas. O teto de historico vive no servidor
   (2 rodadas), aqui mandamos tudo e ele corta. */
function continuarInsight(opcoes) {
  if (INS.continuando) return;
  var o = opcoes || {};
  var rotulo = o.rotulo || o.pedido || "continuar";
  INS.continuando = true;

  var turno = { pedido: rotulo, resposta: null, carregando: true };
  S.insightThread.push(turno);
  pintarThread(true);

  var ids = (S.insightNotas || []).map(function (n) { return n.id; });
  var historico = S.insightThread
    .filter(function (t) { return t.resposta; })
    .map(function (t) { return { pedido: t.pedido, resposta: t.resposta }; });

  api("/insight/continuar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      anterior: S.insight,
      pedido: o.pedido || null,
      atalho: o.atalho || null,
      foco: o.foco || null,
      ids: ids,
      historico: historico,
      tamanho: S.insightTamanho,
    }),
  }).then(function (r) {
    return r.json().then(function (d) {
      if (!r.ok || d.erro) throw new Error(d.erro || "Não deu pra continuar.");
      return d;
    });
  }).then(function (d) {
    turno.resposta = d.resposta;
    turno.carregando = false;
    pintarThread(true);
  }).catch(function (e) {
    // turno que falhou sai da lista: deixar um balao vazio na tela e pior
    S.insightThread = S.insightThread.filter(function (t) { return t !== turno; });
    pintarThread(false);
    avisar(e.message || "Não deu pra continuar.");
  }).then(function () {
    INS.continuando = false;
  });
}

/* ============================================================
   Tela
   ============================================================ */

/* Faixa que mostra DE ONDE o insight saiu (provedor, modelo, qual chave do
   rodizio, quantas notas entraram e em que formato). Some sem metadados. */
function descreverFonte(meta) {
  if (!meta) return "";
  var provedor = meta.provedor === "gemini" ? "Gemini"
    : (meta.provedor === "groq" ? "Groq" : (meta.provedor || "modelo"));
  var linha1 = [provedor];
  if (meta.modelo) linha1.push(meta.modelo);
  if (meta.chave && meta.totalChaves) linha1.push("chave " + meta.chave + "/" + meta.totalChaves);

  var linha2 = [];
  if (meta.anguloRotulo) linha2.push(meta.anguloRotulo.toLowerCase() + (meta.tamanho ? " · " + meta.tamanho : ""));
  if (typeof meta.notasConsideradas === "number") {
    linha2.push(meta.notasConsideradas + " nota" + (meta.notasConsideradas === 1 ? "" : "s"));
  }
  if (meta.temTema && typeof meta.notasFortes === "number") {
    linha2.push(meta.notasFortes + " relevante" + (meta.notasFortes === 1 ? "" : "s") + " ao tema");
  }
  if (meta.pensando) linha2.push("modo pensamento");

  return '<div class="insight-fonte">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="15" height="15">' +
    '<path d="M12 3a6 6 0 00-3.5 10.9V16h7v-2.1A6 6 0 0012 3z"/><path d="M9.5 19h5M10 22h4"/></svg>' +
    "<span><strong>" + esc(linha1.join(" · ")) + "</strong>" +
    (linha2.length ? "<br>" + esc(linha2.join(" · ")) : "") + "</span></div>";
}

/* Acordeon com as notas que alimentaram o insight. Reusa o cardNota, entao
   fica igual a home (e o clique ja abre a nota pelo handler global do .nota). */
function blocoNotasInsight() {
  var lista = S.insightNotas;
  if (!Array.isArray(lista) || lista.length === 0) return "";
  var cards = lista.map(function (ref) {
    var full = S.notas.filter(function (x) { return x.id === ref.id; })[0];
    var nota = full || { id: ref.id, resumo: ref.resumo, area: ref.area, texto_original: "" };
    return cardNota(nota, { score: ref.score });
  }).join("");
  var n = lista.length;
  return '<details class="notas-insight">' +
    "<summary>" +
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M9 6l6 6-6 6"/></svg>' +
      "<span>Notas usadas no insight</span>" +
      '<span class="conta">' + n + "</span>" +
    "</summary>" +
    '<div class="lista duas">' + cards + "</div>" +
  "</details>";
}

function paragrafos(texto) {
  return String(texto || "").split(/\n{2,}/).map(function (t) {
    var linha = t.trim();
    return linha ? "<p>" + esc(linha) + "</p>" : "";
  }).join("");
}

/* Blocos: o servidor manda o insight ja quebrado em secoes, entao cada angulo
   se desenha do jeito dele. O caminho do texto puro fica como reserva (insight
   antigo em cache, ou servidor mais velho que este front). */
function htmlDosBlocos() {
  var blocos = S.insightBlocos;
  if (!Array.isArray(blocos) || !blocos.length) {
    return '<div class="grupo texto-insight">' + paragrafos(S.insight) + "</div>";
  }
  var html = blocos.map(function (b, i) {
    var titulo = b.titulo ? '<p class="ins-titulo">' + esc(b.titulo) + "</p>" : "";

    if (b.tipo === "lista") {
      return titulo + "<ol class=\"ins-lista\">" +
        (b.itens || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ol>";
    }
    if (b.tipo === "cruzamento") {
      return '<div class="ins-cruz">' + titulo +
        (b.notas ? '<p class="ins-cruz-notas">' + esc(b.notas) + "</p>" : "") +
        paragrafos(b.notas ? b.texto.replace(b.notas + ": ", "") : b.texto) +
        '<button class="ins-mini" data-ins-aprofundar="' + i + '">aprofundar este</button>' +
      "</div>";
    }
    return titulo + paragrafos(b.texto);
  }).join("");
  return '<div class="grupo texto-insight">' + html + "</div>";
}

function chipsFormato() {
  buscarFormatos(); // catalogo local ja serve; isto so atualiza se o servidor mudou
  var angulos = FORMATOS.angulos.map(function (a) {
    return '<button class="ins-chip' + (S.insightAngulo === a.id ? " on" : "") +
      '" data-ins-angulo="' + a.id + '" title="' + esc(a.descricao || "") + '">' + esc(a.rotulo) + "</button>";
  }).join("");
  var tamanhos = FORMATOS.tamanhos.map(function (t) {
    return '<button class="ins-chip' + (S.insightTamanho === t.id ? " on" : "") +
      '" data-ins-tamanho="' + t.id + '">' + esc(t.rotulo) + "</button>";
  }).join("");
  return '<div class="ins-formato">' +
    '<div class="ins-linha"><span class="ins-rot">ângulo</span>' + angulos + "</div>" +
    '<div class="ins-linha"><span class="ins-rot">tamanho</span>' + tamanhos + "</div>" +
  "</div>";
}

/* Liga os chips de formato. Serve pras duas telas que os mostram:
   - no modal do insight, trocar reformula na hora (aoTrocar = pedirInsight)
   - na tela de configuracao, trocar so guarda a escolha (aoTrocar = atualizar a dica)
   O estado vive em S, entao a escolha atravessa as duas. */
function ligarChipsFormato(corpo, aoTrocar) {
  var marcar = function (attr, valor) {
    corpo.querySelectorAll("[" + attr + "]").forEach(function (x) {
      x.classList.toggle("on", x.getAttribute(attr) === valor);
    });
  };
  corpo.querySelectorAll("[data-ins-angulo]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (S.insightAngulo === b.dataset.insAngulo) return;
      S.insightAngulo = b.dataset.insAngulo;
      marcar("data-ins-angulo", S.insightAngulo);
      if (aoTrocar) aoTrocar();
    });
  });
  corpo.querySelectorAll("[data-ins-tamanho]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (S.insightTamanho === b.dataset.insTamanho) return;
      S.insightTamanho = b.dataset.insTamanho;
      marcar("data-ins-tamanho", S.insightTamanho);
      if (aoTrocar) aoTrocar();
    });
  });
}

/* Frase que explica a combinacao escolhida, pra escolha nao ser as cegas. */
function descricaoDoFormato() {
  var a = FORMATOS.angulos.filter(function (x) { return x.id === S.insightAngulo; })[0];
  var t = FORMATOS.tamanhos.filter(function (x) { return x.id === S.insightTamanho; })[0];
  var partes = [];
  if (a && a.descricao) partes.push(a.descricao);
  if (t && t.descricao) partes.push(t.descricao.charAt(0).toLowerCase() + t.descricao.slice(1));
  if (S.insightTamanho === "curto") partes.push("responde em segundos");
  return partes.join(" · ");
}

/* Secao "Formato da resposta" da tela de configuracao.
   Com o automatico ligado os chips somem: quem escolhe e o app, e mostrar
   controle que nao manda em nada so confunde. Desligado, e o de sempre. */
function secaoFormatoIA() {
  var auto = S.insightAuto;
  return '<p class="grupo-titulo">Formato da resposta</p>' +
    '<label class="ins-auto"><span class="ins-auto-txt"><strong>Automático</strong>' +
      "<span>O app escolhe o ângulo e o tamanho, e confirma antes de gerar</span></span>" +
      '<input type="checkbox" id="iaAuto"' + (auto ? " checked" : "") + " /></label>" +
    (auto
      ? ""
      : chipsFormato() +
        '<p class="dica-compositor" id="iaFormatoDica" style="display:block;margin:-4px 2px 16px">' +
        esc(descricaoDoFormato()) + "</p>");
}

function ligarSecaoFormatoIA(corpo) {
  var cx = corpo.querySelector("#iaAuto");
  if (cx) cx.addEventListener("change", function () {
    lerFormIA();               // nao perder o que ja foi digitado no re-render
    definirAuto(cx.checked);
    telaInsightAvancado();
  });
  ligarChipsFormato(corpo, function () {
    var dica = corpo.querySelector("#iaFormatoDica");
    if (dica) dica.textContent = descricaoDoFormato();
  });
}

function htmlThread() {
  return (S.insightThread || []).map(function (t) {
    return '<div class="ins-turno">' +
      '<p class="ins-pedido">' + esc(t.pedido) + "</p>" +
      (t.carregando
        ? '<p class="ins-pensando">pensando…</p>'
        : '<div class="ins-resposta">' + paragrafos(t.resposta) + "</div>") +
    "</div>";
  }).join("");
}

/* Redesenha SO a thread, sem recriar o modal: um re-render inteiro jogaria o
   scroll pro topo bem na hora em que a pessoa quer ler a resposta nova. */
function pintarThread(rolar) {
  var caixa = $("#insThread");
  if (!caixa) return;
  caixa.innerHTML = htmlThread();
  if (rolar) {
    var ultimo = caixa.lastElementChild;
    if (ultimo && ultimo.scrollIntoView) ultimo.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function abrirInsight(titulo) {
  if (!S.insight) return;
  buscarFormatos();
  INS.titulo = titulo || INS.titulo || "Insight";

  // "aprofundar" existe na API, mas so faz sentido com um cruzamento como foco:
  // ele mora no botao de cada cruzamento, nao nesta fileira.
  var atalhos = FORMATOS.atalhos.filter(function (a) { return a.id !== "aprofundar"; }).map(function (a) {
    return '<button class="ins-chip" data-ins-atalho="' + a.id + '">' + esc(a.rotulo) + "</button>";
  }).join("");

  abrirSheet(INS.titulo,
    descreverFonte(S.insightFonte) +
    htmlDosBlocos() +
    '<p class="grupo-titulo">Reformular</p>' + chipsFormato() +
    '<p class="grupo-titulo">Continuar</p>' +
    '<div class="ins-linha ins-atalhos">' + atalhos + "</div>" +
    '<div class="campo-linha"><textarea id="insPergunta" class="campo" rows="2" ' +
      'placeholder="Ou pergunte outra coisa sobre este insight…"></textarea>' +
      '<button class="btn btn-suave btn-largo" id="insEnviar" style="margin-top:10px">Perguntar</button></div>' +
    '<div class="ins-thread" id="insThread">' + htmlThread() + "</div>" +
    blocoNotasInsight() +
    '<button class="btn btn-suave btn-largo" id="btnInsightRefazer">Gerar de novo</button>');

  var corpo = $("#sheetCorpo");

  ligarChipsFormato(corpo, function () { pedirInsight(); });
  corpo.querySelectorAll("[data-ins-atalho]").forEach(function (b) {
    b.addEventListener("click", function () {
      continuarInsight({ atalho: b.dataset.insAtalho, rotulo: b.textContent });
    });
  });
  corpo.querySelectorAll("[data-ins-aprofundar]").forEach(function (b) {
    b.addEventListener("click", function () {
      var bloco = (S.insightBlocos || [])[Number(b.dataset.insAprofundar)];
      if (!bloco) return;
      continuarInsight({
        atalho: "aprofundar",
        foco: bloco.texto,
        rotulo: "aprofundar: " + String(bloco.notas || bloco.texto).slice(0, 60),
      });
    });
  });

  var campo = $("#insPergunta");
  var enviar = function () {
    var t = (campo.value || "").trim();
    if (!t) return;
    campo.value = "";
    continuarInsight({ pedido: t, rotulo: t });
  };
  $("#insEnviar").addEventListener("click", enviar);
  campo.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") enviar();
  });

  var b = $("#btnInsightRefazer");
  if (b) b.addEventListener("click", function () { pedirInsight(); });
}
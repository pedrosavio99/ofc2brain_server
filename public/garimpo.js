/* Segundo cerebro - garimpo de ideias.
   Depende de app.js: usa $, esc, api, avisar, abrirSheet, fecharSheet,
   esqueletos, carregar, trocarAba, render e S. Carregar DEPOIS do app.js.

   Fluxo: voce cola um texto bruto -> POST /extrair devolve candidatas (sem
   salvar nada) -> voce marca, edita e confirma -> cada escolhida vai pelo
   POST /ideias normal, uma por vez.

   Por que uma por vez e nao um lote no servidor: cada nota custa 1 embedding
   + 1 busca vetorial + 1 chamada de LLM. Dez notas numa requisicao so estouram
   o maxDuration da Vercel e o limite por minuto da Groq. Em sequencia a barra
   de progresso e honesta, um item que falha nao derruba os outros, e cada nota
   nova ja enxerga as anteriores do mesmo lote na hora de criar as ligacoes. */

var GM = {
  texto: "",
  maximo: 12,
  candidatas: [],
  marcadas: {},
  salvando: false,
};

/* ============================================================
   Tela 1: o texto bruto
   ============================================================ */
function telaGarimpo() {
  var tetos = [6, 12, 20];
  abrirSheet("Garimpar ideias",
    '<p class="grupo-titulo">Cole o texto</p>' +
    '<div class="campo-linha">' +
      '<textarea class="campo gm-fonte" id="gmTexto" placeholder="Artigo, transcrição de reunião, despejo mental, anotação bagunçada…">' +
        esc(GM.texto) + "</textarea>" +
      '<div class="gm-medidor"><span id="gmConta">0 caracteres</span></div>' +
    "</div>" +
    '<p class="grupo-titulo">Quantas ideias no máximo</p>' +
    '<div class="sc-linha" style="margin-bottom:18px">' +
      tetos.map(function (t) {
        return '<button class="sc-chip gm-chip' + (GM.maximo === t ? " on" : "") + '" data-gm-max="' + t + '">até ' + t + "</button>";
      }).join("") +
    "</div>" +
    '<button class="btn btn-largo" id="gmGarimpar">Garimpar</button>' +
    '<p class="dica-compositor" style="display:block;text-align:center;margin-top:12px">' +
      "Nada é salvo agora. Você escolhe o que entra depois de ver a lista.</p>");

  var campo = $("#gmTexto");
  var atualizarConta = function () {
    var n = campo.value.length;
    var el = $("#gmConta");
    if (el) {
      el.textContent = n.toLocaleString("pt-BR") + (n === 1 ? " caractere" : " caracteres") +
        (n > 20000 ? " · só os primeiros 20.000 serão lidos" : "");
      el.classList.toggle("alerta", n > 20000);
    }
    var b = $("#gmGarimpar");
    if (b) b.disabled = campo.value.trim().length < 40;
  };
  campo.addEventListener("input", function () { GM.texto = campo.value; atualizarConta(); });
  atualizarConta();

  $("#sheetCorpo").querySelectorAll("[data-gm-max]").forEach(function (b) {
    b.addEventListener("click", function () {
      GM.maximo = Number(b.dataset.gmMax);
      GM.texto = campo.value;
      telaGarimpo();
    });
  });
  $("#gmGarimpar").addEventListener("click", function () {
    GM.texto = campo.value;
    garimpar();
  });
}

function garimpar() {
  var texto = (GM.texto || "").trim();
  if (texto.length < 40) { avisar("Cole um texto um pouco maior."); return; }

  abrirSheet("Garimpando…",
    '<p class="dica-compositor" style="display:block;text-align:center;margin-bottom:14px">' +
      "Lendo o texto e separando as ideias. Costuma levar alguns segundos.</p>" +
    esqueletos(4));

  api("/extrair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ texto: texto, maximo: GM.maximo }),
  }).then(function (r) {
    return r.json().then(function (d) {
      if (!r.ok) throw new Error(d.erro || "Não deu pra garimpar.");
      return d;
    });
  }).then(function (d) {
    GM.candidatas = d.candidatas || [];
    GM.marcadas = {};
    // Duplicata vem desmarcada: o padrao e nao repetir o que voce ja tem.
    GM.candidatas.forEach(function (c, i) { GM.marcadas[i] = !c.duplicata; });
    if (!GM.candidatas.length) {
      abrirSheet("Garimpar ideias",
        '<div class="vazio"><h3>Nada que valha a pena</h3>' +
        "<p>Não encontrei ideias autossuficientes nesse texto. Pode ser texto curto, muito genérico ou só transição.</p></div>" +
        '<button class="btn btn-suave btn-largo" id="gmVoltar">Voltar ao texto</button>');
      $("#gmVoltar").addEventListener("click", telaGarimpo);
      return;
    }
    telaCandidatas(d);
  }).catch(function (e) {
    avisar(e.message || "Não deu pra garimpar.");
    telaGarimpo();
  });
}

/* ============================================================
   Tela 2: escolher, editar e guardar
   ============================================================ */
function contarMarcadas() {
  return Object.keys(GM.marcadas).filter(function (k) { return GM.marcadas[k]; }).length;
}

function atualizarRodape() {
  var n = contarMarcadas();
  var b = $("#gmGuardar");
  if (!b) return;
  b.disabled = n === 0 || GM.salvando;
  b.textContent = n === 0 ? "Nenhuma marcada"
    : "Guardar " + n + (n === 1 ? " ideia" : " ideias");
}

function cardCandidata(c, i) {
  var marcada = !!GM.marcadas[i];
  var meta = [c.area || "sem área", c.tipo === "lembrete_evento" ? "evento" : c.tipo]
    .concat(c.data_evento ? [c.data_evento] : []).join(" · ");
  var tags = (c.tags || []).length
    ? '<div class="gm-tags">' + c.tags.map(function (t) {
        return '<span class="gm-tag">' + esc(t) + "</span>";
      }).join("") + "</div>"
    : "";

  var dup = c.duplicata
    ? '<div class="gm-dup"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>' +
      "<span>Você já tem isso: <strong>" + esc(c.duplicata.resumo) + "</strong> (" +
      Math.round(c.duplicata.score * 100) + "% parecida)</span></div>"
    : "";

  var trecho = c.trecho
    ? '<details class="gm-trecho"><summary>ver no texto original</summary><p>' +
      esc(c.trecho) + "</p></details>"
    : '<p class="gm-sem-trecho">sem trecho literal conferido</p>';

  return '<div class="gm-card' + (marcada ? " marcada" : "") + (c.duplicata ? " repetida" : "") +
      '" data-card="' + i + '">' +
    '<label class="gm-topo">' +
      '<input type="checkbox" data-gm-i="' + i + '"' + (marcada ? " checked" : "") + " />" +
      '<span class="gm-tit"><strong>' + esc(c.resumo) + "</strong>" +
      '<span class="gm-meta">' + esc(meta) + " · força " + c.forca + "/5</span></span>" +
    "</label>" +
    dup +
    '<textarea class="campo gm-texto" data-gm-txt="' + i + '" rows="3">' + esc(c.texto) + "</textarea>" +
    tags +
    trecho +
  "</div>";
}

function telaCandidatas(d) {
  var repetidas = GM.candidatas.filter(function (c) { return c.duplicata; }).length;
  var n = GM.candidatas.length;

  var aviso = d && d.truncado
    ? '<div class="gm-aviso">O texto passou de ' + d.limite.toLocaleString("pt-BR") +
      " caracteres e só o começo foi lido. Garimpe o resto em outra rodada.</div>"
    : "";

  abrirSheet("Garimpar ideias",
    aviso +
    '<p class="grupo-titulo">' + n + (n === 1 ? " ideia encontrada" : " ideias encontradas") +
      (repetidas ? " · " + repetidas + " já no cérebro" : "") + "</p>" +
    '<div class="sc-linha gm-acoes">' +
      '<button class="sc-chip" data-gm-sel="todas">Marcar todas</button>' +
      '<button class="sc-chip" data-gm-sel="nenhuma">Desmarcar</button>' +
      (repetidas ? '<button class="sc-chip" data-gm-sel="ineditas">Só as inéditas</button>' : "") +
    "</div>" +
    '<div class="gm-lista">' + GM.candidatas.map(cardCandidata).join("") + "</div>" +
    '<button class="btn btn-largo" id="gmGuardar" style="margin-top:6px">Guardar</button>' +
    '<button class="btn btn-suave btn-largo" id="gmVoltar" style="margin-top:10px">Voltar ao texto</button>' +
    '<p class="dica-compositor" style="display:block;text-align:center;margin-top:12px">' +
      "Pode editar o texto de cada nota antes de guardar.</p>");

  var corpo = $("#sheetCorpo");

  corpo.querySelectorAll("[data-gm-i]").forEach(function (cx) {
    cx.addEventListener("change", function () {
      var i = cx.dataset.gmI;
      GM.marcadas[i] = cx.checked;
      var card = corpo.querySelector('[data-card="' + i + '"]');
      if (card) card.classList.toggle("marcada", cx.checked);
      atualizarRodape();
    });
  });

  // Edicao inline: escreve direto no estado, sem redesenhar (perderia o foco).
  corpo.querySelectorAll("[data-gm-txt]").forEach(function (ta) {
    var crescer = function () {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 260) + "px";
    };
    ta.addEventListener("input", function () {
      GM.candidatas[ta.dataset.gmTxt].texto = ta.value;
      crescer();
    });
    crescer();
  });

  corpo.querySelectorAll("[data-gm-sel]").forEach(function (b) {
    b.addEventListener("click", function () {
      var modo = b.dataset.gmSel;
      GM.candidatas.forEach(function (c, i) {
        GM.marcadas[i] = modo === "todas" ? true
          : modo === "nenhuma" ? false
          : !c.duplicata;
      });
      telaCandidatas(d);
    });
  });

  $("#gmVoltar").addEventListener("click", telaGarimpo);
  $("#gmGuardar").addEventListener("click", function () { guardarEscolhidas(d); });
  atualizarRodape();
}

/* ============================================================
   Tela 3: gravacao sequencial, com progresso
   ============================================================ */
function corpoProgresso(feito, total, falhas) {
  var pct = total > 0 ? Math.round((feito / total) * 100) : 0;
  return '<div class="grupo" style="padding:16px">' +
      '<p class="relink-fase">Guardando e ligando às notas que você já tem</p>' +
      '<div class="barra-prog"><div class="barra-prog-cheia" style="width:' + pct + '%"></div></div>' +
      '<div class="relink-linha"><span>' + feito + " de " + total + " notas</span><span>" + pct + "%</span></div>" +
      (falhas ? '<p class="relink-falhas">' + falhas + " não entrou(ram); vou listar no fim.</p>" : "") +
    "</div>" +
    '<p class="dica-compositor" style="display:block;text-align:center">' +
      "Uma de cada vez, de propósito: assim cada nota já nasce ligada às anteriores.</p>";
}

function guardarEscolhidas(d) {
  var escolhidas = GM.candidatas.filter(function (c, i) { return GM.marcadas[i]; });
  if (!escolhidas.length) return;

  GM.salvando = true;
  var total = escolhidas.length, feito = 0, criadas = [], falhas = [];
  abrirSheet("Guardando ideias", corpoProgresso(0, total, 0));

  var pintar = function () {
    if ($("#sheetTitulo").textContent.indexOf("Guardando") !== 0) return;
    $("#sheetCorpo").innerHTML = corpoProgresso(feito, total, falhas.length);
  };

  var proxima = function (i) {
    if (i >= escolhidas.length) return Promise.resolve();
    var c = escolhidas[i];
    return api("/ideias", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: c.texto }),
    }).then(function (r) {
      return r.json().then(function (nova) {
        if (!r.ok) throw new Error(nova.erro || "recusada pelo servidor");
        criadas.push(nova.id);
      });
    }).catch(function (e) {
      falhas.push({ resumo: c.resumo, motivo: e.message });
    }).then(function () {
      feito++;
      pintar();
      return proxima(i + 1);
    });
  };

  proxima(0).then(function () {
    GM.salvando = false;
    S.recentes = criadas.slice(0, 5).concat(S.recentes).slice(0, 5);
    trocarAba("foco");
    return carregar();
  }).then(function () {
    if (!falhas.length) {
      fecharSheet();
      avisar(criadas.length + (criadas.length === 1 ? " nota guardada." : " notas guardadas."));
      return;
    }
    abrirSheet("Guardadas com ressalvas",
      '<p class="grupo-titulo">' + criadas.length + " entraram · " + falhas.length + " falharam</p>" +
      '<div class="grupo">' + falhas.map(function (f) {
        return '<div class="item"><div class="item-txt"><strong>' + esc(f.resumo) +
          "</strong><span>" + esc(f.motivo) + "</span></div></div>";
      }).join("") + "</div>" +
      '<p class="dica-compositor" style="display:block;text-align:center">' +
        "Costuma ser limite de requisições do provedor. Dá pra tentar de novo em um minuto.</p>");
  });
}
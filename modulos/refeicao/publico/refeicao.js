/* Modulo REFEICAO - tela.
 *
 * Fluxo com o menor numero de cliques:
 *   1. Escreve e clica Calcular -> POST /analisar (separa e mede de uma vez)
 *   2. Confere e clica Aceitar  -> POST /refeicoes (o servidor recalcula e grava)
 *   Editar so aparece se voce quiser mexer em tipo, nome ou gramas.
 *
 * A conta do item (por100 x gramas / 100) existe aqui so pra tela reagir na
 * hora que voce muda a porcao. Quem vale e a do servidor, refeita no salvar.
 */
(function () {
  "use strict";

  var API = "/refeicao/api";
  // mesmos fatores do servidor (nutricao.mjs): P ~350 g, M ~500 g, G ~700 g
  var TAMANHOS = { pequena: { r: "P", nome: "Pequena", f: 0.7 }, media: { r: "M", nome: "Média", f: 1 },
    grande: { r: "G", nome: "Grande", f: 1.4 } };

  var S = {
    hoje: null,          // data do servidor (fuso certo), nao do aparelho
    dia: null,           // dia sendo visto
    tipos: [],
    rascunho: null,      // { editando, editandoId?, data, refeicoes: [...] }
    ocupado: false,
  };

  /* ------------------------------------------------------------ utilidades */

  var $ = function (s) { return document.querySelector(s); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var num = function (n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); };
  var g1 = function (n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("pt-BR"); };

  var timerToast;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("visivel");
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { t.classList.remove("visivel"); }, 2600);
  }

  function aviso(msg) {
    var a = $("#aviso");
    a.textContent = msg || "";
    a.hidden = !msg;
  }

  function rotuloTipo(id) {
    for (var i = 0; i < S.tipos.length; i++) if (S.tipos[i].id === id) return S.tipos[i].rotulo;
    return id;
  }

  function opcoesTipo(atual) {
    return S.tipos.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === atual ? " selected" : "") + ">" + esc(t.rotulo) + "</option>";
    }).join("");
  }

  function diaMais(data, n) {
    var t = new Date(data + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }

  function rotuloDia(data) {
    if (data === S.hoje) return "Hoje";
    if (data === diaMais(S.hoje, -1)) return "Ontem";
    var d = new Date(data + "T12:00:00Z");
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  }

  /* ------------------------------------------------------------ API
     O PIN e do 2brain: o /pin.js (carregado antes deste arquivo) envolve o
     fetch, poe o header x-pin e abre o modal unico do app no 401. Aqui so
     se chama fetch e se traduz erro. */

  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    return fetch(API + caminho, {
      method: opcoes.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (dados) {
        if (!r.ok) {
          var e = new Error(dados.erro || "Erro " + r.status);
          e.dica = dados.dica || "";
          e.status = r.status;
          throw e;
        }
        return dados;
      });
    });
  }

  function falhou(e) {
    toast(e.message + (e.dica && e.dica !== "pin" ? " " + e.dica : ""));
  }

  /* ------------------------------------------------------------ folha
     A .sheet do app, mesmo desenho do treino: abrir poe .aberto na folha e no
     veu; fechar espera a transicao antes de esvaziar o corpo. */

  var folha = $("#folha"), veu = $("#veu"), folhaTitulo = $("#folhaTitulo"), folhaCorpo = $("#folhaCorpo");

  function abrirFolha(titulo, html) {
    folhaTitulo.textContent = titulo;
    folhaCorpo.innerHTML = html;
    folha.scrollTop = 0;
    folha.classList.add("aberto");
    veu.classList.add("aberto");
  }
  function fecharFolha() {
    folha.classList.remove("aberto");
    veu.classList.remove("aberto");
    setTimeout(function () { if (!folha.classList.contains("aberto")) folhaCorpo.innerHTML = ""; }, 380);
  }
  $("#btnFecharFolha").addEventListener("click", fecharFolha);
  veu.addEventListener("click", fecharFolha);

  /* O consumo de um dia do ciclo, sem sair do dia aberto: a barra do grafico
     mostra a folha, e "abrir esse dia" troca a tela pra ele. */
  function folhaDoDia(data) {
    abrirFolha(rotuloDia(data),
      '<div class="rf-esq-kcal"></div>' +
      '<p class="rf-dia-macros"><span class="rf-esq-txt medio"></span></p>' +
      '<div class="rf-dia-lista">' + [1, 2, 3].map(function () {
        return '<div class="rf-dia-linha"><span class="rf-esq-txt medio"></span>' +
          '<span class="rf-esq-txt kcal"></span></div>';
      }).join("") + "</div>");
    api("/dia?data=" + data).then(function (r) {
      var t = r.totais || {};
      var linhas = (r.refeicoes || []).map(function (x) {
        return '<div class="rf-dia-linha"><div><b>' + esc(x.rotulo || x.tipo) + "</b>" +
          "<span>" + x.itens.length + (x.itens.length === 1 ? " item" : " itens") + "</span></div>" +
          "<em>" + num(x.totais.kcal) + " kcal</em></div>";
      }).join("");
      folhaCorpo.innerHTML =
        '<div class="rf-dia-kcal"><strong>' + num(t.kcal || 0) + "</strong><span>kcal no dia</span></div>" +
        '<p class="rf-dia-macros">P ' + g1(t.proteina || 0) + " g · C " + g1(t.carbo || 0) + " g · G " + g1(t.gordura || 0) + " g</p>" +
        (linhas ? '<div class="rf-dia-lista">' + linhas + "</div>"
          : '<div class="vazio"><p>Nada registrado neste dia.</p></div>') +
        '<button type="button" class="btn btn-suave btn-largo" id="btnAbrirDia">Abrir esse dia</button>';
      $("#btnAbrirDia").addEventListener("click", function () {
        S.dia = data; fecharFolha(); carregarDia();
      });
    }).catch(function (e) {
      folhaCorpo.innerHTML = '<div class="vazio"><p>' + esc(e.message) + "</p></div>";
    });
  }

  /* ------------------------------------------------------------ contas (espelho do servidor) */

  function calcularItem(it) {
    var g = Math.min(Math.max(Math.round(Number(it.gramas) || 0), 1), 3000);
    var p = it.por100 || {};
    var f = g / 100;
    it.gramas = g;
    it.kcal = Math.round((p.kcal || 0) * f);
    it.proteina = Math.round((p.proteina || 0) * f * 10) / 10;
    it.carbo = Math.round((p.carbo || 0) * f * 10) / 10;
    it.gordura = Math.round((p.gordura || 0) * f * 10) / 10;
    return it;
  }

  function somar(lista) {
    var t = { kcal: 0, proteina: 0, carbo: 0, gordura: 0 };
    (lista || []).forEach(function (x) {
      t.kcal += x.kcal || 0; t.proteina += x.proteina || 0;
      t.carbo += x.carbo || 0; t.gordura += x.gordura || 0;
    });
    return t;
  }

  /* Troca o tamanho do prato: so os gramas que a IA SUPOS mudam; o que voce
     escreveu ("2 ovos", "200 g") fica como esta. Reversivel: M -> G -> M volta. */
  function aplicarTamanho(ref, novo) {
    var atual = TAMANHOS[ref.tamanho] ? ref.tamanho : "media";
    if (!TAMANHOS[novo] || novo === atual) return;
    var fator = TAMANHOS[novo].f / TAMANHOS[atual].f;
    // o tamanho que a IA leu do texto: e nele que a medida caseira vale
    if (!ref.tamanho_ia) ref.tamanho_ia = atual;
    ref.itens.forEach(function (it) {
      if (it.porcao_fonte === "texto") return;
      it.gramas = Math.round(it.gramas * fator);
      calcularItem(it);
      // "3 unidades" com 75 g seria mentira: fora do tamanho da IA a medida some
      if (it.medida_ia === undefined) it.medida_ia = it.medida || "";
      it.medida = novo === ref.tamanho_ia ? it.medida_ia : "";
    });
    ref.tamanho = novo;
  }

  function chipsTamanho(ref) {
    var atual = TAMANHOS[ref.tamanho] ? ref.tamanho : "media";
    return '<span class="tamanhos" role="group" aria-label="Tamanho do prato">' +
      Object.keys(TAMANHOS).map(function (k) {
        return '<button type="button" data-acao="tamanho" data-tamanho="' + k + '" title="' + TAMANHOS[k].nome +
          '" aria-pressed="' + (k === atual) + '" class="' + (k === atual ? "ativo" : "") + '">' + TAMANHOS[k].r + "</button>";
      }).join("") + "</span>";
  }

  /* ------------------------------------------------------------ resumo do dia */

  function desenharResumo(totais) {
    $("#totKcal").textContent = num(totais.kcal);
    // porcentagem de kcal que vem de cada macro, que e o que diz o "tipo" do dia
    var kP = (totais.proteina || 0) * 4, kC = (totais.carbo || 0) * 4, kG = (totais.gordura || 0) * 9;
    var soma = kP + kC + kG || 1;
    var linhas = [
      ["Proteína", totais.proteina, kP, "var(--proteina)"],
      ["Carbo", totais.carbo, kC, "var(--carbo)"],
      ["Gordura", totais.gordura, kG, "var(--gordura)"],
    ];
    $("#totMacros").innerHTML = linhas.map(function (l) {
      var pct = Math.round((l[2] / soma) * 100);
      return '<div class="macro"><div class="macro-topo"><span>' + l[0] + "</span><b>" + g1(l[1]) + " g</b></div>" +
        '<div class="macro-barra"><i style="width:' + pct + "%;background:" + l[3] + '"></i></div></div>';
    }).join("");
  }

  function desenharSemana(dias) {
    var max = Math.max.apply(null, dias.map(function (d) { return d.totais.kcal; }).concat([1]));
    $("#semana").innerHTML = dias.map(function (d) {
      var h = Math.round((d.totais.kcal / max) * 100);
      var letra = new Date(d.data + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "narrow", timeZone: "UTC" });
      return '<button type="button" data-dia="' + d.data + '" class="' + (d.data === S.dia ? "atual" : "") +
        '" title="' + esc(rotuloDia(d.data)) + ": " + num(d.totais.kcal) + ' kcal">' +
        '<i style="height:' + h + '%"></i><span>' + letra + "</span></button>";
    }).join("");
  }

  /* ------------------------------------------------------------ dia salvo */

  /* Esqueleto do dia: resumo, faixa de 14 dias e os cartoes. Usa o .esqueleto
     do app (mesma pulsacao do treino), so com a forma do que vem aqui.
     So aparece quando o dia MUDA ou na primeira carga: depois de salvar ou
     excluir, piscar a tela inteira seria pior que esperar. */
  function esqueletoDia() {
    $("#totKcal").innerHTML = '<span class="rf-esq-kcal"></span>';
    $("#totMacros").innerHTML = [1, 2, 3].map(function () {
      return '<div class="macro"><div class="macro-topo"><span class="rf-esq-txt"></span></div>' +
        '<div class="macro-barra"><i class="rf-esq-barra" style="width:60%"></i></div></div>';
    }).join("");
    $("#semana").innerHTML = [40, 70, 25, 55, 80, 35, 60, 45, 75, 30, 65, 50, 85, 40].map(function (h) {
      return '<button type="button" disabled><i class="rf-esq-barra" style="height:' + h + '%"></i>' +
        '<span class="rf-esq-txt curto"></span></button>';
    }).join("");
    $("#listaDia").innerHTML = [1, 2].map(function () {
      return '<article class="card salva rf-esq-card">' +
        '<header class="salva-topo"><div class="salva-ident">' +
          '<span class="rf-esq-txt medio"></span><span class="rf-esq-txt curto"></span>' +
        '</div><span class="rf-esq-txt kcal"></span></header>' +
        '<span class="rf-esq-txt longo"></span></article>';
    }).join("");
  }

  function carregarDia(comEsqueleto) {
    $("#diaRotulo").textContent = rotuloDia(S.dia);
    $("#tituloDia").textContent = rotuloDia(S.dia);
    $("#diaDepois").disabled = S.dia >= S.hoje;
    if (comEsqueleto) esqueletoDia();
    return Promise.all([
      api("/dia?data=" + S.dia),
      api("/dias?ate=" + S.dia + "&quantos=14"),
    ]).then(function (r) {
      desenharResumo(r[0].totais);
      desenharSemana(r[1].dias);
      desenharDia(r[0].refeicoes);
    }).catch(falhou);
  }

  /* Card compacto: cabecalho com kcal, macros da refeicao e os itens dentro de
     um <details> fechado. Antes cada item abria duas linhas e o dia virava um
     rolo de cartoes colados. */
  function desenharDia(lista) {
    var alvo = $("#listaDia");
    if (!lista.length) {
      alvo.innerHTML = '<div class="card vazio">Nada registrado ' + (S.dia === S.hoje ? "hoje" : "neste dia") + ".</div>";
      return;
    }
    alvo.innerHTML = lista.map(function (r) {
      var t = r.totais || {};
      var nomes = r.itens.map(function (it) { return it.nome; });
      var resumo = nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? "…" : "");
      var selo = TAMANHOS[r.tamanho] && r.tamanho !== "media"
        ? ' <span class="selo">' + TAMANHOS[r.tamanho].nome + "</span>" : "";

      return '<article class="card salva" data-id="' + r.id + '">' +
        '<header class="salva-topo">' +
          '<div class="salva-ident">' +
            "<h3>" + esc(r.rotulo || rotuloTipo(r.tipo)) + selo + "</h3>" +
            '<p class="salva-macros">P ' + g1(t.proteina) + " · C " + g1(t.carbo) + " · G " + g1(t.gordura) + "</p>" +
          "</div>" +
          '<span class="salva-kcal">' + num(t.kcal) + "<small>kcal</small></span>" +
        "</header>" +
        '<details class="salva-itens">' +
          "<summary>" + r.itens.length + (r.itens.length === 1 ? " item" : " itens") +
            (resumo ? ' <span class="salva-resumo">' + esc(resumo) + "</span>" : "") + "</summary>" +
          '<div class="itens">' + r.itens.map(function (it) {
            return '<div class="item">' +
              '<span class="item-nome-txt">' + esc(it.nome) + "</span>" +
              '<span class="item-kcal">' + num(it.kcal) + "</span>" +
              '<span class="item-det">' + num(it.gramas) + " g · P " + g1(it.proteina) +
              " · C " + g1(it.carbo) + " · G " + g1(it.gordura) + "</span>" +
            "</div>";
          }).join("") + "</div>" +
        "</details>" +
        '<div class="salva-acoes">' +
          '<button type="button" class="botao-link" data-acao="editar">Corrigir porções</button>' +
          '<button type="button" class="botao-link perigo" data-acao="excluir">Excluir</button>' +
        "</div>" +
      "</article>";
    }).join("");
    alvo._lista = lista;
  }

  /* Corrigir uma refeicao ja salva: reabre editando, e o Aceitar vira PUT. */
  function editarSalva(id) {
    var r = ($("#listaDia")._lista || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    S.rascunho = { editando: true, editandoId: id, data: r.data,
      refeicoes: [{ tipo: r.tipo, tamanho: r.tamanho, texto: r.texto, itens: JSON.parse(JSON.stringify(r.itens)), erro: "" }] };
    desenharRascunho();
    $("#rascunho").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function excluirSalva(id) {
    if (!confirm("Excluir esta refeição?")) return;
    api("/refeicoes/" + id, { method: "DELETE" })
      .then(function () { toast("Refeição excluída."); return carregarDia(); })
      .catch(falhou);
  }

  /* ------------------------------------------------------------ calcular */

  /* O Calcular passa por duas IAs (separar e medir) e demora alguns segundos.
     Antes so o botao girava e a area do rascunho ficava vazia, entao parecia
     que nada tinha acontecido. */
  function esqueletoRascunho(quantos) {
    var alvo = $("#rascunho");
    alvo.hidden = false;
    alvo.innerHTML = '<p class="rf-esq-legenda">Separando e medindo sua refeição…</p>' +
      Array.apply(null, Array(quantos || 1)).map(function () {
        return '<div class="card bloco rf-esq-card">' +
          '<div class="salva-topo"><span class="rf-esq-txt medio"></span><span class="rf-esq-txt kcal"></span></div>' +
          [1, 2, 3].map(function () {
            return '<div class="rf-esq-item"><span class="rf-esq-txt longo"></span>' +
              '<span class="rf-esq-txt curto"></span></div>';
          }).join("") + "</div>";
      }).join("");
  }

  function analisar() {
    var texto = $("#texto").value.trim();
    if (!texto) { $("#texto").focus(); return; }
    ocupar(true, "#btnAnalisar", "Calculando…");
    // uma caixa por "almocei/jantei" que der pra ver no texto, no minimo uma
    esqueletoRascunho(Math.min((texto.match(/almoc|jant|caf[eé]|lanch|ceia/gi) || []).length || 1, 3));
    api("/analisar", { method: "POST", body: { texto: texto } })
      .then(function (r) {
        S.rascunho = { editando: false, data: S.dia,
          refeicoes: r.refeicoes.map(function (x) {
            return { tipo: x.tipo, tamanho: x.tamanho, texto: x.texto, itens: x.itens || [],
              erro: x.erro || "", fonte: x.fonte || "", modelo: x.modelo || "", avisos: x.avisos || [] };
          }) };
        desenharRascunho();
        // separacao caiu na regra: diz por que, senao parece que a IA funcionou
        if (r.separacao && r.separacao.erro) aviso("Separei pelas palavras do texto. " + r.separacao.erro);
      })
      .catch(function (e) {
        // erro na analise: tirar o esqueleto, senao ele fica pulsando pra sempre
        $("#rascunho").hidden = true;
        $("#rascunho").innerHTML = "";
        falhou(e);
      })
      .then(function () { ocupar(false, "#btnAnalisar", "Calcular"); });
  }

  /* ------------------------------------------------------------ rascunho */

  function desenharRascunho() {
    var R = S.rascunho;
    var alvo = $("#rascunho");
    if (!R) { alvo.hidden = true; alvo.innerHTML = ""; $("#cardEscrever").hidden = false; return; }
    alvo.hidden = false;
    $("#cardEscrever").hidden = true;

    var total = somar(R.refeicoes.map(function (r) { return somar(r.itens); }));
    var cabeca = '<div class="rascunho-topo"><h2>' + (R.editandoId ? "Corrigir refeição" : "Confira") +
      '</h2><span class="kcal"><b>' + num(total.kcal) + "</b> kcal</span></div>" +
      (R.editando ? '<p class="nota" style="margin:0 4px">Mude tipo, nome ou gramas. A conta refaz na hora.</p>' : "");

    var blocos = R.refeicoes.map(function (r, i) {
      return R.editando ? blocoMedido(r, i) : blocoLeitura(r, i);
    }).join("");

    var rodape = '<div class="rodape-rascunho">' +
      (R.editando && !R.editandoId ? '<label>Dia <input type="date" id="dataSalvar" value="' + (R.data || S.dia) + '" max="' + S.hoje + '" /></label>' : "") +
      '<button type="button" class="botao" data-acao="cancelar">Cancelar</button>' +
      '<span class="espaco"></span>' +
      (R.editando ? "" : '<button type="button" class="botao" data-acao="editar">Editar</button>') +
      '<button type="button" class="botao primario" data-acao="salvar" id="btnSalvar">Aceitar</button></div>';

    alvo.innerHTML = '<div class="rascunho">' + cabeca + blocos + rodape + "</div>";
  }

  /* Quem mediu esta refeicao. So aparece quando NAO foi a IA principal: aqui o
     numero e caloria, entao a origem importa mais que em outros lugares. */
  function avisoOrigem(r) {
    if (r.erro || r.fonte !== "groq") return "";
    return '<p class="bloco-aviso">Medido pelo modelo reserva' +
      (r.modelo ? " (" + esc(r.modelo) + ")" : "") + ", porque a IA principal não respondeu" +
      (r.avisos && r.avisos.length ? ": " + esc(r.avisos.slice(0, 2).join("; ")) : "") +
      ". Confira as porções.</p>";
  }

  /* Leitura: o que a IA mediu, pronto pra aceitar. Falha mostra o MOTIVO
     vindo do servidor e deixa tentar de novo so esta refeicao. */
  function blocoLeitura(r, i) {
    var t = somar(r.itens);
    var corpo = r.erro
      ? '<p class="bloco-erro">' + esc(r.erro) + "</p>" +
        '<div class="bloco-acoes"><button type="button" class="botao-link" data-acao="remedir">Tentar de novo</button>' +
        '<button type="button" class="botao-link perigo" data-acao="remover">Descartar</button></div>'
      : '<div class="itens">' + r.itens.map(function (it) {
          var selo = it.conferir ? ' <span class="selo conferir">conferir</span>'
            : it.porcao_fonte === "texto" ? ' <span class="selo texto">sua porção</span>'
            : ' <span class="selo">estimada</span>';
          return '<div class="item"><div>' + esc(it.nome) + "</div>" +
            '<div class="item-kcal">' + num(it.kcal) + "</div>" +
            '<div class="item-linha">' + num(it.gramas) + " g" + (it.medida ? " · " + esc(it.medida) : "") + selo + "</div>" +
            (it.observacao ? '<div class="item-obs">' + esc(it.observacao) + "</div>" : "") + "</div>";
        }).join("") + "</div>";
    return '<div class="card bloco salva" data-i="' + i + '">' +
      '<div class="bloco-topo"><h3>' + esc(rotuloTipo(r.tipo)) + "</h3>" +
        (r.itens.length ? chipsTamanho(r) : "") +
        '<span class="kcal">' + num(t.kcal) + " kcal</span></div>" + avisoOrigem(r) + corpo + "</div>";
  }

  function blocoMedido(r, i) {
    var t = somar(r.itens);
    var corpo = r.erro
      ? '<p class="bloco-erro">' + esc(r.erro) + "</p>" +
        '<div class="bloco-acoes"><button type="button" class="botao-link" data-acao="remedir">Tentar de novo</button>' +
        '<button type="button" class="botao-link perigo" data-acao="remover">Descartar esta</button></div>'
      : '<div class="itens">' + r.itens.map(function (it, j) { return linhaItem(it, j); }).join("") + "</div>";
    return '<div class="card bloco" data-i="' + i + '">' +
      '<div class="bloco-topo"><select data-campo="tipo">' + opcoesTipo(r.tipo) + "</select>" +
        (r.itens.length ? chipsTamanho(r) : "") +
        '<span class="kcal">' + num(t.kcal) + " kcal</span></div>" +
      (r.texto ? '<p class="salva-texto">“' + esc(r.texto) + "”</p>" : "") +
      avisoOrigem(r) + corpo + "</div>";
  }

  function linhaItem(it, j) {
    var selo = it.conferir
      ? '<span class="selo conferir" title="Confira: estimativa com pouca certeza">conferir</span>'
      : it.porcao_fonte === "texto"
        ? '<span class="selo texto" title="Quantidade que você escreveu">sua porção</span>'
        : '<span class="selo" title="Você não disse a quantidade; é uma porção típica">porção estimada</span>';
    return '<div class="item" data-j="' + j + '">' +
      '<div class="item-nome"><input type="text" data-campo="nome" value="' + esc(it.nome) + '" aria-label="Alimento" /></div>' +
      '<div class="item-kcal" data-kcal>' + num(it.kcal) + " kcal</div>" +
      '<div class="item-linha"><input type="number" min="1" max="3000" step="1" data-campo="gramas" value="' + it.gramas +
        '" aria-label="Gramas" /> g' + (it.medida ? " · " + esc(it.medida) : "") + " " + selo +
        '<button type="button" class="remover" data-acao="tirar" aria-label="Tirar item">×</button></div>' +
      (it.observacao ? '<div class="item-obs">' + esc(it.observacao) + "</div>" : "") +
      "</div>";
  }

  /* ------------------------------------------------------------ tentar de novo */

  /* Tentar de novo uma refeicao que falhou na medicao. */
  function remedir(i) {
    var R = S.rascunho;
    var ref = R.refeicoes[i];
    api("/medir", { method: "POST", body: { refeicoes: [{ tipo: ref.tipo, texto: ref.texto }] } })
      .then(function (r) {
        var m = r.refeicoes[0];
        R.refeicoes[i] = { tipo: m.tipo, tamanho: m.tamanho, texto: m.texto, itens: m.itens || [],
          erro: m.erro || "", fonte: m.fonte || "", modelo: m.modelo || "", avisos: m.avisos || [] };
        desenharRascunho();
      })
      .catch(falhou);
  }

  /* ------------------------------------------------------------ aceitar */

  function salvar() {
    var R = S.rascunho;
    var validas = R.refeicoes.filter(function (r) { return !r.erro && r.itens.length; });
    if (!validas.length) { toast("Nada pra salvar ainda."); return; }
    var pendentes = R.refeicoes.length - validas.length;
    if (pendentes && !confirm(pendentes + " refeição(ões) sem medição ficarão de fora. Salvar mesmo assim?")) return;

    var envio = validas.map(function (r) { return { tipo: r.tipo, tamanho: r.tamanho, texto: r.texto, itens: r.itens }; });
    var pedido = R.editandoId
      ? api("/refeicoes/" + R.editandoId, { method: "PUT", body: envio[0] })
      : api("/refeicoes", { method: "POST", body: { data: ($("#dataSalvar") || {}).value || S.dia, refeicoes: envio } });

    ocupar(true, "#btnSalvar", "Salvando…");
    pedido
      .then(function (r) {
        toast(R.editandoId ? "Refeição corrigida." : "Salvo.");
        if (r.data && r.data !== S.dia) S.dia = r.data;
        S.rascunho = null;
        $("#texto").value = "";
        contar();
        desenharRascunho();
        return carregarDia();
      })
      .catch(falhou)
      .then(function () { ocupar(false, "#btnSalvar", "Aceitar"); });
  }

  /* ------------------------------------------------------------ eventos */

  function ocupar(sim, seletor, texto) {
    S.ocupado = sim;
    var b = $(seletor);
    if (!b) return;
    b.disabled = sim;
    b.innerHTML = sim ? '<span class="girando"></span>' + esc(texto) : esc(texto);
  }

  function contar() {
    $("#contador").textContent = $("#texto").value.length + "/2000";
  }

  $("#texto").addEventListener("input", contar);
  $("#texto").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) analisar();
  });
  $("#btnAnalisar").addEventListener("click", analisar);

  $("#diaAntes").addEventListener("click", function () {
    // a janela do ciclo: mais velho que isso ja virou resumo, nao ha dia pra abrir
    if (S.dia <= diaMais(S.hoje, -13)) return;
    S.dia = diaMais(S.dia, -1); carregarDia(true);
  });
  $("#diaDepois").addEventListener("click", function () {
    if (S.dia < S.hoje) { S.dia = diaMais(S.dia, 1); carregarDia(true); }
  });
  $("#diaRotulo").addEventListener("click", function () { S.dia = S.hoje; carregarDia(true); });
  $("#semana").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-dia]");
    if (b) folhaDoDia(b.getAttribute("data-dia"));
  });

  // a barra ganha o titulo quando a pagina rola, como no resto do app
  var rolouBarra = false;
  addEventListener("scroll", function () {
    var agora = scrollY > 24;
    if (agora === rolouBarra) return;
    rolouBarra = agora;
    $("#barra").classList.toggle("rolou", agora);
  }, { passive: true });

  $("#listaDia").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]");
    if (!b) return;
    var id = b.closest("[data-id]").getAttribute("data-id");
    if (b.getAttribute("data-acao") === "editar") editarSalva(id);
    if (b.getAttribute("data-acao") === "excluir") excluirSalva(id);
  });

  var alvoR = $("#rascunho");

  alvoR.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]");
    if (!b || S.ocupado) return;
    var R = S.rascunho;
    var acao = b.getAttribute("data-acao");
    var bloco = b.closest("[data-i]");
    var i = bloco ? Number(bloco.getAttribute("data-i")) : -1;

    if (acao === "cancelar") {
      if (R.editandoId || confirm("Descartar este rascunho?")) { S.rascunho = null; desenharRascunho(); }
      return;
    }
    if (acao === "remover") {
      R.refeicoes.splice(i, 1);
      if (!R.refeicoes.length) S.rascunho = null;
      desenharRascunho();
      return;
    }
    if (acao === "remedir") { b.textContent = "Calculando…"; remedir(i); return; }
    if (acao === "editar") { R.editando = true; desenharRascunho(); return; }
    if (acao === "tamanho") { aplicarTamanho(R.refeicoes[i], b.getAttribute("data-tamanho")); desenharRascunho(); return; }
    if (acao === "salvar") { salvar(); return; }
    if (acao === "tirar") {
      var j = Number(b.closest("[data-j]").getAttribute("data-j"));
      R.refeicoes[i].itens.splice(j, 1);
      if (!R.refeicoes[i].itens.length) R.refeicoes[i].erro = "Sem itens. Descarte esta refeição.";
      desenharRascunho();
    }
  });

  /* Edicao nos campos: atualiza o estado sem redesenhar tudo (senao o cursor
     pula no meio da digitacao). So a kcal do item e do bloco sao refeitas. */
  alvoR.addEventListener("input", function (e) {
    var campo = e.target.getAttribute("data-campo");
    if (!campo) return;
    var R = S.rascunho;
    var i = Number(e.target.closest("[data-i]").getAttribute("data-i"));
    var ref = R.refeicoes[i];

    if (campo === "texto") { ref.texto = e.target.value; return; }
    if (campo === "tipo") { ref.tipo = e.target.value; return; }

    var linha = e.target.closest("[data-j]");
    var it = ref.itens[Number(linha.getAttribute("data-j"))];
    if (campo === "nome") { it.nome = e.target.value; return; }
    if (campo === "gramas") {
      if (!e.target.value) return; // campo vazio no meio da digitacao
      it.gramas = e.target.value;
      calcularItem(it);
      // porcao que voce digitou deixa de ser "estimada"
      it.porcao_fonte = "texto";
      linha.querySelector("[data-kcal]").textContent = num(it.kcal) + " kcal";
      e.target.closest("[data-i]").querySelector(".bloco-topo .kcal").textContent = num(somar(ref.itens).kcal) + " kcal";
      var tot = somar(R.refeicoes.map(function (r) { return somar(r.itens); }));
      var topo = alvoR.querySelector(".rascunho-topo .kcal b");
      if (topo) topo.textContent = num(tot.kcal);
    }
  });
  alvoR.addEventListener("change", function (e) {
    if (e.target.getAttribute("data-campo") === "tipo") {
      var i = Number(e.target.closest("[data-i]").getAttribute("data-i"));
      S.rascunho.refeicoes[i].tipo = e.target.value;
    }
  });

  /* ------------------------------------------------------------ inicio */

  esqueletoDia();

  Promise.all([api("/health"), api("/tipos")])
    .then(function (r) {
      var h = r[0];
      S.hoje = h.hoje;
      S.dia = h.hoje;
      S.tipos = r[1].tipos;
      var avisos = [];
      if (!h.ia.forte) avisos.push("A IA de medição não está configurada (GEMINI_API_KEY). Sem ela não dá pra calcular.");
      if (!h.ia.fraca) avisos.push("A IA rápida não está configurada (GROQ_API_KEY): as refeições serão separadas pelas palavras (almocei, jantei...).");
      (h.banco.avisos || []).forEach(function (a) { avisos.push(a); });
      aviso(avisos.join(" "));
      return carregarDia(true);
    })
    .catch(falhou);
})();

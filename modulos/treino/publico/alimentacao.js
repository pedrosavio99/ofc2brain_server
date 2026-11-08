/* Modulo TREINO - Alimentacao (o antigo modulo Refeicao, agora dentro do modal).
 *
 * A aba "Refeicoes" saiu do menu: tudo o que ela fazia vive aqui, na folha
 * (.sheet) do treino, que e o jeito do 2brain de abrir um modal. Mesmos
 * endpoints /refeicao/api, mesma conta no servidor, nada de dado novo.
 *
 * O que tem, igual a antiga tela:
 *   - resumo do dia (kcal e macros) e o ciclo de 14 dias (toque numa barra = abre o dia)
 *   - meta do dia (teto de kcal calculado com o perfil do treino) e objetivo
 *   - escrever como comeu: "Calcular" (separa, mede, voce confere e aceita)
 *     ou "Registrar direto" (analisa, salva e devolve o feedback da IA)
 *   - rascunho com editar tipo/nome/gramas, tamanho do prato (P/M/G), tentar de novo
 *   - refeicoes salvas do dia: corrigir porcoes e excluir
 *
 * Fluxo com o menor numero de cliques:
 *   1. Escreve e clica Calcular -> POST /analisar (separa e mede de uma vez)
 *   2. Confere e clica Aceitar  -> POST /refeicoes (o servidor recalcula e grava)
 *
 * A conta do item (por100 x gramas / 100) existe aqui so pra tela reagir na
 * hora que voce muda a porcao. Quem vale e a do servidor, refeita no salvar.
 *
 * O treino.js entrega a folha pronta (abrir/fechar) e e avisado do que mudou
 * (aoMudar) pra atualizar o cartao "Alimentacao de hoje". Este arquivo nao
 * mexe em nada do treino alem da propria folha.
 */
(function () {
  "use strict";

  var API = "/refeicao/api";
  // mesmos fatores do servidor (nutricao.mjs): P ~350 g, M ~500 g, G ~700 g
  var TAMANHOS = { pequena: { r: "P", nome: "Pequena", f: 0.7 }, media: { r: "M", nome: "Média", f: 1 },
    grande: { r: "G", nome: "Grande", f: 1.4 } };

  var EXEMPLOS = [
    ["Café", "Café da manhã: 2 ovos mexidos, 1 fatia de pão e café com leite"],
    ["Almoço", "Almoço: 150g de peito de frango, 4 colheres de arroz, feijão e salada"],
    ["Pós-treino", "Pós-treino: 1 banana, 30g de aveia e 1 scoop de whey"],
    ["Jantar", "Jantar: omelete de 3 ovos com queijo e salada"],
  ];

  var ICONE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
  var ICONE_IA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 0-5 5v1a5 5 0 0 0-3 4.5A4.5 4.5 0 0 0 8.5 17H9v3a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-3h.5a4.5 4.5 0 0 0 4.5-4.5A5 5 0 0 0 17 8V7a5 5 0 0 0-5-5z"/></svg>';

  /* ------------------------------------------------------------ utilidades */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var num = function (n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); };
  var g1 = function (n) { return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("pt-BR"); };

  function diaMais(data, n) {
    var t = new Date(data + "T12:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------ API
     O PIN e do 2brain: o /pin.js (carregado antes) envolve o fetch, poe o header
     x-pin e abre o modal unico do app no 401. Aqui so se chama fetch e se
     traduz erro. */

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

  /* ------------------------------------------------------------ modal */

  /* ctx = { abrir(titulo, html), folhaCorpo, aoMudar(), avisar(msg), abrirPerfil(), hoje } */
  function abrir(ctx) {
    var S = {
      hoje: ctx.hoje || null,   // data do servidor (fuso certo), nao do aparelho
      dia: null,                // dia sendo visto
      tipos: [],
      rascunho: null,           // { editando, editandoId?, data, refeicoes: [...] }
      ocupado: false,
      meta: null,
      totais: null,
      lista: [],
    };

    ctx.abrir("Alimentação", montar());
    ctx.folha.classList.add("tr-folha-larga");

    var raiz = ctx.folhaCorpo.querySelector(".rf-modal");
    if (!raiz) return;

    var $ = function (s) { return raiz.querySelector(s); };
    // a folha e reaproveitada: se foi fechada ou trocada por outro modal, para de pintar
    var vivo = function () { return raiz.isConnected && ctx.folhaCorpo.firstElementChild === raiz; };

    function aviso(msg) {
      var a = $("#rf-aviso");
      if (!a) return;
      a.textContent = msg || "";
      a.hidden = !msg;
    }

    function falhou(e) {
      if (!vivo()) return;
      ctx.avisar(e.message + (e.dica && e.dica !== "pin" ? " " + e.dica : ""));
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

    function rotuloDia(data) {
      if (data === S.hoje) return "Hoje";
      if (data === diaMais(S.hoje, -1)) return "Ontem";
      var d = new Date(data + "T12:00:00Z");
      return d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    }

    /* Confirmacao dentro da folha. Antes era o confirm() do navegador, que foge
       do desenho do app e some atras do modal em alguns celulares. */
    function perguntar(msg, rotuloOk, perigo) {
      return new Promise(function (resolve) {
        var caixa = $("#rf-confirma");
        if (!caixa) { resolve(false); return; }
        caixa.innerHTML = '<p>' + esc(msg) + '</p><div class="rf-confirma-acoes">' +
          '<button type="button" class="rf-botao" data-conf="nao">Voltar</button>' +
          '<button type="button" class="rf-botao primario' + (perigo ? " perigo-cheio" : "") + '" data-conf="sim">' +
          esc(rotuloOk || "Confirmar") + "</button></div>";
        caixa.hidden = false;
        var fim = function (r) {
          caixa.hidden = true;
          caixa.innerHTML = "";
          caixa.onclick = null;
          resolve(r);
        };
        caixa.onclick = function (e) {
          var b = e.target.closest("[data-conf]");
          if (b) fim(b.getAttribute("data-conf") === "sim");
        };
      });
    }

    /* O ciclo de 14 dias e a lista do dia mostram a pasta de um dia so por vez:
       tocar numa barra abre aquele dia aqui mesmo. */

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
      return '<span class="rf-tamanhos" role="group" aria-label="Tamanho do prato">' +
        Object.keys(TAMANHOS).map(function (k) {
          return '<button type="button" data-acao="tamanho" data-tamanho="' + k + '" title="' + TAMANHOS[k].nome +
            '" aria-pressed="' + (k === atual) + '" class="' + (k === atual ? "ativo" : "") + '">' + TAMANHOS[k].r + "</button>";
        }).join("") + "</span>";
    }

    /* ------------------------------------------------------------ resumo do dia */

    function desenharResumo(totais) {
      $("#rf-totKcal").textContent = num(totais.kcal);
      // porcentagem de kcal que vem de cada macro, que e o que diz o "tipo" do dia
      var kP = (totais.proteina || 0) * 4, kC = (totais.carbo || 0) * 4, kG = (totais.gordura || 0) * 9;
      var soma = kP + kC + kG || 1;
      var linhas = [
        ["Proteína", totais.proteina, kP, "var(--rf-proteina)"],
        ["Carbo", totais.carbo, kC, "var(--rf-carbo)"],
        ["Gordura", totais.gordura, kG, "var(--rf-gordura)"],
      ];
      $("#rf-totMacros").innerHTML = linhas.map(function (l) {
        var pct = Math.round((l[2] / soma) * 100);
        return '<div class="macro"><div class="macro-topo"><span>' + l[0] + "</span><b>" + g1(l[1]) + " g</b></div>" +
          '<div class="macro-barra"><i style="width:' + pct + "%;background:" + l[3] + '"></i></div></div>';
      }).join("");
    }

    function desenharSemana(dias) {
      var max = Math.max.apply(null, dias.map(function (d) { return d.totais.kcal; }).concat([1]));
      $("#rf-semana").innerHTML = dias.map(function (d) {
        var h = Math.round((d.totais.kcal / max) * 100);
        var letra = new Date(d.data + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "narrow", timeZone: "UTC" });
        return '<button type="button" data-dia="' + d.data + '" class="' + (d.data === S.dia ? "atual" : "") +
          '" title="' + esc(rotuloDia(d.data)) + ": " + num(d.totais.kcal) + ' kcal">' +
          '<i style="height:' + h + '%"></i><span>' + letra + "</span></button>";
      }).join("");
    }

    /* ------------------------------------------------------------ esqueletos
       Usam a mesma pulsacao do .esqueleto do app, so com a forma do que vem
       aqui. O do dia so aparece quando o dia MUDA ou na primeira carga: depois
       de salvar ou excluir, piscar a tela inteira seria pior que esperar. */

    function esqueletoDia() {
      $("#rf-totKcal").innerHTML = '<span class="rf-esq-kcal"></span>';
      $("#rf-totMacros").innerHTML = [1, 2, 3].map(function () {
        return '<div class="macro"><div class="macro-topo"><span class="rf-esq-txt"></span></div>' +
          '<div class="macro-barra"><i class="rf-esq-barra" style="width:60%"></i></div></div>';
      }).join("");
      $("#rf-semana").innerHTML = [40, 70, 25, 55, 80, 35, 60, 45, 75, 30, 65, 50, 85, 40].map(function (h) {
        return '<button type="button" disabled><i class="rf-esq-barra" style="height:' + h + '%"></i>' +
          '<span class="rf-esq-txt curto"></span></button>';
      }).join("");
      esqueletoLista();
    }

    function esqueletoLista() {
      $("#rf-listaDia").innerHTML = [1, 2].map(function () {
        return '<article class="rf-card salva rf-esq-card">' +
          '<header class="salva-topo"><div class="salva-ident">' +
            '<span class="rf-esq-txt medio"></span><span class="rf-esq-txt curto"></span>' +
          '</div><span class="rf-esq-txt kcal"></span></header>' +
          '<span class="rf-esq-txt longo"></span></article>';
      }).join("");
    }

    /* ------------------------------------------------------------ meta do dia */

    /* O teto vem do servidor (perfil do treino + objetivo). Aqui so se desenha.
       Sem teto, o card diz o que falta preencher no perfil em vez de sumir. */
    function desenharMeta() {
      var m = S.meta;
      var chips = $("#rf-planos");
      var det = $("#rf-metaDetalhe");
      var barra = $("#rf-metaBarra");
      if (!chips || !det || !barra) return;

      if (!m) { det.textContent = "Calculando…"; return; }

      chips.innerHTML = m.objetivos.map(function (o) {
        return '<button type="button" data-plano="' + o.id + '" aria-pressed="' + (o.id === m.objetivo) +
          '" class="' + (o.id === m.objetivo ? "ativo" : "") + '">' + esc(o.rotulo) + "</button>";
      }).join("");

      if (!m.teto) {
        barra.hidden = true;
        det.innerHTML = '<span class="meta-falta">Sem teto: falta ' + esc((m.faltando || []).join(", ")) +
          " no perfil do treino.</span> " +
          (ctx.abrirPerfil ? '<button type="button" class="rf-botao-link" data-acao="perfil">Completar o perfil</button>'
            : "Complete no perfil e volte aqui.");
        return;
      }

      var kcal = (S.totais && S.totais.kcal) || 0;
      barra.hidden = false;
      barra.classList.toggle("estourou", kcal > m.teto);
      barra.querySelector("i").style.width = Math.min(100, Math.round((kcal / m.teto) * 100)) + "%";

      var falta = m.teto - kcal;
      var rotulo = (m.objetivos.filter(function (o) { return o.id === m.objetivo; })[0] || {}).rotulo || "";
      det.innerHTML = "Teto de <b>" + num(m.teto) + "</b> kcal: gasto parado <b>" + num(m.basal) + "</b>" +
        (m.treino_dia ? " + treino <b>" + num(m.treino_dia) + "</b>/dia" : "") +
        ", ajustado para " + esc(rotulo) + ". " +
        (S.dia === S.hoje
          ? (falta >= 0 ? "Faltam <b>" + num(falta) + "</b> kcal hoje. " : "Você passou <b>" + num(-falta) + "</b> kcal. ")
          : "") +
        "Estimativa: a fórmula erra uns 10% e a caloria de treino uns 20%.";
    }

    function desenharMedia(dias) {
      var el = $("#rf-resumoMedia");
      if (!el) return;
      var media = dias && dias.media_kcal_dia;
      if (!media) { el.textContent = ""; return; }
      var texto = "Média de " + num(media) + " kcal em " + dias.dias_com_registro + " de 14 dias";
      if (S.meta && S.meta.teto) {
        var d = media - S.meta.teto;
        texto += d > 0 ? " · " + num(d) + " acima do teto" : " · " + num(-d) + " abaixo do teto";
      }
      el.textContent = texto + ".";
    }

    function carregarMetas() {
      return api("/metas").then(function (m) {
        if (!vivo()) return;
        S.meta = m;
        desenharMeta();
      }).catch(function () { /* meta e complemento: sem ela o resto funciona */ });
    }

    function carregarDia(comEsqueleto) {
      $("#rf-tituloDia").textContent = rotuloDia(S.dia);
      // so aparece quando voce saiu de hoje pelo grafico; e a unica saida agora
      $("#rf-btnHoje").hidden = S.dia === S.hoje;
      if (comEsqueleto) esqueletoDia();
      var dia = S.dia;
      return Promise.all([
        api("/dia?data=" + dia),
        api("/dias?ate=" + dia + "&quantos=14"),
      ]).then(function (r) {
        // trocou de dia (ou fechou) enquanto a resposta vinha: ignora a velha
        if (!vivo() || dia !== S.dia) return;
        S.totais = r[0].totais;
        desenharResumo(r[0].totais);
        desenharSemana(r[1].dias);
        desenharDia(r[0].refeicoes);
        desenharMedia(r[1]);
        desenharMeta();
      }).catch(falhou);
    }

    /* Card compacto: cabecalho com kcal, macros da refeicao e os itens dentro de
       um <details> fechado. */
    function desenharDia(lista) {
      var alvo = $("#rf-listaDia");
      S.lista = lista;
      if (!lista.length) {
        alvo.innerHTML = '<div class="rf-card rf-vazio">Nada registrado ' + (S.dia === S.hoje ? "hoje" : "neste dia") + ".</div>";
        return;
      }
      alvo.innerHTML = lista.map(function (r) {
        var t = r.totais || {};
        var nomes = r.itens.map(function (it) { return it.nome; });
        var resumo = nomes.slice(0, 3).join(", ") + (nomes.length > 3 ? "…" : "");
        var selo = TAMANHOS[r.tamanho] && r.tamanho !== "media"
          ? ' <span class="selo">' + TAMANHOS[r.tamanho].nome + "</span>" : "";

        return '<article class="rf-card salva" data-id="' + esc(r.id) + '">' +
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
            '<button type="button" class="rf-botao-link" data-acao="editar">Corrigir porções</button>' +
            '<button type="button" class="rf-botao-link perigo" data-acao="excluir">Excluir</button>' +
          "</div>" +
        "</article>";
      }).join("");
    }

    /* Corrigir uma refeicao ja salva: reabre editando, e o Aceitar vira PUT. */
    function editarSalva(id) {
      var r = S.lista.filter(function (x) { return String(x.id) === String(id); })[0];
      if (!r) return;
      S.rascunho = { editando: true, editandoId: id, data: r.data,
        refeicoes: [{ tipo: r.tipo, tamanho: r.tamanho, texto: r.texto, itens: JSON.parse(JSON.stringify(r.itens)), erro: "" }] };
      desenharRascunho();
      $("#rf-rascunho").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function excluirSalva(id) {
      perguntar("Excluir esta refeição? Isso não dá para desfazer.", "Excluir", true).then(function (sim) {
        if (!sim) return;
        api("/refeicoes/" + id, { method: "DELETE" })
          .then(function () {
            if (!vivo()) return;
            ctx.avisar("Refeição excluída.");
            ctx.aoMudar();
            return carregarDia();
          })
          .catch(falhou);
      });
    }

    /* ------------------------------------------------------------ calcular */

    /* O Calcular passa por duas IAs (separar e medir) e demora alguns segundos.
       Sem esqueleto parecia que nada tinha acontecido. */
    function esqueletoRascunho(quantos, legenda) {
      var alvo = $("#rf-rascunho");
      alvo.hidden = false;
      alvo.innerHTML = '<p class="rf-esq-legenda">' + esc(legenda || "Separando e medindo sua refeição…") + "</p>" +
        Array.apply(null, Array(quantos || 1)).map(function () {
          return '<div class="rf-card bloco rf-esq-card">' +
            '<div class="salva-topo"><span class="rf-esq-txt medio"></span><span class="rf-esq-txt kcal"></span></div>' +
            [1, 2, 3].map(function () {
              return '<div class="rf-esq-item"><span class="rf-esq-txt longo"></span>' +
                '<span class="rf-esq-txt curto"></span></div>';
            }).join("") + "</div>";
        }).join("");
    }

    function palavrasDeRefeicao(texto) {
      // uma caixa por "almocei/jantei" que der pra ver no texto, no minimo uma
      return Math.min((texto.match(/almoc|jant|caf[eé]|lanch|ceia/gi) || []).length || 1, 3);
    }

    function analisar() {
      var texto = $("#rf-texto").value.trim();
      if (!texto) { $("#rf-texto").focus(); return; }
      ocupar(true, "#rf-btnAnalisar", "Calculando…");
      $("#rf-btnRapido").disabled = true;
      esqueletoRascunho(palavrasDeRefeicao(texto));
      api("/analisar", { method: "POST", body: { texto: texto } })
        .then(function (r) {
          if (!vivo()) return;
          S.rascunho = { editando: false, data: S.dia,
            refeicoes: r.refeicoes.map(function (x) {
              return { tipo: x.tipo, tamanho: x.tamanho, texto: x.texto, itens: x.itens || [],
                erro: x.erro || "", fonte: x.fonte || "", modelo: x.modelo || "", avisos: x.avisos || [] };
            }) };
          desenharRascunho();
          $("#rf-rascunho").scrollIntoView({ behavior: "smooth", block: "nearest" });
          // separacao caiu na regra: diz por que, senao parece que a IA funcionou
          if (r.separacao && r.separacao.erro) aviso("Separei pelas palavras do texto. " + r.separacao.erro);
        })
        .catch(function (e) {
          if (!vivo()) return;
          // erro na analise: tirar o esqueleto, senao ele fica pulsando pra sempre
          $("#rf-rascunho").hidden = true;
          $("#rf-rascunho").innerHTML = "";
          falhou(e);
        })
        .then(function () {
          if (!vivo()) return;
          ocupar(false, "#rf-btnAnalisar", "Calcular");
          $("#rf-btnRapido").disabled = false;
        });
    }

    /* "Registrar direto": o atalho que o treino ja tinha. Analisa, salva e volta
       com o feedback da IA, sem passar pela conferencia. */
    function registrarDireto() {
      var texto = $("#rf-texto").value.trim();
      if (!texto) { $("#rf-texto").focus(); return; }
      ocupar(true, "#rf-btnRapido", "Registrando…");
      $("#rf-btnAnalisar").disabled = true;
      esqueletoRascunho(palavrasDeRefeicao(texto), "A IA está separando, medindo e registrando…");
      api("/rapido", { method: "POST", body: { texto: texto, data: S.dia } })
        .then(function (res) {
          if (!vivo()) return;
          $("#rf-rascunho").hidden = true;
          $("#rf-rascunho").innerHTML = "";
          $("#rf-texto").value = "";
          contar();
          mostrarRegistrado(res);
          ctx.aoMudar();
          return carregarDia();
        })
        .catch(function (e) {
          if (!vivo()) return;
          $("#rf-rascunho").hidden = true;
          $("#rf-rascunho").innerHTML = "";
          falhou(e);
        })
        .then(function () {
          if (!vivo()) return;
          ocupar(false, "#rf-btnRapido", "Registrar direto");
          $("#rf-btnAnalisar").disabled = false;
        });
    }

    /* O resultado do "Registrar direto": totais, feedback da IA e o que foi medido. */
    function mostrarRegistrado(res) {
      var t = res.totais || {};
      var itens = (res.refeicoes || []).reduce(function (a, r) { return a.concat(r.itens || []); }, []);
      var caixa = $("#rf-feito");
      caixa.innerHTML =
        '<div class="rf-feito-topo"><span class="rf-feito-ico">' + ICONE_CHECK + "</span>" +
          "<div><h3>Refeição registrada</h3><p>Já somada ao seu dia.</p></div>" +
          '<button type="button" class="rf-feito-x" data-acao="fechar-feito" aria-label="Dispensar">×</button></div>' +
        '<div class="rf-feito-kcal"><b>' + num(t.kcal) + "</b> <span>kcal</span>" +
          '<span class="rf-feito-macros">P ' + g1(t.proteina) + " · C " + g1(t.carbo) + " · G " + g1(t.gordura) + "</span></div>" +
        (res.feedback
          ? '<div class="rf-feito-ia"><div class="rf-feito-ia-cab">' + ICONE_IA + "<span>Feedback da IA</span></div>" +
            "<p>“" + esc(res.feedback) + "”</p></div>"
          : "") +
        (itens.length
          ? '<ul class="rf-feito-itens">' + itens.map(function (it) {
              return "<li><span>" + esc(it.nome) + " (" + num(it.gramas) + " g)</span><em>" + num(it.kcal) + " kcal</em></li>";
            }).join("") + "</ul>"
          : "");
      caixa.hidden = false;
      ctx.folha.scrollTop = 0;
    }

    /* ------------------------------------------------------------ rascunho */

    function desenharRascunho() {
      var R = S.rascunho;
      var alvo = $("#rf-rascunho");
      if (!R) { alvo.hidden = true; alvo.innerHTML = ""; $("#rf-cardEscrever").hidden = false; return; }
      alvo.hidden = false;
      $("#rf-cardEscrever").hidden = true;

      var total = somar(R.refeicoes.map(function (r) { return somar(r.itens); }));
      var cabeca = '<div class="rascunho-topo"><h2>' + (R.editandoId ? "Corrigir refeição" : "Confira") +
        '</h2><span class="kcal"><b>' + num(total.kcal) + "</b> kcal</span></div>" +
        (R.editando ? '<p class="rf-nota" style="margin:0 4px">Mude tipo, nome ou gramas. A conta refaz na hora.</p>' : "");

      var blocos = R.refeicoes.map(function (r, i) {
        return R.editando ? blocoMedido(r, i) : blocoLeitura(r, i);
      }).join("");

      var rodape = '<div class="rodape-rascunho">' +
        (R.editando && !R.editandoId ? '<label>Dia <input type="date" id="rf-dataSalvar" value="' + (R.data || S.dia) + '" max="' + S.hoje + '" /></label>' : "") +
        '<button type="button" class="rf-botao" data-acao="cancelar">Cancelar</button>' +
        '<span class="espaco"></span>' +
        (R.editando ? "" : '<button type="button" class="rf-botao" data-acao="editar">Editar</button>') +
        '<button type="button" class="rf-botao primario" data-acao="salvar" id="rf-btnSalvar">Aceitar</button></div>';

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
          '<div class="bloco-acoes"><button type="button" class="rf-botao-link" data-acao="remedir">Tentar de novo</button>' +
          '<button type="button" class="rf-botao-link perigo" data-acao="remover">Descartar</button></div>'
        : '<div class="itens">' + r.itens.map(function (it) {
            var selo = it.conferir ? ' <span class="selo conferir">conferir</span>'
              : it.porcao_fonte === "texto" ? ' <span class="selo texto">sua porção</span>'
              : ' <span class="selo">estimada</span>';
            return '<div class="item"><div>' + esc(it.nome) + "</div>" +
              '<div class="item-kcal">' + num(it.kcal) + "</div>" +
              '<div class="item-linha">' + num(it.gramas) + " g" + (it.medida ? " · " + esc(it.medida) : "") + selo + "</div>" +
              (it.observacao ? '<div class="item-obs">' + esc(it.observacao) + "</div>" : "") + "</div>";
          }).join("") + "</div>";
      return '<div class="rf-card bloco salva" data-i="' + i + '">' +
        '<div class="bloco-topo"><h3>' + esc(rotuloTipo(r.tipo)) + "</h3>" +
          (r.itens.length ? chipsTamanho(r) : "") +
          '<span class="kcal">' + num(t.kcal) + " kcal</span></div>" + avisoOrigem(r) + corpo + "</div>";
    }

    function blocoMedido(r, i) {
      var t = somar(r.itens);
      var corpo = r.erro
        ? '<p class="bloco-erro">' + esc(r.erro) + "</p>" +
          '<div class="bloco-acoes"><button type="button" class="rf-botao-link" data-acao="remedir">Tentar de novo</button>' +
          '<button type="button" class="rf-botao-link perigo" data-acao="remover">Descartar esta</button></div>'
        : '<div class="itens">' + r.itens.map(function (it, j) { return linhaItem(it, j); }).join("") + "</div>";
      return '<div class="rf-card bloco" data-i="' + i + '">' +
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
          if (!vivo() || S.rascunho !== R) return;
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
      if (!validas.length) { ctx.avisar("Nada pra salvar ainda."); return; }
      var pendentes = R.refeicoes.length - validas.length;

      var seguir = pendentes
        ? perguntar(pendentes + " refeição(ões) sem medição ficarão de fora. Salvar mesmo assim?", "Salvar")
        : Promise.resolve(true);

      seguir.then(function (sim) {
        if (!sim) return;
        var envio = validas.map(function (r) { return { tipo: r.tipo, tamanho: r.tamanho, texto: r.texto, itens: r.itens }; });
        var campoData = $("#rf-dataSalvar");
        var pedido = R.editandoId
          ? api("/refeicoes/" + R.editandoId, { method: "PUT", body: envio[0] })
          : api("/refeicoes", { method: "POST", body: { data: (campoData || {}).value || S.dia, refeicoes: envio } });

        ocupar(true, "#rf-btnSalvar", "Salvando…");
        return pedido
          .then(function (r) {
            if (!vivo()) return;
            ctx.avisar(R.editandoId ? "Refeição corrigida." : "Refeição salva.");
            if (r.data && r.data !== S.dia) S.dia = r.data;
            S.rascunho = null;
            $("#rf-texto").value = "";
            contar();
            desenharRascunho();
            ctx.aoMudar();
            return carregarDia();
          })
          .catch(falhou)
          .then(function () { if (vivo()) ocupar(false, "#rf-btnSalvar", "Aceitar"); });
      });
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
      $("#rf-contador").textContent = $("#rf-texto").value.length + "/2000";
    }

    var texto = $("#rf-texto");
    texto.addEventListener("input", contar);
    texto.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); analisar(); }
    });
    $("#rf-btnAnalisar").addEventListener("click", analisar);
    $("#rf-btnRapido").addEventListener("click", registrarDireto);

    // exemplos: um toque preenche (ou acrescenta) o texto
    $("#rf-exemplos").addEventListener("click", function (e) {
      var b = e.target.closest("[data-exemplo]");
      if (!b) return;
      var ex = b.getAttribute("data-exemplo");
      texto.value = texto.value.trim() ? texto.value.replace(/\s+$/, "") + "\n" + ex : ex;
      contar();
      texto.focus();
    });

    $("#rf-btnHoje").addEventListener("click", function () { S.dia = S.hoje; carregarDia(true); });

    $("#rf-feito").addEventListener("click", function (e) {
      if (e.target.closest("[data-acao='fechar-feito']")) { $("#rf-feito").hidden = true; $("#rf-feito").innerHTML = ""; }
    });

    $("#rf-planos").addEventListener("click", function (e) {
      var b = e.target.closest("[data-plano]");
      if (!b || !S.meta) return;
      var antes = S.meta.objetivo;
      S.meta.objetivo = b.getAttribute("data-plano");
      desenharMeta();
      api("/metas", { method: "PUT", body: { objetivo: S.meta.objetivo } })
        .then(carregarMetas)
        .catch(function (err) { S.meta.objetivo = antes; desenharMeta(); falhou(err); });
    });

    $("#rf-metaDetalhe").addEventListener("click", function (e) {
      if (e.target.closest("[data-acao='perfil']") && ctx.abrirPerfil) ctx.abrirPerfil();
    });

    // toque numa barra do ciclo: abre aquele dia aqui mesmo
    $("#rf-semana").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-dia]");
      if (!b) return;
      var dia = b.getAttribute("data-dia");
      if (dia === S.dia) return;
      S.dia = dia;
      S.rascunho = null;
      desenharRascunho();
      esqueletoLista();
      carregarDia(false);
    });

    $("#rf-listaDia").addEventListener("click", function (e) {
      var b = e.target.closest("[data-acao]");
      if (!b) return;
      var cartao = b.closest("[data-id]");
      if (!cartao) return;
      var id = cartao.getAttribute("data-id");
      if (b.getAttribute("data-acao") === "editar") editarSalva(id);
      if (b.getAttribute("data-acao") === "excluir") excluirSalva(id);
    });

    var alvoR = $("#rf-rascunho");

    alvoR.addEventListener("click", function (e) {
      var b = e.target.closest("[data-acao]");
      if (!b || S.ocupado) return;
      var R = S.rascunho;
      if (!R) return;
      var acao = b.getAttribute("data-acao");
      var bloco = b.closest("[data-i]");
      var i = bloco ? Number(bloco.getAttribute("data-i")) : -1;

      if (acao === "cancelar") {
        if (R.editandoId) { S.rascunho = null; desenharRascunho(); return; }
        perguntar("Descartar este rascunho?", "Descartar", true).then(function (sim) {
          if (sim) { S.rascunho = null; desenharRascunho(); }
        });
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
        if (!vivo()) return;
        var h = r[0];
        S.hoje = h.hoje;
        S.dia = h.hoje;
        S.tipos = r[1].tipos;
        var avisos = [];
        if (!h.ia.forte) avisos.push("A IA de medição não está configurada (GEMINI_API_KEY). Sem ela não dá pra calcular.");
        if (!h.ia.fraca) avisos.push("A IA rápida não está configurada (GROQ_API_KEY): as refeições serão separadas pelas palavras (almocei, jantei...).");
        ((h.banco && h.banco.avisos) || []).forEach(function (a) { avisos.push(a); });
        aviso(avisos.join(" "));
        carregarMetas();
        return carregarDia(true);
      })
      .catch(function (e) {
        if (!vivo()) return;
        $("#rf-listaDia").innerHTML = '<div class="rf-card rf-vazio">Não deu pra abrir a alimentação: ' + esc(e.message) + "</div>";
        falhou(e);
      });

    if (ctx.focarTexto) setTimeout(function () { if (vivo()) texto.focus(); }, 200);
  }

  /* O esqueleto estrutural do modal: tudo ja no lugar, os numeros entram depois. */
  function montar() {
    return '<div class="rf-modal">' +
      '<p class="rf-sub">Escreva como comeu; a conta é do sistema.</p>' +
      '<div class="rf-aviso" id="rf-aviso" hidden></div>' +
      '<section class="rf-card rf-feito" id="rf-feito" hidden aria-live="polite"></section>' +
      '<div class="rf-colunas">' +
        '<div class="rf-col">' +
          /* resumo do dia + o ciclo de 14 dias */
          '<section class="rf-card resumo" aria-live="polite">' +
            '<div class="resumo-kcal"><strong id="rf-totKcal">–</strong><span>kcal</span></div>' +
            '<div class="meta-barra" id="rf-metaBarra" hidden><i></i></div>' +
            '<div class="macros" id="rf-totMacros"></div>' +
            '<div class="semana" id="rf-semana" aria-label="Ciclo de 14 dias"></div>' +
            '<p class="resumo-media" id="rf-resumoMedia"></p>' +
          "</section>" +
          /* teto de caloria, calculado com o perfil do treino */
          '<section class="rf-card meta" id="rf-cardMeta">' +
            '<div class="meta-topo"><span class="rf-rotulo">Meta do dia</span>' +
              '<span class="rf-tamanhos" id="rf-planos" role="group" aria-label="Objetivo"></span></div>' +
            '<p class="meta-detalhe" id="rf-metaDetalhe">Calculando…</p>' +
          "</section>" +
          /* escrever */
          '<section class="rf-card" id="rf-cardEscrever">' +
            '<label for="rf-texto" class="rf-rotulo">Como foi sua refeição?</label>' +
            '<div class="rf-exemplos" id="rf-exemplos"><span>Exemplos:</span>' +
              EXEMPLOS.map(function (x) {
                return '<button type="button" class="rf-chip" data-exemplo="' + esc(x[1]) + '">' + esc(x[0]) + "</button>";
              }).join("") + "</div>" +
            '<textarea id="rf-texto" rows="4" maxlength="2000" ' +
              'placeholder="Ex.: almocei arroz, feijão, um bife e salada. Ou o dia todo: de manhã pão com ovo e café com leite, almoço marmita de frango, à noite um açaí de 500 ml."></textarea>' +
            '<div class="linha-acoes"><span class="contador" id="rf-contador">0/2000</span>' +
              '<span class="rf-acoes-dupla">' +
                '<button type="button" class="rf-botao" id="rf-btnRapido" title="Analisa, salva e já devolve o feedback da IA, sem conferir antes">Registrar direto</button>' +
                '<button type="button" class="rf-botao primario" id="rf-btnAnalisar" title="Separa e mede; você confere e aceita">Calcular</button>' +
              "</span></div>" +
          "</section>" +
        "</div>" +
        /* coluna da direita: o rascunho (separar e medir) aparece no topo, ao lado de onde se
           escreve, e logo abaixo as refeicoes salvas. No celular tudo empilha na mesma ordem. */
        '<div class="rf-col">' +
          '<section id="rf-rascunho" hidden></section>' +
          '<section class="rf-secao-dia">' +
            '<div class="dia-cabeca"><h4 class="rf-titulo-secao" id="rf-tituloDia">Hoje</h4>' +
              '<button type="button" class="rf-botao-link" id="rf-btnHoje" hidden>Voltar para hoje</button></div>' +
            '<div id="rf-listaDia"></div>' +
          "</section>" +
        "</div>" +
      "</div>" +
      '<div class="rf-confirma" id="rf-confirma" role="alertdialog" hidden></div>' +
    "</div>";
  }

  window.TreinoAlimentacao = { abrir: abrir };
})();

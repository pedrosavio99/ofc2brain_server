/* Modulo TREINO - a tela.
 *
 * Tudo e pintado a partir de UM estado, que vem do GET /hoje. Esse endpoint ja
 * devolve perfil, pendencia de pesagem, contagem de equipamentos e a sessao do
 * dia, entao a tela nao reimplementa nenhuma regra: ela so decide o que
 * mostrar. Regra duplicada entre servidor e tela e o jeito mais rapido de as
 * duas discordarem.
 *
 * O fetch ja vem embrulhado pelo /pin.js, entao o header do PIN e automatico.
 */
(function () {
  "use strict";

  var API = "/treino/api";
  var tela = document.getElementById("tela");
  var folha = document.getElementById("folha");
  var folhaTitulo = document.getElementById("folhaTitulo");
  var folhaCorpo = document.getElementById("folhaCorpo");
  var veu = document.getElementById("veu");
  var elAviso = document.getElementById("aviso");

  var S = { dia: null, equipamentos: [], carregando: true, primeira: true };

  /* Modal automatico e coisa de PRIMEIRA carga, nao de toda recarga.
     Todo salvar chama carregar(), e o carregar() decidia abrir perfil ou
     pesagem se houvesse pendencia. Resultado: fechar um modal abria outro por
     cima, e enquanto o perfil estivesse incompleto ele reabria sozinho em
     cima do que voce estava fazendo. Virava laco. */
  var jaPerguntou = { perfil: false, peso: false };

  /* ----------------------------------------------------------- utilitarios */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var sumindo = null;
  function avisar(msg) {
    elAviso.textContent = msg;
    elAviso.hidden = false;
    clearTimeout(sumindo);
    sumindo = setTimeout(function () { elAviso.hidden = true; }, 3200);
  }

  async function pedir(caminho, opcoes) {
    var r = await fetch(API + caminho, Object.assign({}, opcoes || {}));
    var d = null;
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      var err = new Error((d && d.erro) || "Falhou (" + r.status + ")");
      err.status = r.status;
      err.dica = (d && d.dica) || "";
      throw err;
    }
    return d;
  }

  function json(metodo, corpo) {
    return { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) };
  }

  /* --------------------------------------------------------------- folha */

  /* A .sheet do app abre pela classe .aberto, nao por hidden: e ela que tem a
     transicao. Usar hidden aqui mataria a animacao e, pior, deixaria o
     elemento ocupando espaco sem fundo. */
  function abrir(titulo, html) {
    folhaTitulo.textContent = titulo;
    folhaCorpo.innerHTML = html;
    // rola pro topo: a folha e reaproveitada e guardava a rolagem da anterior
    folha.scrollTop = 0;
    folha.classList.add("aberto");
    veu.classList.add("aberto");
  }
  function fechar() {
    folha.classList.remove("aberto");
    veu.classList.remove("aberto");
    // espera a transicao antes de esvaziar, senao o conteudo some na cara
    setTimeout(function () { if (!aberta()) folhaCorpo.innerHTML = ""; }, 380);
  }
  function aberta() { return folha.classList.contains("aberto"); }

  document.getElementById("btnFecharFolha").addEventListener("click", fechar);
  // o veu e um elemento separado: clicar nele fecha, clicar na folha nao
  veu.addEventListener("click", fechar);

  /* Grupo de escolha (leve/moderado/pesado). Devolve quem le o valor. */
  function ligarEscolha(seletor) {
    var botoes = folhaCorpo.querySelectorAll(seletor + " button");
    botoes.forEach(function (b) {
      b.addEventListener("click", function () {
        botoes.forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
      });
    });
    return function () {
      var on = folhaCorpo.querySelector(seletor + ' button[aria-pressed="true"]');
      return on ? on.dataset.valor : null;
    };
  }

  /* ---------------------------------------------------------- modais */

  function modalPerfil() {
    var p = (S.dia && S.dia.perfil) || {};
    abrir("Seu perfil", '' +
      '<p class="tr-sub" style="margin-top:0">Peso e altura entram na conta de calorias. Sem o peso, ela não acontece.</p>' +
      '<div class="tr-dupla">' +
        '<div class="tr-campo"><label>Peso (kg)</label><input class="campo" id="fPeso" type="number" step="0.1" inputmode="decimal" value="' + esc(p.peso_kg || "") + '"></div>' +
        '<div class="tr-campo"><label>Altura (cm)</label><input class="campo" id="fAltura" type="number" inputmode="numeric" value="' + esc(p.altura_cm || "") + '"></div>' +
      '</div>' +
      '<div class="tr-dupla">' +
        '<div class="tr-campo"><label>Nascimento</label><input class="campo" id="fNasc" type="date" value="' + esc(p.nascimento || "") + '"></div>' +
        '<div class="tr-campo"><label>Sexo</label><select class="campo" id="fSexo">' +
          '<option value="">não informar</option>' +
          '<option value="M"' + (p.sexo === "M" ? " selected" : "") + '>masculino</option>' +
          '<option value="F"' + (p.sexo === "F" ? " selected" : "") + '>feminino</option>' +
        '</select></div>' +
      '</div>' +
      '<div class="tr-campo"><label>Nível</label><select class="campo" id="fNivel">' +
        ["iniciante", "intermediario", "avancado"].map(function (n) {
          return '<option value="' + n + '"' + (p.nivel === n ? " selected" : "") + ">" + n + "</option>";
        }).join("") +
      '</select></div>' +
      '<div class="tr-campo"><label>Restrições e lesões</label>' +
        '<textarea class="campo" id="fRestr" rows="2" placeholder="Ex: dor no ombro direito, evitar impacto">' + esc(p.restricoes || "") + '</textarea></div>' +
      '<button class="btn btn-largo" id="fSalvar">Salvar</button>');

    document.getElementById("fSalvar").addEventListener("click", async function (e) {
      e.target.disabled = true;
      try {
        await pedir("/perfil", json("PUT", {
          peso_kg: document.getElementById("fPeso").value || null,
          altura_cm: document.getElementById("fAltura").value || null,
          nascimento: document.getElementById("fNasc").value || null,
          sexo: document.getElementById("fSexo").value || null,
          nivel: document.getElementById("fNivel").value,
          restricoes: document.getElementById("fRestr").value,
        }));
        fechar(); avisar("Perfil salvo."); carregar();
      } catch (err) { avisar(err.message); e.target.disabled = false; }
    });
  }

  function modalPesagem() {
    var p = (S.dia && S.dia.perfil) || {};
    var primeira = S.dia && S.dia.pesagem && S.dia.pesagem.primeira_vez;
    abrir(primeira ? "Quanto você pesa?" : "Hora de atualizar o peso", '' +
      '<p class="tr-sub" style="margin-top:0">' +
        (primeira
          ? "É o número que faz a conta de calorias existir."
          : "Já faz duas semanas. Peso atualizado deixa a estimativa honesta.") +
      '</p>' +
      '<div class="tr-campo"><label>Peso (kg)</label>' +
        '<input class="campo" id="pPeso" type="number" step="0.1" inputmode="decimal" value="' + esc(p.peso_kg || "") + '" autofocus></div>' +
      '<button class="btn btn-largo" id="pSalvar">Salvar</button>' +
      (primeira ? "" : '<button class="btn btn-suave btn-largo" id="pDepois" style="margin-top:8px">Agora não</button>'));

    document.getElementById("pSalvar").addEventListener("click", async function (e) {
      e.target.disabled = true;
      try {
        await pedir("/pesagem", json("POST", { peso_kg: document.getElementById("pPeso").value }));
        fechar(); avisar("Peso atualizado."); carregar();
      } catch (err) { avisar(err.message); e.target.disabled = false; }
    });
    var depois = document.getElementById("pDepois");
    if (depois) depois.addEventListener("click", fechar);
  }

  /* Cadastro de equipamento em DOIS passos: a IA rascunha, voce confere.
     Nada vai pro banco sem passar pela segunda tela. */
  function modalEquipamento() {
    abrir("Novo equipamento", '' +
      '<p class="tr-sub" style="margin-top:0">Escreva o que você tem. A IA preenche o resto e você confere antes de salvar.</p>' +
      '<div class="tr-campo"><label>O que é</label>' +
        '<input class="campo" id="eNome" placeholder="Ex: halteres ajustáveis até 20kg" autofocus></div>' +
      '<div class="tr-campo"><label>Alguma observação (opcional)</label>' +
        '<input class="campo" id="eObs" placeholder="Ex: só tenho 2 anilhas"></div>' +
      '<button class="btn btn-largo" id="eAnalisar">Analisar</button>');

    document.getElementById("eAnalisar").addEventListener("click", async function (e) {
      var nome = document.getElementById("eNome").value.trim();
      if (!nome) return;
      e.target.disabled = true; e.target.textContent = "Analisando...";
      try {
        var r = await pedir("/equipamentos/analisar", json("POST", {
          nome: nome, observacao: document.getElementById("eObs").value,
        }));
        conferirEquipamento(r);
      } catch (err) { avisar(err.message); e.target.disabled = false; e.target.textContent = "Analisar"; }
    });
  }

  function conferirEquipamento(r) {
    var d = r.rascunho || {};
    var selo = r.fonte === "ia" ? '<span class="tr-selo">sugerido pela IA</span>'
      : '<span class="tr-selo">preencha na mão</span>';
    abrir("Confira antes de salvar", '' +
      '<p class="tr-sub" style="margin-top:0">Tudo aqui dá pra editar.' + selo + '</p>' +
      (r.erro ? '<p class="tr-sub">A IA não respondeu: ' + esc(r.erro) + "</p>" : "") +
      '<div class="tr-campo"><label>Nome</label><input class="campo" id="cNome" value="' + esc(d.nome) + '"></div>' +
      '<div class="tr-dupla">' +
        '<div class="tr-campo"><label>Tipo</label><input class="campo" id="cTipo" value="' + esc(d.tipo) + '"></div>' +
        '<div class="tr-campo"><label>MET (gasto)</label><input class="campo" id="cMet" type="number" step="0.1" value="' + esc(d.met) + '"></div>' +
      '</div>' +
      (d.met_corrigido ? '<p class="tr-sub">O MET foi ajustado: ' + esc(d.met_motivo) + "</p>" : "") +
      '<div class="tr-campo"><label>Pra que serve</label><textarea class="campo" id="cResumo" rows="2">' + esc(d.resumo) + "</textarea></div>" +
      '<div class="tr-campo"><label>Como usar numa ficha</label><textarea class="campo" id="cUsar" rows="3">' + esc(d.como_usar) + "</textarea></div>" +
      '<div class="tr-campo"><label>Grupos musculares (separados por vírgula)</label>' +
        '<input class="campo" id="cGrupos" value="' + esc((d.grupos || []).join(", ")) + '"></div>' +
      '<button class="btn btn-largo" id="cSalvar">Salvar equipamento</button>');

    document.getElementById("cSalvar").addEventListener("click", async function (e) {
      e.target.disabled = true;
      try {
        var res = await pedir("/equipamentos", json("POST", {
          nome: document.getElementById("cNome").value,
          tipo: document.getElementById("cTipo").value,
          met: document.getElementById("cMet").value,
          resumo: document.getElementById("cResumo").value,
          como_usar: document.getElementById("cUsar").value,
          grupos: document.getElementById("cGrupos").value.split(",").map(function (g) { return g.trim(); }).filter(Boolean),
          gerado_por_ia: r.fonte === "ia" ? 1 : 0,
        }));
        fechar();
        avisar(res.met_corrigido ? "Salvo. O MET virou " + res.equipamento.met + "." : "Equipamento salvo.");
        carregar();
      } catch (err) { avisar(err.message); e.target.disabled = false; }
    });
  }

  async function modalListaEquipamentos() {
    abrir("Seus equipamentos", '<div class="tr-carregando">Carregando…</div>');
    try {
      var r = await pedir("/equipamentos");
      S.equipamentos = r.equipamentos || [];
      abrir("Seus equipamentos",
        (S.equipamentos.length
          ? '<div class="grupo">' + S.equipamentos.map(function (e) {
              return '<div class="item"><div class="item-txt"><strong>' + esc(e.nome) + "</strong><span>" +
                esc(e.tipo) + " · MET " + esc(e.met) +
                ((e.grupos || []).length ? " · " + esc(e.grupos.join(", ")) : "") +
                '</span></div><button class="tr-mini" data-remover="' + e.id + '">remover</button></div>';
            }).join("") + "</div>"
          : '<div class="vazio"><h3>Nada cadastrado</h3><p>A ficha só consegue montar treino com o que estiver aqui.</p></div>') +
        '<button class="btn btn-largo" id="eNovo" style="margin-top:12px">Cadastrar equipamento</button>');

      document.getElementById("eNovo").addEventListener("click", modalEquipamento);
      folhaCorpo.querySelectorAll("[data-remover]").forEach(function (b) {
        b.addEventListener("click", async function () {
          try {
            await pedir("/equipamentos/" + b.dataset.remover, { method: "DELETE" });
            avisar("Removido."); modalListaEquipamentos(); carregar();
          } catch (err) { avisar(err.message); }
        });
      });
    } catch (err) {
      abrir("Seus equipamentos", '<div class="vazio"><h3>Não deu pra ler</h3><p>' + esc(err.message) + "</p></div>");
    }
  }

  /* Frases prontas: um toque escreve o pedido, e voce edita se quiser. */
  var SUGESTOES_EXTRA = [
    "Tô com energia, quero mais ombro",
    "Quero gastar mais caloria em 30 min",
    "Quero algo pra testosterona",
    "Braço, uns 20 minutos",
  ];

  /* O modal de atividade tem dois modos. "Já fiz" e o de sempre: lanca o que
     aconteceu. "Quero treinar mais" pede uma ficha extra a partir do que voce
     escrever. Trocar de modo reabre a folha no outro. */
  function modalManual(modo) {
    if (modo === "mais") return modalExtra();
    abrir("Lançar atividade", seletorModo("fiz") +
      '<p class="tr-sub" style="margin-top:0">Escreva do seu jeito. Caminhada, corrida e bike já têm gasto tabelado.</p>' +
      '<div class="tr-campo"><label>O que você fez</label>' +
        '<input class="campo" id="mTexto" placeholder="Ex: corri 35 min no parque" autofocus></div>' +
      '<button class="btn btn-largo" id="mAnalisar">Continuar</button>');
    ligarModo();

    document.getElementById("mAnalisar").addEventListener("click", async function (e) {
      var texto = document.getElementById("mTexto").value.trim();
      if (!texto) return;
      e.target.disabled = true;
      try {
        var r = await pedir("/manual/analisar", json("POST", { texto: texto }));
        conferirManual(r);
      } catch (err) { avisar(err.message); e.target.disabled = false; }
    });
  }

  function seletorModo(atual) {
    return '<div class="tr-escolha tr-modos" id="mModo">' +
      '<button type="button" data-modo="fiz" aria-pressed="' + (atual === "fiz") + '">Já fiz</button>' +
      '<button type="button" data-modo="mais" aria-pressed="' + (atual === "mais") + '">Quero treinar mais</button>' +
      "</div>";
  }
  function ligarModo() {
    folhaCorpo.querySelectorAll("#mModo [data-modo]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("aria-pressed") === "true") return;
        modalManual(b.dataset.modo);
      });
    });
  }

  function modalExtra() {
    var d = S.dia || {};
    if (d.pode_extra === false) {
      abrir("Treinar mais", seletorModo("mais") +
        '<div class="vazio" style="padding:26px 10px"><h3>Feche a ficha do dia antes</h3>' +
        "<p>Com duas fichas abertas ao mesmo tempo o treino se confunde. Fecha a de hoje e volta aqui.</p></div>");
      ligarModo();
      return;
    }
    abrir("Treinar mais", seletorModo("mais") +
      '<p class="tr-sub" style="margin-top:0">Diga como você está e o que quer. A ficha extra complementa o que você já fez hoje' +
        (d.extra ? ", e substitui a extra que está aberta" : "") + ".</p>" +
      '<div class="tr-campo"><label>O que você quer agora</label>' +
        '<textarea class="campo" id="xPedido" rows="3" placeholder="Ex: tô com energia, quero mais ombro"></textarea></div>' +
      '<div class="tr-sugestoes">' + SUGESTOES_EXTRA.map(function (t) {
        return '<button type="button" data-sugestao="' + esc(t) + '">' + esc(t) + "</button>";
      }).join("") + "</div>" +
      camposGeracao("x", !d.pode_gerar, true) +
      '<button class="btn btn-largo" id="xGerar" style="margin-top:6px">Gerar ficha extra</button>');
    ligarModo();

    var campo = document.getElementById("xPedido");
    folhaCorpo.querySelectorAll("[data-sugestao]").forEach(function (b) {
      b.addEventListener("click", function () { campo.value = b.dataset.sugestao; campo.focus(); });
    });
    var ler = ligarGeracao(folhaCorpo, "x");
    document.getElementById("xGerar").addEventListener("click", async function () {
      var pedido = campo.value.trim();
      if (!pedido) { avisar("Escreva o que você quer treinar agora."); campo.focus(); return; }
      var dados = ler();
      dados.pedido = pedido;
      S.ultimoLocal = dados.local;
      fechar();
      // o Gemini leva uns segundos: o esqueleto diz que a ficha esta sendo montada
      tela.innerHTML = esqueleto("ficha");
      try {
        await pedir("/ficha/extra", json("POST", dados));
        avisar("Ficha extra pronta.");
      } catch (err) {
        avisar(err.message);
      }
      carregar();
    });
  }

  /* O que foi treinado num dia do grafico. So o que foi FECHADO, igual aos
     numeros do painel: ficha aberta ou trocada nao entra. Busca na hora
     (GET /sessoes ja existe) em vez de guardar: e um toque de vez em quando,
     e assim nunca mostra coisa velha. */
  async function modalDia(iso) {
    var titulo = new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR",
      { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
    abrir(titulo, '<div class="esqueleto tr-esq"><div class="linha curta"></div><div class="linha"></div><div class="linha"></div></div>');
    var lista;
    try {
      var r = await pedir("/sessoes?dias=14");
      lista = (r.sessoes || []).filter(function (x) { return x.data === iso && x.concluida; });
    } catch (err) {
      if (folhaTitulo.textContent === titulo) folhaCorpo.innerHTML = '<div class="vazio"><p>' + esc(err.message) + "</p></div>";
      return;
    }
    // se voce fechou ou trocou de folha enquanto buscava, nao pisa nela
    if (!aberta() || folhaTitulo.textContent !== titulo) return;

    if (!lista.length) {
      folhaCorpo.innerHTML = '<div class="vazio" style="padding:30px 10px"><h3>Dia sem treino fechado</h3>' +
        "<p>Descanso também conta. Nada foi registrado aqui.</p></div>";
      return;
    }

    // mais antigo primeiro: le na ordem em que aconteceu
    lista.sort(function (a, b) { return String(a.criado_em).localeCompare(String(b.criado_em)); });
    var totKcal = lista.reduce(function (t, x) { return t + (Number(x.calorias) || 0); }, 0);
    var totMin = lista.reduce(function (t, x) { return t + (Number(x.duracao_min) || 0); }, 0);

    folhaCorpo.innerHTML = '<div class="tr-dia-topo">' +
        '<div><b class="tr-num">' + kcal(totKcal) + '</b><span>kcal</span></div>' +
        '<div><b class="tr-num">' + totMin + '</b><span>min</span></div>' +
        '<div><b class="tr-num">' + lista.length + "</b><span>" + (lista.length === 1 ? "registro" : "registros") + "</span></div>" +
      "</div>" +
      lista.map(blocoDoDia).join("");
  }

  function blocoDoDia(x) {
    var manual = x.origem === "manual";
    var nome = manual ? (((x.ficha || [])[0] || {}).nome || "Atividade")
      : x.origem === "extra" ? "Ficha extra" : "Ficha do dia";
    var meta = [(Number(x.duracao_min) || 0) + " min", x.esforco, kcal(x.calorias) + " kcal"].filter(Boolean).join(" · ");
    if (manual) {
      return '<section class="tr-dia-bloco avulsa"><h4>' + esc(nome) + '<small>avulsa</small></h4><p class="tr-dia-meta">' + meta + "</p>" +
        (x.observacao ? '<p class="tr-dia-obs">' + esc(x.observacao) + "</p>" : "") + "</section>";
    }
    var marcados = {};
    (x.feitos || []).forEach(function (f) { marcados[String(f)] = true; });
    var feitos = (x.ficha || []).filter(function (i) { return marcados[String(i.id)]; });
    var pulados = (x.ficha || []).length - feitos.length;
    var musculos = [];
    feitos.forEach(function (i) {
      (i.grupos || []).forEach(function (g) { if (musculos.indexOf(g) < 0) musculos.push(g); });
    });
    return '<section class="tr-dia-bloco' + (x.origem === "extra" ? " extra" : "") + '"><h4>' + esc(nome) + "</h4>" +
      '<p class="tr-dia-meta">' + meta + "</p>" +
      (musculos.length ? '<ul class="tr-musculos">' + musculos.map(function (g) { return "<li>" + esc(rotuloGrupo(g)) + "</li>"; }).join("") + "</ul>" : "") +
      '<ul class="tr-dia-lista">' + feitos.map(function (i) {
        return "<li><span>" + esc(i.nome) + '</span><b class="tr-num">' + textoSerie(i).replace(" x ", "×") + "</b></li>";
      }).join("") + "</ul>" +
      (pulados > 0 ? '<p class="tr-dia-pulados">' + pulados + (pulados === 1 ? " exercício pulado" : " exercícios pulados") + "</p>" : "") +
      (x.observacao ? '<p class="tr-dia-obs">' + esc(x.observacao) + "</p>" : "") +
      "</section>";
  }

  function conferirManual(r) {
    var d = r.rascunho || {};
    /* MET nao aparece: e numero interno, so serve pra conta. E a duracao ja vem
       resolvida, do que voce escreveu ou da duracao tipica da atividade.
       O que sobra pra voce e uma escolha: como foi. */
    var deOnde = { texto: "do que você escreveu", tipica: "típico dessa atividade",
      estimada: "estimado pela IA", chute: "estimativa padrão" }[d.duracao_fonte] || "estimado";
    abrir("Confira e salve", '' +
      '<div class="tr-tempo" id="aResumo">' +
        '<span><strong>' + esc(d.nome) + '</strong> · ' + esc(d.duracao_min) + ' min ' + deOnde + "</span>" +
        '<button class="tr-mini" id="aAjustar">ajustar</button>' +
      "</div>" +
      '<div id="aCampos" hidden>' +
        '<div class="tr-campo"><label>Atividade</label><input class="campo" id="aNome" value="' + esc(d.nome) + '"></div>' +
        '<div class="tr-dupla">' +
          '<div class="tr-campo"><label>Duração (min)</label><input class="campo" id="aDur" type="number" inputmode="numeric" value="' + esc(d.duracao_min || "") + '"></div>' +
          '<div class="tr-campo"><label>Intensidade (MET)</label><input class="campo" id="aMet" type="number" step="0.1" value="' + esc(d.met) + '"></div>' +
        "</div></div>" +
      '<div class="tr-campo"><label>Como foi</label>' +
        '<div class="tr-escolha" id="aEsforco">' +
          ["leve", "moderado", "pesado"].map(function (v) {
            return '<button data-valor="' + v + '" aria-pressed="' + (v === "moderado") + '">' + v + "</button>";
          }).join("") +
        "</div></div>" +
      '<button class="btn btn-largo" id="aSalvar">Salvar atividade</button>');

    var lerEsforco = ligarEscolha("#aEsforco");
    document.getElementById("aAjustar").addEventListener("click", function () {
      document.getElementById("aResumo").hidden = true;
      document.getElementById("aCampos").hidden = false;
      document.getElementById("aDur").focus();
    });

    document.getElementById("aSalvar").addEventListener("click", async function (e) {
      e.target.disabled = true;
      try {
        var res = await pedir("/manual", json("POST", {
          nome: document.getElementById("aNome").value,
          duracao_min: document.getElementById("aDur").value,
          met: document.getElementById("aMet").value,
          esforco: lerEsforco(),
        }));
        fechar(); mostrarResultado(res); carregar();
      } catch (err) { avisar(err.message); e.target.disabled = false; }
    });
  }

  function modalFechar(sessao) {
    var feitos = sessao.feitos || [];
    /* O tempo NAO e mais pergunta: sai da propria ficha, somando serie,
       descanso e transicao do que foi marcado. Fica visivel e ajustavel, pra
       quando o treino sair muito do roteiro, mas ninguem precisa responder. */
    var ehExtra = !!(S.dia && S.dia.extra && sessao.id === S.dia.extra.id);
    var estimado = (S.dia && (ehExtra ? S.dia.duracao_extra : S.dia.duracao_estimada)) || 0;
    abrir("Fechar o treino", '' +
      '<p class="tr-sub" style="margin-top:0">' + feitos.length + " de " + (sessao.ficha || []).length +
        ' exercícios marcados. O que não foi feito não conta, e tudo bem.</p>' +
      '<div class="tr-tempo" id="zTempo">' +
        '<span><strong>' + estimado + ' min</strong> estimados pela ficha</span>' +
        '<button class="tr-mini" id="zAjustar">ajustar</button>' +
      "</div>" +
      '<div class="tr-campo" id="zCampoDur" hidden><label>Quanto tempo durou (min)</label>' +
        '<input class="campo" id="zDur" type="number" inputmode="numeric" value="' + estimado + '"></div>' +
      '<div class="tr-campo"><label>Como foi</label>' +
        '<div class="tr-escolha" id="zEsforco">' +
          ["leve", "moderado", "pesado"].map(function (v) {
            return '<button data-valor="' + v + '" aria-pressed="' + (v === "moderado") + '">' + v + "</button>";
          }).join("") +
        "</div></div>" +
      '<div class="tr-campo"><label>Observação (opcional)</label>' +
        '<textarea class="campo" id="zObs" rows="2" placeholder="Ex: ombro incomodou no terceiro"></textarea></div>' +
      '<button class="btn btn-largo" id="zSalvar">Concluir treino</button>' +
      '<p class="tr-sub" style="margin-top:10px">Conclusão é definitiva: o número entra no ciclo.</p>');

    var lerEsforco = ligarEscolha("#zEsforco");
    var ajustarTempo = false;
    document.getElementById("zAjustar").addEventListener("click", function () {
      ajustarTempo = true;
      document.getElementById("zTempo").hidden = true;
      document.getElementById("zCampoDur").hidden = false;
      document.getElementById("zDur").focus();
    });

    document.getElementById("zSalvar").addEventListener("click", async function (e) {
      e.target.disabled = true; e.target.textContent = "Calculando...";
      try {
        var res = await pedir("/sessoes/" + sessao.id + "/concluir", json("POST", {
          feitos: feitos,
          // so manda quando voce abriu o ajuste; senao o servidor estima
          duracao_min: ajustarTempo ? document.getElementById("zDur").value : null,
          esforco: lerEsforco(),
          observacao: document.getElementById("zObs").value,
        }));
        fechar(); mostrarResultado(res); carregar();
      } catch (err) {
        avisar(err.message); e.target.disabled = false; e.target.textContent = "Concluir treino";
      }
    });
  }

  /* O parabens. Tudo aqui sai de numero calculado, nada de frase de modelo. */
  function mostrarResultado(res) {
    var c = res.calorias || {}, p = res.progresso || {};
    var comp = p.primeira ? "Primeiro treino do ciclo."
      : p.recorde ? "Recorde do ciclo."
      : p.diferenca_pct > 0 ? p.diferenca_pct + "% acima da sua média"
      : p.diferenca_pct < 0 ? Math.abs(p.diferenca_pct) + "% abaixo da sua média"
      : "Na média do ciclo.";

    abrir("Treino registrado", '' +
      '<div style="text-align:center;padding:10px 0 18px">' +
        '<div class="tr-numero">' + (c.total || 0) + ' <span>kcal</span></div>' +
        '<p class="tr-sub" style="margin:10px 0 0">' + esc(comp) + "</p>" +
      "</div>" +
      '<div class="tr-linhas">' +
        (c.percentual_do_dia != null
          ? '<div class="tr-linha"><span>Do seu gasto num dia parado</span><span>' + c.percentual_do_dia + "%</span></div>" : "") +
        (res.duracao
          ? '<div class="tr-linha"><span>Tempo' + (res.duracao.fonte === "estimada" ? " (estimado)" : "") +
            '</span><span>' + res.duracao.minutos + " min</span></div>" : "") +
        '<div class="tr-linha"><span>Treinos neste ciclo</span><span>' + (p.treinos_no_ciclo || 1) + "</span></div>" +
        (p.sequencia > 1 ? '<div class="tr-linha"><span>Dias seguidos</span><span>' + p.sequencia + "</span></div>" : "") +
        (p.pulados > 0 ? '<div class="tr-linha"><span>Exercícios pulados</span><span>' + p.pulados + "</span></div>" : "") +
      "</div>" +
      ((c.por_item || []).length
        ? '<p class="grupo-titulo" style="margin-top:18px">Por exercício</p><div class="tr-linhas">' +
          c.por_item.map(function (i) {
            return '<div class="tr-linha"><span>' + esc(i.nome) + "</span><span>" + i.calorias + " kcal</span></div>";
          }).join("") + "</div>"
        : "") +
      (c.aviso ? '<p class="tr-sub" style="margin-top:14px">' + esc(c.aviso) + "</p>" : "") +
      '<button class="btn btn-largo" id="rFechar" style="margin-top:18px">Fechar</button>');

    document.getElementById("rFechar").addEventListener("click", fechar);
  }

  /* ------------------------------------------------------------ painel */

  var DIA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];

  /* O panorama do ciclo. Aparece SEMPRE, inclusive zerado: painel que so
     surge depois do primeiro treino esconde a referencia justo de quem esta
     comecando.

     A faixa e uma barra por dia, altura proporcional ao maior dia do ciclo.
     Dia sem treino vira um tracinho: e o buraco que conta a historia. */
  function painelResumo(r) {
    if (!r) return "";
    var maior = r.maior_dia || 1;
    var numeros = [
      [kcal(r.calorias), "kcal no ciclo"],
      [r.treinos ? kcal(r.media_calorias) : "0", "kcal por treino"],
      [String(r.sequencia || 0), r.sequencia === 1 ? "dia seguido" : "dias seguidos"],
    ];
    return '<section class="tr-cartao tr-painel">' +
      "<h2>Últimos " + r.dias + " dias</h2>" +
      '<p class="tr-sub" style="margin:0">' +
        (r.treinos
          ? r.treinos + (r.treinos === 1 ? " treino, " : " treinos, ") + r.minutos + " min no total"
          : "Nenhum treino ainda neste ciclo.") +
      "</p>" +
      '<div class="tr-faixa">' +
        r.linha.map(function (d) {
          var alt = d.treinou ? Math.max(Math.round((d.calorias / maior) * 100), 12) : 0;
          var dia = new Date(d.data + "T12:00:00Z").getUTCDay();
          return '<button type="button" class="tr-barra-col' + (d.hoje ? " hoje" : "") + '" data-dia="' + d.data + '"' +
            ' aria-label="Ver o dia ' + d.data + (d.treinou ? ", " + d.calorias + " kcal" : ", sem treino") + '">' +
            '<div class="tr-barra-trilho"><div class="tr-barra' + (d.treinou ? "" : " vazia") +
              '" style="height:' + alt + '%"></div></div>' +
            "<span>" + DIA_CURTO[dia] + "</span></button>";
        }).join("") +
      "</div>" +
      '<div class="tr-numeros">' + numeros.map(function (n) {
        return "<div><b>" + n[0] + "</b><span>" + n[1] + "</span></div>";
      }).join("") + "</div></section>";
  }

  /* Podem existir DOIS botoes de atividade avulsa na mesma tela: um no cartao
     do dia e outro no cartao de gerar treino. Por isso data-manual e nao id:
     id repetido e HTML invalido e getElementById so enxerga o primeiro. */
  function ligarManual() {
    tela.querySelectorAll("[data-manual]").forEach(function (b) {
      b.addEventListener("click", modalManual);
    });
  }

  /* O que foi feito HOJE, ficha e avulsas juntas.
     Antes a tela mostrava so a ultima sessao criada: lancar uma corrida depois
     do treino escondia a ficha e o numero do dia virava so o da corrida. */
  function cartaoDoDia(t) {
    if (!t || !t.itens || !t.itens.length) return "";
    return '<section class="tr-cartao">' +
      '<div class="tr-treino-cab"><h2>Feito hoje</h2>' +
        '<span class="tr-conta"><b class="tr-num">' + kcal(t.calorias) + "</b> kcal</span></div>" +
      '<p class="tr-sub" style="margin:0">' + t.minutos + " min" +
        (t.itens.length > 1 ? " em " + t.itens.length + " registros" : "") + "</p>" +
      '<ul class="tr-registros">' +
        t.itens.map(function (i) {
          var avulsa = i.origem === "manual";
          return "<li>" +
            '<span class="ic' + (avulsa ? " avulsa" : "") + '">' + (avulsa ? ICONE.mais : ICONE.check) + "</span>" +
            '<span class="nome">' + esc(i.nome) + "<small>" + i.minutos + " min" + (avulsa ? ", avulsa" : "") + "</small></span>" +
            '<span class="kcal">' + kcal(i.calorias) + " kcal</span></li>";
        }).join("") +
      "</ul>" +
      '<div class="tr-acoes"><button class="btn btn-suave btn-largo" data-manual>Lançar outra atividade</button></div>' +
      "</section>";
  }

  /* Icones de traco, no mesmo desenho dos da barra. */
  /* O banco guarda sem acento; a tela mostra como se escreve. */
  var ROTULO_GRUPO = {
    peito: "peito", costas: "costas", ombro: "ombro", biceps: "bíceps", triceps: "tríceps",
    perna: "perna", gluteo: "glúteo", panturrilha: "panturrilha", abdomen: "abdômen",
    lombar: "lombar", cardio: "cardio", "corpo inteiro": "corpo inteiro",
  };
  function rotuloGrupo(g) { return ROTULO_GRUPO[g] || g; }

  var ICONE = {
    casa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
    academia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/></svg>',
    sem_equipamento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M5 10l7 1 7-1M12 11v4l-3 6M12 15l3 6"/></svg>',
    ar_livre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  /* ---------------------------------------------------- esqueleto e basal */

  /* Esqueleto no formato do que vai aparecer, pra tela nao pular quando o
     dado chega. "ficha" leva legenda porque o Gemini demora uns segundos e
     so a forma nao diz o que esta acontecendo. */
  function esqueleto(tipo) {
    var cartao = function (miolo) { return '<div class="esqueleto tr-esq">' + miolo + "</div>"; };
    var faixa = '<div class="tr-esq-faixa">' +
      [30, 60, 0, 45, 80, 20, 55, 0, 70, 40, 65, 0, 50, 35].map(function (h) {
        return '<i style="height:' + Math.max(h, 5) + '%"></i>';
      }).join("") + "</div>";
    var basal = cartao('<div class="linha curta"></div><div class="linha grande"></div><div class="linha"></div>');
    var painel = cartao('<div class="linha curta"></div>' + faixa + '<div class="linha"></div><div class="linha"></div>');
    var itens = [1, 2, 3, 4, 5].map(function () {
      return '<div class="tr-esq-item"><div class="quadro"></div><div><div class="linha"></div><div class="linha curta"></div></div></div>';
    }).join("");
    if (tipo === "ficha") {
      return '<p class="tr-esq-legenda">Montando seu treino…</p>' +
        cartao('<div class="linha grande"></div><div class="linha"></div><div class="linha curta" style="margin-bottom:18px"></div>' + itens);
    }
    return basal + painel + cartao('<div class="linha grande"></div>' + itens);
  }

  function kcal(n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); }

  var NOME_CAMPO = { peso: "peso", altura: "altura", nascimento: "data de nascimento", sexo: "sexo" };

  /* O gasto parado em destaque, e o que o treino soma em cima dele. Com
     treino feito hoje mostra o que somou; sem, mostra o que um treino medio
     seu costuma somar, que e o empurrao pra comecar. */
  function cartaoBasal(d) {
    var b = d && d.basal;
    if (!b) return "";
    if (!b.kcal) {
      var falta = (b.falta || []).map(function (f) { return NOME_CAMPO[f] || f; });
      return '<section class="tr-cartao tr-energia">' +
        "<h2>Seu gasto do dia</h2>" +
        '<p class="tr-sub">Falta ' + esc(falta.join(", ")) + " no perfil pra calcular quanto seu corpo gasta parado.</p>" +
        '<button class="btn btn-suave btn-largo" data-perfil>Completar perfil</button></section>';
    }

    var t = d.hoje_total || {};
    var r = d.resumo || {};
    var soma = 0, rotuloSoma = "", nota;
    var virgula = function (n) { return String(n).replace(".", ","); };
    if (t.calorias > 0) {
      soma = t.calorias;
      rotuloSoma = "de treino hoje";
      nota = b.hoje_pct != null ? "Hoje o treino somou " + virgula(b.hoje_pct) + "% ao que o corpo gasta parado." : "";
    } else if (r.media_calorias > 0) {
      soma = r.media_calorias;
      rotuloSoma = "no seu treino médio";
      nota = "Um treino seu costuma somar " + virgula(Math.round((r.media_calorias / b.kcal) * 1000) / 10) +
        "% ao dia. Falta o de hoje.";
    } else {
      nota = "Cada treino vira número em cima disso.";
    }
    return '<section class="tr-cartao tr-energia">' +
      "<h2>Seu gasto do dia</h2>" +
      '<div class="tr-energia-grade">' +
      '<div class="tr-energia-par">' +
        '<div><b class="tr-num" data-contar="' + b.kcal + '">' + kcal(b.kcal) + "</b><span>kcal com o corpo parado</span></div>" +
        (soma ? '<div class="soma"><b class="tr-num">+' + kcal(soma) + "</b><span>" + rotuloSoma + "</span></div>" : "") +
      "</div>" + mapaDoCorpo(d.musculos) + "</div>" +
      '<div class="tr-energia-barra" aria-hidden="true"><i style="flex:' + b.kcal + '"></i>' +
        (soma ? '<i class="soma" style="flex:' + soma + '"></i>' : "") + "</div>" +
      (nota ? '<p class="tr-energia-nota">' + nota + "</p>" : "") +
      "</section>";
  }

  /* ------------------------------------------------------- mapa do corpo */

  /* Faixas por series em 14 dias. Fixas, nao relativas: com escala relativa
     uma semana de um treino so deixaria o grupo dele vermelho vivo. O topo
     (25+) fica na faixa que costuma ser citada pra hipertrofia, 10 a 20
     series por semana por musculo. */
  var NIVEIS = [
    { ate: 0, rotulo: "nada" },
    { ate: 6.5, rotulo: "pouco" },
    { ate: 14.5, rotulo: "moderado" },
    { ate: 24.5, rotulo: "bom" },
    { ate: Infinity, rotulo: "alto" },
  ];
  function nivelDe(series) {
    for (var n = 0; n < NIVEIS.length; n++) if ((Number(series) || 0) <= NIVEIS[n].ate) return n;
    return NIVEIS.length - 1;
  }

  /* Os bonecos: formas simples, cada grupo uma peca separada por um respiro,
     como os mapas musculares de academia. O que nao e grupo (cabeca, mao,
     canela, pe) fica neutro. viewBox 60x132, espelhado em x=30. */
  function pecasFrente() {
    return [
      ["neutro", '<circle cx="30" cy="9" r="7"/>'],
      ["neutro", '<rect x="27" y="15" width="6" height="5" rx="2"/>'],
      ["ombro", '<ellipse cx="15.5" cy="25" rx="5.5" ry="5"/><ellipse cx="44.5" cy="25" rx="5.5" ry="5"/>'],
      ["peito", '<path d="M18.5 21.5h10.5v12c-4 2.5-8.5 2-10.5-1.5z"/><path d="M41.5 21.5H31v12c4 2.5 8.5 2 10.5-1.5z"/>'],
      ["biceps", '<rect x="8" y="31" width="7" height="14" rx="3.5"/><rect x="45" y="31" width="7" height="14" rx="3.5"/>'],
      ["neutro", '<rect x="6.5" y="46.5" width="6" height="16" rx="3"/><rect x="47.5" y="46.5" width="6" height="16" rx="3"/>'],
      ["abdomen", '<rect x="22" y="35.5" width="16" height="20" rx="4"/>'],
      ["neutro", '<rect x="21" y="57" width="18" height="7" rx="3"/>'],
      ["perna", '<rect x="20" y="65.5" width="9" height="28" rx="4.5"/><rect x="31" y="65.5" width="9" height="28" rx="4.5"/>'],
      ["neutro", '<rect x="21" y="95.5" width="7" height="25" rx="3.5"/><rect x="32" y="95.5" width="7" height="25" rx="3.5"/>'],
      ["neutro", '<ellipse cx="24" cy="124" rx="4.5" ry="2.5"/><ellipse cx="36" cy="124" rx="4.5" ry="2.5"/>'],
    ];
  }
  function pecasCostas() {
    return [
      ["neutro", '<circle cx="30" cy="9" r="7"/>'],
      ["neutro", '<rect x="27" y="15" width="6" height="5" rx="2"/>'],
      ["ombro", '<ellipse cx="15.5" cy="25" rx="5.5" ry="5"/><ellipse cx="44.5" cy="25" rx="5.5" ry="5"/>'],
      ["costas", '<path d="M19 21h22l-2 17.5c-5.5 3-12.5 3-18 0z"/>'],
      ["triceps", '<rect x="8" y="31" width="7" height="14" rx="3.5"/><rect x="45" y="31" width="7" height="14" rx="3.5"/>'],
      ["neutro", '<rect x="6.5" y="46.5" width="6" height="16" rx="3"/><rect x="47.5" y="46.5" width="6" height="16" rx="3"/>'],
      ["lombar", '<rect x="22" y="41" width="16" height="13" rx="3.5"/>'],
      ["gluteo", '<ellipse cx="25" cy="61" rx="5.5" ry="6"/><ellipse cx="35" cy="61" rx="5.5" ry="6"/>'],
      ["perna", '<rect x="20" y="68.5" width="9" height="24" rx="4.5"/><rect x="31" y="68.5" width="9" height="24" rx="4.5"/>'],
      ["panturrilha", '<rect x="21" y="94.5" width="7" height="18" rx="3.5"/><rect x="32" y="94.5" width="7" height="18" rx="3.5"/>'],
      ["neutro", '<rect x="21.5" y="114" width="6" height="7" rx="2.5"/><rect x="32.5" y="114" width="6" height="7" rx="2.5"/>'],
      ["neutro", '<ellipse cx="24" cy="124" rx="4.5" ry="2.5"/><ellipse cx="36" cy="124" rx="4.5" ry="2.5"/>'],
    ];
  }
  function boneco(pecas, m, rotulo) {
    return '<svg viewBox="0 0 60 132" aria-hidden="true" class="tr-boneco">' + pecas.map(function (p) {
      var cls = p[0] === "neutro" ? "neutro" : "m n" + nivelDe(m[p[0]]);
      return '<g class="' + cls + '"' + (p[0] === "neutro" ? "" : ' data-grupo="' + p[0] + '"') + ">" + p[1] + "</g>";
    }).join("") + "</svg><span>" + rotulo + "</span>";
  }

  /* Ao lado dos numeros do gasto. E um botao: tocar abre as series. */
  function mapaDoCorpo(m) {
    if (!m) return "";
    return '<button type="button" class="tr-mapa" data-corpo aria-label="Ver as séries de cada grupo nos últimos 14 dias">' +
      '<span class="tr-mapa-par"><span>' + boneco(pecasFrente(), m, "frente") + "</span>" +
      "<span>" + boneco(pecasCostas(), m, "costas") + "</span></span>" +
      '<span class="tr-mapa-escala" aria-hidden="true"><i class="n1"></i><i class="n2"></i><i class="n3"></i><i class="n4"></i></span>' +
      "</button>";
  }

  function modalMusculos() {
    var m = (S.dia && S.dia.musculos) || {};
    var grupos = Object.keys(m).sort(function (a, b) { return (m[b] || 0) - (m[a] || 0); });
    var maior = Math.max(25, grupos.length ? m[grupos[0]] : 0);
    abrir("Músculos nos últimos 14 dias", '' +
      '<div class="tr-mapa-grande">' +
        "<span>" + boneco(pecasFrente(), m, "frente") + "</span>" +
        "<span>" + boneco(pecasCostas(), m, "costas") + "</span>" +
      "</div>" +
      '<ul class="tr-musc-lista">' + grupos.map(function (g) {
        var v = m[g] || 0, n = nivelDe(v);
        return "<li><span class=\"nome\">" + esc(rotuloGrupo(g)) + "</span>" +
          '<span class="trilho"><i class="n' + n + '" style="width:' + Math.max(v ? 4 : 0, Math.round((v / maior) * 100)) + '%"></i></span>' +
          '<span class="val tr-num">' + String(v).replace(".", ",") + "</span>" +
          '<span class="niv">' + NIVEIS[n].rotulo + "</span></li>";
      }).join("") + "</ul>" +
      '<p class="tr-sub" style="margin-top:14px">Séries de treinos fechados nos últimos 14 dias. O músculo principal do exercício ' +
        "conta a série inteira, os secundários contam metade. Como referência, 20 a 40 séries em 14 dias por músculo " +
        "é a faixa que costuma ser citada pra ganho de massa. O mapa anda junto com os 14 dias: o que você treinou " +
        "há mais tempo vai esfriando sozinho.</p>");
  }

  /* Numero que sobe do zero na primeira abertura. Da vida a tela sem custar
     nada; quem pede menos movimento no sistema ve o numero final direto. */
  function contar() {
    var calmo = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    tela.querySelectorAll("[data-contar]").forEach(function (el) {
      var fim = Number(el.dataset.contar) || 0;
      if (calmo || !fim) return;
      var t0 = null;
      function passo(t) {
        if (t0 == null) t0 = t;
        var k = Math.min((t - t0) / 700, 1);
        el.textContent = kcal(fim * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(passo);
      }
      requestAnimationFrame(passo);
    });
  }

  /* O que vale pra toda pintura, depois que o html entrou. */
  function posPintura() {
    tela.querySelectorAll("[data-perfil]").forEach(function (b) {
      b.addEventListener("click", modalPerfil);
    });
    tela.querySelectorAll("[data-corpo]").forEach(function (b) {
      b.addEventListener("click", modalMusculos);
    });
    tela.querySelectorAll("[data-dia]").forEach(function (b) {
      b.addEventListener("click", function () { modalDia(b.dataset.dia); });
    });
    /* O anel nasce no valor de ANTES do toque e anda ate o novo no quadro
       seguinte. Como a tela e repintada a cada check, sem isso ele pularia. */
    var aneis = tela.querySelectorAll(".tr-anel-prog");
    if (aneis.length) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          aneis.forEach(function (a) { a.style.strokeDashoffset = a.dataset.alvo; });
        });
      });
    }
    S.acabou = null;
    if (S.primeira && !S.carregando && S.dia) {
      S.primeira = false;
      tela.classList.add("tr-entra");
      contar();
      setTimeout(function () { tela.classList.remove("tr-entra"); }, 700);
    }
  }

  /* ---------------------------------------------------------- local */

  /* Lista reserva: se o servidor ainda for o antigo, sem "locais" no /hoje,
     a tela nao quebra. */
  var LOCAIS_PADRAO = [
    { id: "casa", rotulo: "Em casa" }, { id: "academia", rotulo: "Academia" },
    { id: "sem_equipamento", rotulo: "Sem equipamento" }, { id: "ar_livre", rotulo: "Ao ar livre" },
  ];
  var DICA_LOCAL = {
    casa: "Ex: hoje só com os halteres",
    academia: "Ex: academia do prédio, só tem esteira e halteres",
    sem_equipamento: "Ex: quarto de hotel, pouco espaço",
    ar_livre: "Ex: praia, levei um elástico",
  };

  /* Os mesmos campos no "Gerar treino" e no "Gerar outra ficha". pre e o
     prefixo dos ids, pra os dois poderem existir sem colidir. semCasa some
     com o botao Em casa quando nao ha equipamento cadastrado. */
  function camposGeracao(pre, semCasa, semPedido) {
    var locais = ((S.dia && S.dia.locais) || LOCAIS_PADRAO).filter(function (l) {
      return !(semCasa && l.id === "casa");
    });
    var marcado = S.ultimoLocal && locais.some(function (l) { return l.id === S.ultimoLocal; })
      ? S.ultimoLocal
      // sem equipamento de casa, o chute mais seguro e peso do corpo
      : (semCasa ? "sem_equipamento" : locais[0].id);
    return '<div class="tr-campo"><label>Onde vai treinar</label>' +
        '<div class="tr-escolha tr-locais" id="' + pre + 'Locais">' +
        locais.map(function (l) {
          return '<button type="button" data-local="' + l.id + '" aria-pressed="' + (l.id === marcado) + '">' +
            (ICONE[l.id] || "") + "<span>" + esc(l.rotulo) + "</span></button>";
        }).join("") + "</div></div>" +
      '<div class="tr-opcionais">' +
        '<label class="tr-opcional"><span>Lugar</span>' +
          '<input id="' + pre + 'LocalTxt" autocomplete="off" placeholder="' + esc(DICA_LOCAL[marcado] || "") + '"></label>' +
        (semPedido ? "" : '<label class="tr-opcional"><span>Pedido</span>' +
          '<input id="' + pre + 'Pedido" autocomplete="off" placeholder="Ex: hoje tenho 30 minutos"></label>') +
      "</div>" +
      '<p class="tr-opcionais-nota">' + (semPedido ? "Opcional. Ajuda a IA a saber o que tem por perto." :
        "Os dois são opcionais e ajudam a acertar a ficha.") + "</p>";
  }

  /* Liga os botoes e devolve quem le os tres campos. raiz e a tela ou a folha. */
  function ligarGeracao(raiz, pre) {
    var botoes = raiz.querySelectorAll("#" + pre + "Locais button");
    var txt = raiz.querySelector("#" + pre + "LocalTxt");
    botoes.forEach(function (b) {
      b.addEventListener("click", function () {
        botoes.forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
        txt.placeholder = DICA_LOCAL[b.dataset.local] || "";
      });
    });
    return function () {
      var on = raiz.querySelector("#" + pre + 'Locais button[aria-pressed="true"]');
      return {
        local: on ? on.dataset.local : "casa",
        local_texto: txt.value.trim(),
        pedido: raiz.querySelector("#" + pre + "Pedido") ? raiz.querySelector("#" + pre + "Pedido").value.trim() : "",
      };
    };
  }

  /* "Gerar outra ficha" abre a folha com os campos, em vez de gerar direto:
     era ai que o pedido sumia, porque o campo nao existia nessa tela. */
  function modalRegerar() {
    abrir("Gerar outra ficha", '' +
      '<p class="tr-sub" style="margin-top:0">A atual vai como recusada, então a nova vem diferente.</p>' +
      camposGeracao("r", !(S.dia && S.dia.pode_gerar)) +
      '<button class="btn btn-largo" id="rGerar">Gerar outra</button>');
    var ler = ligarGeracao(folhaCorpo, "r");
    document.getElementById("rGerar").addEventListener("click", function () {
      var dados = ler();
      fechar();
      gerarFicha(dados);
    });
  }

  /* "3 x 10 min" em vez de "3 x 10" quando o exercicio e por tempo. */
  function textoSerie(i) {
    var m = Number(i.duracao_min);
    if (m > 0) {
      var t = m < 1 ? Math.round(m * 60) + "s" : (Math.round(m * 10) / 10) + " min";
      return i.series + " x " + t;
    }
    return i.series + " x " + esc(i.reps);
  }

  /* ------------------------------------------------------------- tela */

  function pintar() {
    pintarTela();
    posPintura();
  }

  function pintarTela() {
    var d = S.dia;
    if (S.carregando) { tela.innerHTML = esqueleto("dia"); return; }
    if (!d) return;

    if (!d.pronto) {
      tela.innerHTML = '<div class="vazio"><h3>Falta seu peso</h3>' +
        "<p>Sem ele a conta de calorias não acontece.</p>" +
        '<button class="btn" id="tPerfil" style="margin-top:14px">Preencher perfil</button></div>';
      document.getElementById("tPerfil").addEventListener("click", modalPerfil);
      return;
    }

    if (!d.pode_gerar && !d.pode_gerar_fora) {
      tela.innerHTML = '<div class="vazio"><h3>Cadastre seus equipamentos</h3>' +
        "<p>A ficha só consegue montar treino com o que você tem em casa.</p>" +
        '<button class="btn" id="tEquip" style="margin-top:14px">Cadastrar</button></div>';
      document.getElementById("tEquip").addEventListener("click", modalEquipamento);
      return;
    }

    var s = d.sessao;

    if (s && s.concluida) {
      tela.innerHTML = cartaoBasal(d) + painelResumo(d.resumo) + cartaoDoDia(d.hoje_total) + cartaoExtra(d);
      ligarSessoes();
      ligarManual();
      return;
    }

    if (!s) {
      var jaFez = d.hoje_total && d.hoje_total.itens && d.hoje_total.itens.length;
      var contexto = cartaoBasal(d) + painelResumo(d.resumo);
      if (d.extra) {
        tela.innerHTML = contexto + cartaoDoDia(d.hoje_total) + cartaoExtra(d);
        ligarSessoes();
        ligarManual();
        return;
      }
      tela.innerHTML = contexto + cartaoDoDia(d.hoje_total) + '<section class="tr-cartao">' +
        "<h2>" + (jaFez ? "Quer um treino também?" : "Montar o treino de hoje") + "</h2>" +
        '<p class="tr-sub">A ficha olha o que você treinou nos últimos 14 dias e puxa o que está parado há mais tempo.</p>' +
        camposGeracao("t", !d.pode_gerar) +
        (d.pode_gerar ? "" : '<p class="tr-sub">Sem equipamento de casa cadastrado. <button class="tr-mini" id="tEquip">cadastrar</button></p>') +
        '<div class="tr-acoes"><button class="btn btn-largo" id="tGerar">Gerar treino de hoje</button>' +
        (jaFez ? "" : '<button class="tr-link" data-manual>Lançar atividade que já fiz</button>') + "</div>" +
        "</section>";
      var lerGeracao = ligarGeracao(tela, "t");
      document.getElementById("tGerar").addEventListener("click", function () { gerarFicha(lerGeracao()); });
      var tEquip = document.getElementById("tEquip");
      if (tEquip) tEquip.addEventListener("click", modalEquipamento);
      ligarManual();
      return;
    }

    // ficha do dia aberta (e a extra, se por acaso tambem houver)
    tela.innerHTML = cartaoBasal(d) + painelResumo(d.resumo) + cartaoSessao(s, false) + cartaoExtra(d);
    ligarSessoes();
    ligarManual();
  }

  function cartaoExtra(d) { return d && d.extra ? cartaoSessao(d.extra, true) : ""; }

  /* O cartao de uma ficha aberta. extra muda titulo, tempo, selo e o botao de
     gerar outra; o resto (anel, lista, marcar, fechar) e o mesmo. */
  function cartaoSessao(s, extra) {
    var d = S.dia;
    var feitos = s.feitos || [];
    var ficha = s.ficha || [];
    var total = ficha.length || 1;

    /* Os musculos do dia, na ordem em que aparecem. E o resumo do rodizio:
       bate o olho e ve o que a ficha escolheu treinar. */
    var musculos = [];
    ficha.forEach(function (i) {
      (i.grupos || []).forEach(function (g) { if (musculos.indexOf(g) < 0) musculos.push(g); });
    });

    var R = 30, VOLTA = 2 * Math.PI * R;
    var agora = feitos.length / total;
    // o anel de cada ficha lembra de onde partiu; com duas na tela, cada uma anda a sua
    var de = S.anelDe && S.anelDe[s.id];
    var antes = S.primeira ? 0 : (de != null ? de : agora);
    var completo = feitos.length === ficha.length && ficha.length > 0;
    var titulo = extra ? (completo ? "Extra feita" : "Ficha extra") : (completo ? "Tudo feito" : "Treino de hoje");
    var minutos = extra ? d.duracao_extra : d.duracao_estimada;

    return '<section class="tr-cartao tr-sessao' + (completo ? " completo" : "") + (extra ? " tr-extra" : "") + '"' +
        ' data-sessao="' + (extra ? "extra" : "dia") + '">' +
      '<div class="tr-sessao-topo">' +
        '<div class="tr-anel" role="img" aria-label="' + feitos.length + " de " + ficha.length + ' exercícios feitos">' +
          '<svg viewBox="0 0 72 72" aria-hidden="true"><circle class="tr-anel-fundo" cx="36" cy="36" r="' + R + '"/>' +
            '<circle class="tr-anel-prog" cx="36" cy="36" r="' + R + '" stroke-dasharray="' + VOLTA.toFixed(2) + '"' +
            ' style="stroke-dashoffset:' + (VOLTA * (1 - antes)).toFixed(2) + '" data-alvo="' + (VOLTA * (1 - agora)).toFixed(2) + '"/></svg>' +
          '<span class="tr-num"><b>' + feitos.length + "</b>de " + ficha.length + "</span></div>" +
        '<div class="tr-sessao-cab"><h2>' + titulo + (extra ? '<span class="tr-selo tr-selo-extra">extra</span>' : "") + "</h2>" +
          '<p class="tr-tempo-vivo" data-tempo>' + textoTempo(feitos.length, minutos) + "</p></div>" +
      "</div>" +
      (musculos.length ? '<ul class="tr-musculos" aria-label="Músculos desta ficha">' + musculos.map(function (g) {
        return "<li>" + esc(rotuloGrupo(g)) + "</li>";
      }).join("") + "</ul>" : "") +
      (s.motivo ? '<p class="tr-motivo">' + esc(s.motivo) + "</p>" : "") +
      '<ol class="tr-lista">' + ficha.map(function (i, n) {
        var on = feitos.indexOf(i.id) >= 0;
        // a unidade encolhe pra dose caber na coluna sem espremer o nome
        var dose = textoSerie(i).replace(" x ", "×").replace(/(\d)\s?(min|s)$/, "$1<small>$2</small>");
        return '<li class="tr-ex' + (on ? " feito" : "") + (S.acabou === s.id + ":" + i.id ? " agora" : "") + '" data-ex="' + i.id + '"' +
          ' role="button" tabindex="0" aria-pressed="' + on + '" aria-label="Marcar ' + esc(i.nome) + '">' +
          '<span class="tr-check" aria-hidden="true">' +
            '<span class="tr-ordem">' + (n + 1) + "</span>" + ICONE.check + "</span>" +
          '<div class="tr-ex-txt">' +
            '<span class="tr-ex-nome">' + esc(i.nome) + "</span>" +
            '<span class="tr-ex-meta">' +
              (i.grupos || []).map(function (g) { return '<em>' + esc(rotuloGrupo(g)) + "</em>"; }).join("") +
              (i.equipamento_nome ? '<span class="tr-ex-equip">' + esc(i.equipamento_nome) + "</span>" : "") +
            "</span>" +
            (i.observacao ? '<span class="tr-ex-obs">' + esc(i.observacao) + "</span>" : "") +
          "</div>" +
          '<div class="tr-ex-dose"><b class="tr-num">' + dose + "</b>" +
            (i.descanso_s ? '<span class="tr-descanso">' + ICONE.relogio + i.descanso_s + "s</span>" : "") + "</div>" +
          "</li>";
      }).join("") + "</ol>" +
      '<div class="tr-acoes"><button class="btn btn-largo" data-fechar>Fechar treino</button>' +
      '<button class="tr-link" data-regerar>' + (extra ? "Gerar outra extra" : "Gerar outra ficha") + "</button></div>" +
      "</section>";
  }

  /* Liga os cartoes de ficha que estiverem na tela. Cada um sabe de qual
     sessao e pelo data-sessao, entao marcar na extra nunca mexe na do dia. */
  function ligarSessoes() {
    S.anelDe = null;
    tela.querySelectorAll("[data-sessao]").forEach(function (sec) {
      var extra = sec.dataset.sessao === "extra";
      var s = extra ? S.dia.extra : S.dia.sessao;
      if (!s) return;
      // a linha inteira marca: alvo grande pra mao suada no meio do treino
      sec.querySelectorAll("[data-ex]").forEach(function (li) {
        li.addEventListener("click", function () { alternar(s, li.dataset.ex); });
        // teclado: a linha e um botao, entao Enter e espaco marcam
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(s, li.dataset.ex); }
        });
      });
      sec.querySelector("[data-fechar]").addEventListener("click", function () { modalFechar(s); });
      sec.querySelector("[data-regerar]").addEventListener("click", function () {
        if (extra) modalManual("mais"); else modalRegerar();
      });
    });
  }

  function textoTempo(marcados, minutos) {
    if (!marcados) return "Toque em cada exercício quando terminar.";
    return "Uns " + (minutos || 0) + " min de treino até agora.";
  }

  /* O check e otimista: pinta na hora e salva depois. Esperar a rede pra
     marcar um exercicio, no meio do treino, e insuportavel. */
  async function alternar(sessao, id) {
    var feitos = (sessao.feitos || []).slice();
    var i = feitos.indexOf(id);
    if (i >= 0) feitos.splice(i, 1); else feitos.push(id);
    var extra = !!(S.dia.extra && sessao.id === S.dia.extra.id);
    S.anelDe = {};
    S.anelDe[sessao.id] = ((sessao.feitos || []).length) / ((sessao.ficha || []).length || 1);
    S.acabou = i >= 0 ? null : sessao.id + ":" + id;
    sessao.feitos = feitos;
    pintar();
    try {
      var r = await pedir("/sessoes/" + sessao.id + "/feitos", json("PUT", { feitos: feitos }));
      // o "Fechar treino" le daqui; antes ficava o valor de quando a tela abriu
      if (r && typeof r.duracao_estimada === "number") {
        if (extra) S.dia.duracao_extra = r.duracao_estimada; else S.dia.duracao_estimada = r.duracao_estimada;
        var vivo = tela.querySelector('[data-sessao="' + (extra ? "extra" : "dia") + '"] [data-tempo]');
        if (vivo) vivo.textContent = textoTempo((sessao.feitos || []).length, r.duracao_estimada);
      }
    } catch (err) { avisar("Não salvou a marcação: " + err.message); }
  }

  async function gerarFicha(dados) {
    dados = dados || { local: "casa", local_texto: "", pedido: "" };
    // lembra o local da sessao: quem pede outra ficha na praia continua na praia
    S.ultimoLocal = dados.local;
    tela.innerHTML = esqueleto("ficha");
    try {
      var r = await pedir("/ficha", json("POST", dados));
      if (r.descartados && r.descartados.length) {
        avisar("Ignorei " + r.descartados.length + " exercício(s) com aparelho que você não tem.");
      }
      await carregar();
    } catch (err) { avisar(err.message); carregar(); }
  }

  async function carregar() {
    try {
      S.dia = await pedir("/hoje");
      S.carregando = false;
      pintar();
      if (S.dia.ciclo_fechado) {
        avisar("Ciclo fechado: " + S.dia.ciclo_fechado.sessoes + " treinos viraram resumo.");
      }
      /* So abre sozinho quando NAO ha modal na tela e quando ainda nao
         perguntou nesta visita. Sem as duas guardas, salvar um equipamento
         faria o perfil pular na frente no meio do cadastro.

         A tela vazia ja tem botao pra abrir na mao, entao ninguem fica sem
         caminho por causa disso. */
      var livre = !aberta();
      if (livre && !S.dia.pronto && !jaPerguntou.perfil) {
        jaPerguntou.perfil = true;
        modalPerfil();
      } else if (livre && S.dia.pronto && S.dia.pesagem && S.dia.pesagem.pedir && !jaPerguntou.peso) {
        jaPerguntou.peso = true;
        modalPesagem();
      }
    } catch (err) {
      S.carregando = false;
      tela.innerHTML = '<div class="vazio"><h3>Não deu pra abrir</h3><p>' + esc(err.message) +
        (err.dica ? "<br>" + esc(err.dica) : "") + "</p></div>";
    }
  }

  document.getElementById("btnPerfil").addEventListener("click", modalPerfil);
  document.getElementById("btnEquipamentos").addEventListener("click", modalListaEquipamentos);

  var elData = document.getElementById("trData");
  if (elData) {
    try {
      elData.textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    } catch (e) {}
  }
  /* Mesmo comportamento do app: o titulo pequeno da barra aparece quando o
     grande sai de vista. */
  var barra = document.getElementById("barra");
  var rolou = false;
  window.addEventListener("scroll", function () {
    var agora = window.scrollY > 40;
    if (agora === rolou || !barra) return;
    rolou = agora;
    barra.classList.toggle("rolou", agora);
  }, { passive: true });

  // esqueleto na tela antes da primeira resposta chegar
  pintar();
  carregar();
})();

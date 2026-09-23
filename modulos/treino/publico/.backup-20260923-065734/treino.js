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

  function modalManual() {
    abrir("Lançar atividade", '' +
      '<p class="tr-sub" style="margin-top:0">Escreva do seu jeito. Caminhada, corrida e bike já têm gasto tabelado.</p>' +
      '<div class="tr-campo"><label>O que você fez</label>' +
        '<input class="campo" id="mTexto" placeholder="Ex: corri 35 min no parque" autofocus></div>' +
      '<button class="btn btn-largo" id="mAnalisar">Continuar</button>');

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
    var estimado = (S.dia && S.dia.duracao_estimada) || 0;
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
    return '<div class="tr-cartao">' +
      '<h2>Últimos ' + r.dias + " dias</h2>" +
      '<p class="tr-sub">' +
        (r.treinos
          ? r.treinos + (r.treinos === 1 ? " treino" : " treinos") + " · " + r.minutos + " min"
          : "Nenhum treino ainda neste ciclo.") +
      "</p>" +
      '<div class="tr-faixa">' +
        r.linha.map(function (d) {
          var alt = d.treinou ? Math.max(Math.round((d.calorias / maior) * 100), 12) : 0;
          var dia = new Date(d.data + "T12:00:00Z").getUTCDay();
          return '<div class="tr-barra-col' + (d.hoje ? " hoje" : "") + '" title="' +
            d.data + (d.treinou ? " · " + d.calorias + " kcal" : " · sem treino") + '">' +
            '<div class="tr-barra-trilho"><div class="tr-barra' + (d.treinou ? "" : " vazia") +
              '" style="height:' + alt + '%"></div></div>' +
            "<span>" + DIA_CURTO[dia] + "</span></div>";
        }).join("") +
      "</div>" +
      '<div class="tr-linhas">' +
        '<div class="tr-linha"><span>Calorias no ciclo</span><span>' + r.calorias + " kcal</span></div>" +
        (r.treinos ? '<div class="tr-linha"><span>Média por treino</span><span>' + r.media_calorias + " kcal</span></div>" : "") +
        (r.sequencia > 1 ? '<div class="tr-linha"><span>Dias seguidos</span><span>' + r.sequencia + "</span></div>" : "") +
      "</div></div>";
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
    var varias = t.itens.length > 1;
    return '<div class="tr-cartao">' +
      "<h2>Hoje</h2>" +
      '<p class="tr-sub">' + t.calorias + " kcal · " + t.minutos + " min" +
        (varias ? " · " + t.itens.length + " registros" : "") + "</p>" +
      '<div class="tr-linhas">' +
        t.itens.map(function (i) {
          return '<div class="tr-linha"><span>' + esc(i.nome) +
            (i.origem === "manual" ? ' <span class="tr-selo">avulsa</span>' : "") +
            "</span><span>" + i.calorias + " kcal · " + i.minutos + " min</span></div>";
        }).join("") +
      "</div>" +
      '<button class="btn btn-suave btn-largo" data-manual style="margin-top:14px">Lançar outra atividade</button>' +
      "</div>";
  }

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
      return '<div class="tr-cartao tr-basal">' +
        '<p class="tr-basal-rotulo">Quanto seu corpo gasta por dia</p>' +
        '<p class="tr-sub">Falta ' + esc(falta.join(", ")) + " no perfil pra calcular.</p>" +
        '<button class="btn btn-suave btn-largo" data-perfil>Completar perfil</button></div>';
    }

    var t = d.hoje_total || {};
    var r = d.resumo || {};
    var extra, soma = 0;
    if (t.calorias > 0) {
      soma = t.calorias;
      extra = '<strong>+<span data-contar="' + t.calorias + '">' + kcal(t.calorias) + "</span> kcal</strong>" +
        "<span>hoje com treino" + (b.hoje_pct != null ? ", " + b.hoje_pct + "% a mais no dia" : "") + "</span>";
    } else if (r.media_calorias > 0) {
      soma = r.media_calorias;
      var pct = Math.round((r.media_calorias / b.kcal) * 1000) / 10;
      extra = "<span>Seu treino médio soma</span><strong>+" + kcal(r.media_calorias) + " kcal</strong>" +
        "<span>(" + pct + "% a mais no dia)</span>";
    } else {
      extra = "<span>Cada treino vira número em cima disso. O primeiro começa a conta.</span>";
    }
    // a barra: basal cheio mais o que o treino somou, na mesma escala
    var total = b.kcal + soma;
    var base = Math.round((b.kcal / total) * 1000) / 10;
    return '<div class="tr-cartao tr-basal">' +
      '<p class="tr-basal-rotulo">Seu corpo gasta parado, por dia</p>' +
      '<div class="tr-basal-num"><span data-contar="' + b.kcal + '">' + kcal(b.kcal) + "</span> <span>kcal</span></div>" +
      '<div class="tr-basal-trilho"><div class="tr-basal-base" style="width:' + base + '%"></div>' +
        '<div class="tr-basal-soma" style="width:' + (soma ? 100 - base : 0) + '%"></div></div>' +
      '<div class="tr-basal-extra">' + extra + "</div></div>";
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
  function camposGeracao(pre, semCasa) {
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
            esc(l.rotulo) + "</button>";
        }).join("") + "</div></div>" +
      '<div class="tr-campo"><label>Detalhe o lugar ou o que tem (opcional)</label>' +
        '<input class="campo" id="' + pre + 'LocalTxt" placeholder="' + esc(DICA_LOCAL[marcado] || "") + '"></div>' +
      '<div class="tr-campo"><label>Algum pedido? (opcional)</label>' +
        '<input class="campo" id="' + pre + 'Pedido" placeholder="Ex: hoje tenho 30 minutos"></div>';
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
        pedido: raiz.querySelector("#" + pre + "Pedido").value.trim(),
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
      tela.innerHTML = cartaoBasal(d) + painelResumo(d.resumo) + cartaoDoDia(d.hoje_total);
      ligarManual();
      return;
    }

    if (!s) {
      var jaFez = d.hoje_total && d.hoje_total.itens && d.hoje_total.itens.length;
      tela.innerHTML = cartaoBasal(d) + painelResumo(d.resumo) + cartaoDoDia(d.hoje_total) + '<div class="tr-cartao">' +
        "<h2>" + (jaFez ? "Quer um treino também?" : "Sem treino hoje") + "</h2>" +
        '<p class="tr-sub">A ficha é montada olhando o que você treinou nos últimos 14 dias.</p>' +
        camposGeracao("t", !d.pode_gerar) +
        (d.pode_gerar ? "" : '<p class="tr-sub">Sem equipamento de casa cadastrado. <button class="tr-mini" id="tEquip">cadastrar</button></p>') +
        '<button class="btn btn-largo" id="tGerar">Gerar treino de hoje</button>' +
        '<button class="btn btn-suave btn-largo" data-manual style="margin-top:8px">Lançar atividade manual</button>' +
        "</div>";
      var lerGeracao = ligarGeracao(tela, "t");
      document.getElementById("tGerar").addEventListener("click", function () { gerarFicha(lerGeracao()); });
      var tEquip = document.getElementById("tEquip");
      if (tEquip) tEquip.addEventListener("click", modalEquipamento);
      ligarManual();
      return;
    }

    var feitos = s.feitos || [];
    tela.innerHTML = cartaoBasal(d) + painelResumo(d.resumo) + '<div class="tr-cartao">' +
      "<h2>Treino de hoje</h2>" +
      (s.motivo ? '<p class="tr-motivo">' + esc(s.motivo) + "</p>" : "") +
      (s.ficha || []).map(function (i) {
        var on = feitos.indexOf(i.id) >= 0;
        return '<div class="tr-item' + (on ? " feito" : "") + '">' +
          '<button class="tr-check" data-item="' + i.id + '" aria-pressed="' + on + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' +
          "</button>" +
          '<div class="tr-item-txt"><strong>' + esc(i.nome) + "</strong><span>" +
            textoSerie(i) + " · descanso " + i.descanso_s + "s · " + esc(i.equipamento_nome) +
            (i.observacao ? " · " + esc(i.observacao) : "") +
          "</span></div></div>";
      }).join("") +
      '<button class="btn btn-largo" id="tFechar" style="margin-top:16px">Fechar treino</button>' +
      '<button class="btn btn-suave btn-largo" id="tRegerar" style="margin-top:8px">Gerar outra ficha</button>' +
      "</div>";

    tela.querySelectorAll("[data-item]").forEach(function (b) {
      b.addEventListener("click", function () { alternar(s, b.dataset.item); });
    });
    document.getElementById("tFechar").addEventListener("click", function () { modalFechar(S.dia.sessao); });
    document.getElementById("tRegerar").addEventListener("click", modalRegerar);
    ligarManual();
  }

  /* O check e otimista: pinta na hora e salva depois. Esperar a rede pra
     marcar um exercicio, no meio do treino, e insuportavel. */
  async function alternar(sessao, id) {
    var feitos = (sessao.feitos || []).slice();
    var i = feitos.indexOf(id);
    if (i >= 0) feitos.splice(i, 1); else feitos.push(id);
    S.dia.sessao.feitos = feitos;
    pintar();
    try {
      var r = await pedir("/sessoes/" + sessao.id + "/feitos", json("PUT", { feitos: feitos }));
      // o "Fechar treino" le daqui; antes ficava o valor de quando a tela abriu
      if (r && typeof r.duracao_estimada === "number") S.dia.duracao_estimada = r.duracao_estimada;
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

  // esqueleto na tela antes da primeira resposta chegar
  pintar();
  carregar();
})();

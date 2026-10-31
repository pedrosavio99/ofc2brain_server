# Etapa 2: treino.js troca os dois bonecos pelo <mapa-corpo> (cartao do gasto e modal dos 14 dias).
JS_ARQ = "modulos/treino/publico/treino.js"

AJUDANTES = r'''  /* Mapa do corpo vivo: o <mapa-corpo> do vault (componentes/mapa-corpo.js).
     Cada grupo do app acende as regioes do desenho; a perna acende a coxa da frente e a de tras.
     O tom vem das mesmas faixas fixas de antes (nivelDe, 1 a 4): com intensidade = nivel / 4 o
     componente pinta o tom igual ao nivel. */
  var REGIOES_DO_GRUPO = {
    peito: ["peito"], costas: ["costas"], ombro: ["ombro"], biceps: ["biceps"], triceps: ["triceps"],
    perna: ["quadriceps", "posterior"], gluteo: ["gluteo"], panturrilha: ["panturrilha"],
    abdomen: ["abdomen"], lombar: ["lombar"]
  };
  function dadosDoMapa(m) {
    var saida = {};
    Object.keys(REGIOES_DO_GRUPO).forEach(function (g) {
      var n = nivelDe(m && m[g]);
      if (!n) return;
      REGIOES_DO_GRUPO[g].forEach(function (r) { saida[r] = Math.max(saida[r] || 0, n / 4); });
    });
    return saida;
  }
  /* No cartao o mapa e so desenho (inert): o toque cai no botao em volta, que abre o modal. */
  function mapaVivo(m, tamanho) {
    return '<mapa-corpo class="tr-mapa-corpo"' + (tamanho === "pequeno" ? ' inert aria-hidden="true"' : "") +
      ' dados="' + esc(JSON.stringify(dadosDoMapa(m))) + '"></mapa-corpo>';
  }
  /* No modal, tocar num musculo diz quantas series ele tem. */
  function ligarMapaDoModal() {
    var mapa = folhaCorpo.querySelector(".tr-mapa-grande mapa-corpo");
    var dica = folhaCorpo.querySelector(".tr-mapa-dica");
    if (!mapa || !dica) return;
    var m = (S.dia && S.dia.musculos) || {};
    mapa.addEventListener("musculo", function (e) {
      var d = e.detail || {};
      var grupo = null;
      Object.keys(REGIOES_DO_GRUPO).forEach(function (g) { if (REGIOES_DO_GRUPO[g].indexOf(d.musculo) >= 0) grupo = g; });
      if (!grupo) { dica.textContent = d.rotulo + ": o app não conta séries separadas nessa região."; return; }
      var v = m[grupo] || 0, n = nivelDe(v);
      dica.textContent = d.rotulo + ": " + (v ? String(v).replace(".", ",") + " séries (" + NIVEIS[n].rotulo + ")" : "nenhuma série") +
        " nos últimos 14 dias" + (grupo !== d.musculo ? ". Conta o grupo " + rotuloGrupo(grupo).toLowerCase() + " inteiro" : "") + ".";
    });
  }

'''

# 2a: as funcoes novas entram antes do mapaDoCorpo
trocar(JS_ARQ,
       "  /* Ao lado dos numeros do gasto. E um botao: tocar abre as series. */\n",
       AJUDANTES + "  /* Ao lado dos numeros do gasto. E um botao: tocar abre as series. */\n")

# 2b: cartao do gasto: os dois bonecos viram o mapa novo
trocar(JS_ARQ,
       "      '<span class=\"tr-mapa-par\"><span>' + boneco(pecasFrente(), m, \"frente\") + \"</span>\" +\n"
       "      \"<span>\" + boneco(pecasCostas(), m, \"costas\") + \"</span></span>\" +\n",
       "      mapaVivo(m, \"pequeno\") +\n")

# 2c: modal dos 14 dias: o mapa grande e a linha de dica
trocar(JS_ARQ,
       "      '<div class=\"tr-mapa-grande\">' +\n"
       "        \"<span>\" + boneco(pecasFrente(), m, \"frente\") + \"</span>\" +\n"
       "        \"<span>\" + boneco(pecasCostas(), m, \"costas\") + \"</span>\" +\n"
       "      \"</div>\" +\n",
       "      '<div class=\"tr-mapa-grande\">' + mapaVivo(m, \"grande\") + \"</div>\" +\n"
       "      '<p class=\"tr-sub tr-mapa-dica\" aria-live=\"polite\">Toque num músculo para ver as séries.</p>' +\n")

# 2d: depois de montar o modal, liga o toque no mapa
trocar(JS_ARQ,
       "esfriando sozinho.</p>\");\n  }\n",
       "esfriando sozinho.</p>\");\n    ligarMapaDoModal();\n  }\n")

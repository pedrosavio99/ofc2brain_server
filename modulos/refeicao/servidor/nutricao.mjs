/**
 * Contas de nutricao. Tudo PURO: recebe numero, devolve numero.
 *
 * A REGRA CENTRAL, na mesma linha do "o modelo nao decide o MET" do treino:
 * a IA diz QUANTO voce comeu (gramas) e O QUE e aquilo por 100 g. O total do
 * item quem calcula e esta funcao. Assim:
 *   - corrigir a porcao (150 g -> 250 g) refaz a conta na hora, sem IA;
 *   - o mesmo alimento na mesma porcao vale sempre o mesmo, entre dias;
 *   - o servidor recalcula tudo no salvar e nunca confia no total da tela.
 */

// Tipos de refeicao, na ordem do dia. A ordem e usada pra listar.
export const TIPOS = {
  cafe_da_manha: { rotulo: "Café da manhã", ordem: 1, faixa: [5, 10] },
  lanche_manha: { rotulo: "Lanche da manhã", ordem: 2, faixa: [10, 11] },
  almoco: { rotulo: "Almoço", ordem: 3, faixa: [11, 15] },
  lanche_tarde: { rotulo: "Lanche da tarde", ordem: 4, faixa: [15, 18] },
  jantar: { rotulo: "Jantar", ordem: 5, faixa: [18, 22] },
  ceia: { rotulo: "Ceia", ordem: 6, faixa: [22, 24] },
  outro: { rotulo: "Outro", ordem: 7, faixa: null },
};

/* Tamanho do prato. Serve pra ajustar rapido o que a IA SUPOS: trocar de M pra G
   multiplica os gramas estimados por 1.4/1.0. Quantidade que voce escreveu
   ("200 g", "2 ovos") nunca e mexida. Os fatores sao de marmita comum: P ~350 g,
   M ~500 g, G ~700 g. */
export const TAMANHOS = {
  pequena: { rotulo: "P", nome: "Pequena", fator: 0.7 },
  media: { rotulo: "M", nome: "Média", fator: 1 },
  grande: { rotulo: "G", nome: "Grande", fator: 1.4 },
};

export function tamanhoValido(t) {
  const k = String(t || "").toLowerCase().trim().replace("média", "media");
  return TAMANHOS[k] ? k : "media";
}

/** Tipo pelo horario, quando nem o texto nem a IA dizem. */
export function tipoPelaHora(hora) {
  const h = Number(hora);
  for (const [k, t] of Object.entries(TIPOS)) {
    if (t.faixa && h >= t.faixa[0] && h < t.faixa[1]) return k;
  }
  return "ceia"; // 0h-5h: fome da madrugada
}

export function tipoValido(t, hora) {
  const k = String(t || "").toLowerCase().trim();
  return TIPOS[k] ? k : tipoPelaHora(hora);
}

/* Faixas fisicas. Nada tem mais de 900 kcal em 100 g (oleo puro ~884); nenhum
   macro passa de 100 g em 100 g; porcao acima de 3 kg e erro de digitacao. */
export const LIMITES = { gramas: [1, 3000], kcal100: [0, 900], macro100: [0, 100] };

function dentro(v, [min, max], padrao) {
  const n = Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

const um = (n) => Math.round(n * 10) / 10;

/** kcal pelos macros (fatores de Atwater: 4 / 4 / 9). */
export function kcalPelosMacros(p, c, g) {
  return 4 * p + 4 * c + 9 * g;
}

/**
 * Valores por 100 g em forma. Puro.
 *
 * Modelo as vezes erra o kcal e acerta os macros, ou o contrario. Os dois
 * juntos se conferem: kcal ~ 4P + 4C + 9G. Divergindo muito, o item vai
 * marcado "conferir" em vez de passar calado com cara de certo. Com kcal
 * zerado e macros presentes, vale a conta dos macros.
 */
export function normalizarPor100(bruto = {}) {
  let p = dentro(bruto.proteina, LIMITES.macro100, 0);
  let c = dentro(bruto.carbo, LIMITES.macro100, 0);
  let g = dentro(bruto.gordura, LIMITES.macro100, 0);

  // p + c + g nao cabe em 100 g: escala pra caber, mantendo a proporcao
  const soma = p + c + g;
  if (soma > 100) { p = (p * 100) / soma; c = (c * 100) / soma; g = (g * 100) / soma; }

  const pelosMacros = kcalPelosMacros(p, c, g);
  let kcal = dentro(bruto.kcal, LIMITES.kcal100, 0);
  if (kcal === 0 && pelosMacros > 0) kcal = Math.min(pelosMacros, LIMITES.kcal100[1]);

  const diferenca = Math.abs(kcal - pelosMacros);
  // 25% e folga de fibra, alcool e arredondamento; 40 kcal evita falso alarme em alimento leve
  const divergente = pelosMacros > 0 && diferenca > 40 && diferenca / Math.max(kcal, pelosMacros) > 0.25;

  return {
    por100: { kcal: um(kcal), proteina: um(p), carbo: um(c), gordura: um(g) },
    divergente,
  };
}

/** Item com os totais calculados a partir de gramas e por100. Puro. */
export function calcularItem(item) {
  const gramas = Math.round(dentro(item.gramas, LIMITES.gramas, 100));
  const { por100, divergente } = normalizarPor100(item.por100 || {});
  const f = gramas / 100;
  return {
    nome: String(item.nome || "Item").trim().slice(0, 80) || "Item",
    gramas,
    // "texto" = voce disse a quantidade; "assumida" = porcao tipica escolhida pela IA
    porcao_fonte: item.porcao_fonte === "texto" ? "texto" : "assumida",
    medida: String(item.medida || "").trim().slice(0, 60),
    por100,
    kcal: Math.round(por100.kcal * f),
    proteina: um(por100.proteina * f),
    carbo: um(por100.carbo * f),
    gordura: um(por100.gordura * f),
    confianca: ["alta", "media", "baixa"].includes(item.confianca) ? item.confianca : "media",
    conferir: Boolean(item.conferir) || divergente || item.confianca === "baixa",
    observacao: String(item.observacao || "").trim().slice(0, 160),
  };
}

/** Soma de uma lista de itens (ou de refeicoes, que tem os mesmos campos). Puro. */
export function somar(lista) {
  const t = { kcal: 0, proteina: 0, carbo: 0, gordura: 0 };
  for (const x of lista || []) {
    t.kcal += Number(x.kcal) || 0;
    t.proteina += Number(x.proteina) || 0;
    t.carbo += Number(x.carbo) || 0;
    t.gordura += Number(x.gordura) || 0;
  }
  return { kcal: Math.round(t.kcal), proteina: um(t.proteina), carbo: um(t.carbo), gordura: um(t.gordura) };
}

/** Refeicao pronta pra salvar: itens recalculados e totais. Puro. */
export function montarRefeicao(bruta, hora) {
  const itens = (Array.isArray(bruta.itens) ? bruta.itens : []).slice(0, 30).map(calcularItem);
  const tipo = tipoValido(bruta.tipo, hora);
  return {
    tipo,
    rotulo: TIPOS[tipo].rotulo,
    ordem: TIPOS[tipo].ordem,
    tamanho: tamanhoValido(bruta.tamanho),
    texto: String(bruta.texto || "").trim().slice(0, 600),
    itens,
    totais: somar(itens),
  };
}

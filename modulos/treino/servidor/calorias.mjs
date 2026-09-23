/**
 * A conta de caloria do modulo TREINO.
 *
 * Tudo aqui e PURO: recebe numero, devolve numero. Nenhuma chamada de modelo,
 * nenhum banco. E de proposito.
 *
 * Por que nao pedir pro Gemini: o mesmo treino daria 180 kcal hoje e 320
 * amanha, e ai o numero para de servir de animo, porque voce nao confia nele.
 * Aqui o mesmo treino da sempre o mesmo numero, e treino melhor da numero
 * maior. A IA entra so pra ESCOLHER o MET de um exercicio novo, no cadastro
 * de equipamento; a conta continua sendo conta.
 *
 * Formula: kcal/min = MET x 3,5 x peso(kg) / 200. E a equacao padrao do
 * Compendium of Physical Activities.
 *
 * HONESTIDADE: estimativa sem medir batimento erra facil 20%. Serve pra
 * comparar semana com semana, nao pra fechar balanco calorico.
 */

/** Sem MET cadastrado, musculacao moderada. Conservador de proposito. */
export const MET_PADRAO = 4.0;

/* Esforco percebido calibra o MET dentro da faixa do exercicio. Musculacao
   vai de uns 3,5 a uns 6 conforme a intensidade, e quem sabe qual foi e voce.
   Aproveita um dado que voce ja ia dar no fim do treino. */
export const FATOR_ESFORCO = { leve: 0.85, moderado: 1.0, pesado: 1.18 };

export function fatorDoEsforco(esforco) {
  return FATOR_ESFORCO[String(esforco || "").toLowerCase()] ?? 1.0;
}

/** MET dentro de faixa plausivel. Protege de erro de digitacao no cadastro. */
export function metValido(met) {
  const n = Number(met);
  if (!Number.isFinite(n) || n <= 0) return MET_PADRAO;
  return Math.min(Math.max(n, 1), 20);
}

/**
 * Caloria de um bloco de exercicio.
 * @param {{met:number, minutos:number, pesoKg:number, esforco?:string}} p
 */
export function caloriasDoBloco({ met, minutos, pesoKg, esforco }) {
  const m = Number(minutos);
  const kg = Number(pesoKg);
  if (!(m > 0) || !(kg > 0)) return 0;
  const metFinal = metValido(met) * fatorDoEsforco(esforco);
  return (metFinal * 3.5 * kg / 200) * m;
}

/**
 * Quanto tempo um item da ficha tende a ocupar, em segundos.
 *
 * Serve de PESO pra repartir a duracao real entre os exercicios feitos.
 * Dividir a duracao igualmente seria errado: 4x12 com 90s de descanso demora
 * muito mais que 2x10 com 30s, e as calorias sairiam distorcidas.
 *
 * Os 40s por serie sao uma media de execucao; o que manda no resultado e a
 * PROPORCAO entre os itens, nao o valor absoluto, porque a duracao real que
 * voce cronometrou e que vai ser repartida.
 */
/**
 * O exercicio declara duracao propria? Puro. Devolve minutos ou null.
 *
 * Existe porque nem todo exercicio e serie e repeticao. Caminhada, esteira,
 * bike e prancha sao prescritos em TEMPO, e a ficha guarda isso no campo de
 * repeticoes ("30 min", "1h", "45s"). A conta por series ignorava esse texto e
 * estimava uma caminhada de meia hora em 3 minutos.
 */
export function minutosDoItem(item) {
  if (!item) return null;
  /* duracao_min pode chegar como texto ("10 min") quando o modelo erra o tipo.
     Antes o Number() virava NaN, caia no reps "10" sem unidade e a corrida de
     3x10 min era contada como 3 series de musculacao: uns 5 minutos. */
  const direto = paraMinutos(item.duracao_min, true);
  if (direto != null) return direto;
  // "10" solto so vira minuto quando o item se declara por tempo
  return paraMinutos(item.reps, item.medida === "tempo");
}

/* Le minutos de numero ou texto. Puro. semUnidadeEhMinuto decide o que fazer
   com "10" sozinho: na duracao e minuto, nas repeticoes e repeticao. */
export function paraMinutos(valor, semUnidadeEhMinuto = false) {
  if (valor == null || valor === "") return null;
  const teto = (n) => (Number.isFinite(n) && n > 0 ? Math.min(n, 300) : null);
  if (typeof valor === "number") return teto(valor);

  const t = String(valor).toLowerCase().replace(",", ".").trim();
  // "10:00" e "1:30" sao minuto:segundo
  const mmss = t.match(/^(\d{1,3}):([0-5]\d)$/);
  if (mmss) return teto(Number(mmss[1]) + Number(mmss[2]) / 60);
  // "1h", "1h30", "1 hora"
  const h = t.match(/(\d+(?:\.\d+)?)\s*h(?:oras?|rs?)?\s*(\d{1,2})?(?![a-z])/);
  if (h) return teto(Number(h[1]) * 60 + (h[2] ? Number(h[2]) : 0));
  // "10 min", "10min", "10m", "10'"; o lookahead barra "10 metros"
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:minutos?|mins?|m|')(?![a-z])/);
  if (m) return teto(Number(m[1]));
  // "45s", "45 seg"; o lookahead barra "10 series"
  const seg = t.match(/(\d+(?:\.\d+)?)\s*(?:segundos?|seg|s)(?![a-z])/);
  if (seg) return teto(Number(seg[1]) / 60);
  if (semUnidadeEhMinuto && /^\d+(?:\.\d+)?$/.test(t)) return teto(Number(t));
  return null;
}

export function pesoDeTempo(item) {
  const series = Math.max(Number(item && item.series) || 1, 1);
  const descanso = Math.max(Number(item && item.descanso_s) || 60, 0);

  /* Exercicio por tempo: o que manda e o tempo declarado, multiplicado pelas
     series, mais o descanso ENTRE elas (uma a menos que o numero de series). */
  const minutos = minutosDoItem(item);
  if (minutos != null) return series * minutos * 60 + Math.max(series - 1, 0) * descanso;

  return series * (40 + descanso);
}

const TRANSICAO_S = 75;

/**
 * Quanto tempo o treino marcado deve ter levado, em minutos. Puro.
 *
 * Sai da PROPRIA ficha: serie por serie, mais o descanso de cada uma. Nao
 * precisa de modelo nem de cronometro, e nao precisa perguntar.
 *
 * So conta o que foi marcado como feito, entao a estimativa acompanha o treino
 * de verdade: parou na metade, o tempo cai junto.
 *
 * Os 40s por serie sao uma media de execucao. Erra alguns minutos pra quem faz
 * serie muito longa ou muito curta, e por isso o numero continua editavel na
 * tela. Mas errar 5 minutos numa estimativa que ja erra 20% em caloria nao
 * muda nada, e perguntar a cada treino custa muito mais.
 */
export function duracaoEstimada(ficha, feitos) {
  const marcados = new Set((feitos || []).map(String));
  const itens = (ficha || []).filter((i) => i && marcados.has(String(i.id)));
  if (!itens.length) return 0;
  /* pesoDeTempo cobre serie + descanso. Falta o que acontece ENTRE exercicios:
     trocar anilha, ajustar banco, beber agua, achar o proximo. Sem isso a
     estimativa sai uns 20% abaixo do treino real. */
  const segundos = itens.reduce((t, i) => t + pesoDeTempo(i), 0) + itens.length * TRANSICAO_S;
  // arredonda pra 5 em 5: precisao falsa em estimativa so atrapalha
  return Math.max(5, Math.round(segundos / 60 / 5) * 5);
}

/** Idade em anos. Puro. */
export function idadeDe(nascimento, agora = new Date()) {
  if (!nascimento) return null;
  const n = new Date(nascimento);
  if (!Number.isFinite(n.getTime())) return null;
  let anos = agora.getUTCFullYear() - n.getUTCFullYear();
  const mes = agora.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && agora.getUTCDate() < n.getUTCDate())) anos--;
  return anos >= 0 && anos < 120 ? anos : null;
}

/**
 * Gasto basal pela Mifflin-St Jeor: o que voce queima parado, em 24h.
 *
 * NAO entra na caloria do treino. Serve de contexto: "250 kcal equivale a X%
 * do que voce gasta num dia sem sair da cama". Sozinho, 250 kcal nao diz nada
 * pra quem nao vive de contar caloria.
 *
 * Sem sexo cadastrado devolve null em vez de chutar: a diferenca entre as duas
 * formulas e de 166 kcal, e chutar daria um contexto errado com cara de certo.
 */
export function basalDiario({ sexo, pesoKg, alturaCm, idade }) {
  const kg = Number(pesoKg), cm = Number(alturaCm), an = Number(idade);
  if (!(kg > 0) || !(cm > 0) || !(an > 0) || (sexo !== "M" && sexo !== "F")) return null;
  const base = 10 * kg + 6.25 * cm - 5 * an;
  return Math.round(sexo === "M" ? base + 5 : base - 161);
}

/**
 * A caloria da sessao inteira.
 *
 * So conta o que foi marcado como FEITO. Treino cumprido pela metade vale
 * metade, e isso e o que torna o numero honesto.
 *
 * @param {{ficha:Array, feitos:Array, duracaoMin:number, esforco:string, perfil:object}} p
 * @returns {{total:number, porItem:Array, minutosContados:number, itensFeitos:number, aviso:string}}
 */
export function caloriasDaSessao({ ficha = [], feitos = [], duracaoMin, esforco, perfil = {} }) {
  const pesoKg = Number(perfil.peso_kg);
  const minutos = Number(duracaoMin);
  const vazio = { total: 0, porItem: [], minutosContados: 0, itensFeitos: 0, aviso: "" };

  if (!(pesoKg > 0)) return { ...vazio, aviso: "Sem peso no perfil nao da pra calcular caloria." };
  if (!(minutos > 0)) return { ...vazio, aviso: "Sem a duracao do treino nao da pra calcular caloria." };

  const marcados = new Set((feitos || []).map(String));
  const itens = (ficha || []).filter((i) => i && marcados.has(String(i.id)));

  /* Atividade manual nao tem ficha: e um bloco so, com o MET que veio junto.
     Sem este caminho, lancar "corri 30 min" daria zero. */
  if (!itens.length) {
    const met = (ficha && ficha.length) ? null : metValido(perfil.met_manual);
    if (met == null) {
      return { ...vazio, aviso: "Nenhum exercicio marcado como feito." };
    }
    const total = caloriasDoBloco({ met, minutos, pesoKg, esforco });
    return { total: Math.round(total), porItem: [], minutosContados: minutos, itensFeitos: 0, aviso: "" };
  }

  const pesos = itens.map(pesoDeTempo);
  const somaPesos = pesos.reduce((a, b) => a + b, 0) || itens.length;

  const porItem = itens.map((item, i) => {
    const min = minutos * (pesos[i] / somaPesos);
    const kcal = caloriasDoBloco({ met: item.met, minutos: min, pesoKg, esforco });
    return {
      id: item.id,
      nome: item.nome || "exercicio",
      met: metValido(item.met),
      minutos: Math.round(min * 10) / 10,
      calorias: Math.round(kcal),
    };
  });

  return {
    total: Math.round(porItem.reduce((a, b) => a + b.calorias, 0)),
    porItem,
    minutosContados: minutos,
    itensFeitos: itens.length,
    aviso: "",
  };
}

/**
 * Como a sessao de hoje se compara com o ciclo. Puro.
 *
 * O numero solto nao motiva: "391 kcal" nao diz nada pra quem nao conta
 * caloria. "391, acima da sua media" diz. E isso sai de conta, nao de frase
 * pronta de modelo.
 *
 * @param {Array} sessoes as ja concluidas do ciclo, SEM a de hoje
 * @param {number} caloriasHoje
 */
export function comparativoDoCiclo(sessoes, caloriasHoje) {
  const antes = (sessoes || []).filter((s) => s && s.concluida && Number(s.calorias) > 0);
  const base = {
    treinos_no_ciclo: antes.length + 1,
    media_anterior: null,
    diferenca_pct: null,
    recorde: false,
    sequencia: 0,
  };
  if (!antes.length) return { ...base, primeira: true };

  const soma = antes.reduce((t, s) => t + Number(s.calorias), 0);
  const media = Math.round(soma / antes.length);
  const maior = Math.max(...antes.map((s) => Number(s.calorias)));

  return {
    ...base,
    primeira: false,
    media_anterior: media,
    diferenca_pct: media > 0 ? Math.round(((caloriasHoje - media) / media) * 100) : null,
    recorde: caloriasHoje > maior,
    total_ciclo: soma + caloriasHoje,
  };
}

/**
 * Dias seguidos com treino concluido, contando de hoje pra tras. Puro.
 * Dia sem treino quebra a sequencia; e isso mesmo que a gente quer medir.
 */
export function sequenciaDeDias(sessoes, hojeISO) {
  const feitos = new Set((sessoes || []).filter((s) => s && s.concluida).map((s) => s.data));
  let n = 0;
  const dia = new Date(hojeISO + "T12:00:00Z");
  for (let i = 0; i < 400; i++) {
    const iso = new Date(dia.getTime() - i * 86400000).toISOString().slice(0, 10);
    if (!feitos.has(iso)) break;
    n++;
  }
  return n;
}

/**
 * O panorama do ciclo, pronto pra tela. Puro.
 *
 * Devolve UM dia por posicao, inclusive os sem treino: e isso que permite
 * desenhar a faixa de 14 dias com buraco onde nao treinou. Uma lista so das
 * sessoes nao mostraria os vazios, que sao justamente a informacao.
 *
 * @param {Array} sessoes as da janela
 * @param {string} hojeISO
 * @param {number} dias
 */
export function resumoDoCiclo(sessoes, hojeISO, dias = 14) {
  const porData = {};
  for (const s of sessoes || []) {
    if (!s || !s.concluida) continue;
    const d = porData[s.data] || { calorias: 0, minutos: 0, treinos: 0 };
    d.calorias += Number(s.calorias) || 0;
    d.minutos += Number(s.duracao_min) || 0;
    d.treinos += 1;
    porData[s.data] = d;
  }

  const base = new Date(hojeISO + "T12:00:00Z").getTime();
  const linha = [];
  for (let i = dias - 1; i >= 0; i--) {
    const iso = new Date(base - i * 86400000).toISOString().slice(0, 10);
    const d = porData[iso];
    linha.push({
      data: iso,
      treinou: !!d,
      calorias: d ? d.calorias : 0,
      minutos: d ? d.minutos : 0,
      hoje: i === 0,
    });
  }

  const treinos = linha.filter((d) => d.treinou).length;
  const calorias = linha.reduce((t, d) => t + d.calorias, 0);
  const minutos = linha.reduce((t, d) => t + d.minutos, 0);

  return {
    dias,
    treinos,
    calorias,
    minutos,
    // media por TREINO, nao por dia: dia parado nao derruba a media do esforco
    media_calorias: treinos ? Math.round(calorias / treinos) : 0,
    maior_dia: linha.reduce((m, d) => Math.max(m, d.calorias), 0),
    sequencia: sequenciaDeDias(sessoes, hojeISO),
    linha,
  };
}

/** Esforco em numero, pra dar pra tirar media. Puro. */
export function esforcoEmNumero(e) {
  return { leve: 1, moderado: 2, pesado: 3 }[String(e || "").toLowerCase()] || null;
}

/**
 * Agrupa sessoes VELHAS em ciclos de N dias. Puro.
 *
 * Sessao vive 14 dias e depois e podada; o que sobra e uma linha por ciclo.
 * Esta funcao decide onde cada linha comeca e o que ela resume.
 *
 * A ancora e a sessao mais antiga: o primeiro ciclo comeca no dia dela e vai
 * por N dias, o proximo comeca no dia seguinte, e assim por diante. Sem ancora
 * fixa, o mesmo periodo cairia em ciclos diferentes a cada execucao e o
 * historico ficaria incoerente.
 *
 * @param {Array} sessoes so as que JA saem da janela
 * @param {number} dias tamanho do ciclo
 */
export function agruparEmCiclos(sessoes, dias = 14) {
  const lista = (sessoes || []).filter((s) => s && s.data).slice()
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  if (!lista.length) return [];

  const ciclos = [];
  let inicio = lista[0].data;

  while (true) {
    const fim = new Date(new Date(inicio + "T12:00:00Z").getTime() + (dias - 1) * 86400000)
      .toISOString().slice(0, 10);
    const doCiclo = lista.filter((s) => s.data >= inicio && s.data <= fim);
    if (!doCiclo.length) break;

    const concluidas = doCiclo.filter((s) => s.concluida);
    const esforcos = concluidas.map((s) => esforcoEmNumero(s.esforco)).filter(Boolean);

    ciclos.push({
      inicio,
      fim,
      treinos: concluidas.length,
      minutos: concluidas.reduce((t, s) => t + (Number(s.duracao_min) || 0), 0),
      calorias: concluidas.reduce((t, s) => t + (Number(s.calorias) || 0), 0),
      esforco_medio: esforcos.length
        ? Math.round((esforcos.reduce((a, b) => a + b, 0) / esforcos.length) * 100) / 100
        : null,
      // pra quem le depois: quantas sessoes foram resumidas nesta linha
      sessoes_resumidas: doCiclo.length,
    });

    const proximo = new Date(new Date(fim + "T12:00:00Z").getTime() + 86400000)
      .toISOString().slice(0, 10);
    if (!lista.some((s) => s.data >= proximo)) break;
    inicio = proximo;
  }

  return ciclos;
}

/** Quanto a sessao representa do dia parado. Puro. null quando falta dado. */
export function percentualDoDia(calorias, basal) {
  if (!(basal > 0) || !(calorias > 0)) return null;
  return Math.round((calorias / basal) * 1000) / 10;
}

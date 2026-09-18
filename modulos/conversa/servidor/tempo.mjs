/**
 * Leitura de tempo no que a pessoa escreveu.
 *
 * A busca de notas e puramente semantica: ela compara o embedding da frase com
 * o das notas. "As notas de hoje" nao e parecida com nota nenhuma, porque
 * nota nenhuma fala sobre "hoje": elas falam de jiu-jitsu, de entrevista, de
 * gente. Pedido de data precisa virar FILTRO, nao busca.
 *
 * Tudo aqui e puro: recebe texto e a hora de agora, devolve uma janela. Da pra
 * testar sem banco e sem rede.
 *
 * FUSO: as notas sao gravadas em UTC (new Date().toISOString()). As 21h no
 * Brasil ja e o dia seguinte em UTC, entao calcular "hoje" em UTC erra tres
 * horas por dia. A janela e calculada no fuso local e convertida depois.
 */

const DIA_MS = 86400000;
const FUSO_MIN = Number(process.env.FUSO_MINUTOS ?? -180); // America/Sao_Paulo

/** Tira acento, pontuacao e caixa. Puro. */
export function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\/]+/g, " ")
    .trim();
}

/** Distancia de edicao, com corte: para cedo quando ja passou do limite. */
export function distancia(a, b, teto = 3) {
  const s = String(a), t = String(b);
  if (Math.abs(s.length - t.length) > teto) return teto + 1;
  let anteAnt = null;
  let ant = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= t.length; j++) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1] + 1, ant[j] + 1, ant[j - 1] + custo);
      /* Transposicao custa 1, nao 2 (Damerau). Letra trocada de lugar e o erro
         de digitacao mais comum: "ontme" por "ontem". Sem isto, a palavra de 5
         letras, que so tem folga 1, nunca casaria com a versao trocada. */
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        atual[j] = Math.min(atual[j], anteAnt[j - 2] + 1);
      }
      if (atual[j] < menor) menor = atual[j];
    }
    if (menor > teto) return teto + 1;
    anteAnt = ant;
    ant = atual;
  }
  return ant[t.length];
}

/* Folga por tamanho. Palavra curta com folga 2 casa qualquer coisa:
   "onde" viraria "ontem" e todo mundo perguntando "onde" ganharia filtro de
   data. Curta exige quase exato; longa pode errar duas letras. */
export function folgaDe(palavra) {
  const n = String(palavra).length;
  if (n <= 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

/* Palavras reais do portugues que caem perto de uma palavra de data e nao sao
   erro de digitacao de ninguem. Sem esta trava, "e ai home" viraria filtro de
   hoje, e "onde fica" viraria ontem. Lista curta de proposito: so entra aqui o
   que colidiu de verdade numa varredura, nao o que alguem imaginou que colide. */
const NUNCA_E_DATA = new Set(["home", "onde", "ondem"]);

/** A palavra bate com o alvo, aceitando digitacao torta? Puro. */
export function pertoDe(palavra, alvo) {
  if (palavra === alvo) return true;
  if (NUNCA_E_DATA.has(palavra)) return false;
  return distancia(palavra, alvo, folgaDe(alvo)) <= folgaDe(alvo);
}

/* Apelidos que NAO sao erro de digitacao, e sim como se escreve no chat.
   Estes batem exato: "hj" tem 2 letras e folga 0. */
const APELIDOS = {
  hj: "hoje", hoj: "hoje", oje: "hoje",
  ont: "ontem", ontm: "ontem",
  sem: null, // "sem" nunca e semana: aparece em "sem tempo", "sem nada"
};

/**
 * Numero do dia de calendario no fuso local. Serve pra dizer se duas datas sao
 * o mesmo dia, que e diferente de perguntar quantas horas se passaram: nota de
 * ontem as 20h tem 18 horas de idade e mesmo assim e de ontem.
 *
 * Mora aqui pra existir UM lugar que decide onde o dia comeca. Duas partes do
 * sistema com fusos diferentes discordariam sobre o que e "hoje". Puro.
 */
export function diaLocal(instante) {
  const t = instante instanceof Date ? instante.getTime() : new Date(instante).getTime();
  if (!Number.isFinite(t)) return NaN;
  return Math.floor((t + FUSO_MIN * 60000) / 86400000);
}

/** Data local (ano, mes, dia) do instante, no fuso configurado. Puro. */
function partesLocais(agora) {
  const deslocado = new Date(agora.getTime() + FUSO_MIN * 60000);
  return {
    ano: deslocado.getUTCFullYear(),
    mes: deslocado.getUTCMonth(),
    dia: deslocado.getUTCDate(),
    diaSemana: deslocado.getUTCDay(),
  };
}

/** Meia-noite local daquele dia, em ISO UTC. Puro. */
function inicioLocalISO(ano, mes, dia) {
  return new Date(Date.UTC(ano, mes, dia, 0, 0, 0) - FUSO_MIN * 60000).toISOString();
}

function janela(agora, diasAtras, duracaoDias, rotulo) {
  const p = partesLocais(agora);
  const desde = inicioLocalISO(p.ano, p.mes, p.dia - diasAtras);
  const ate = new Date(new Date(desde).getTime() + duracaoDias * DIA_MS).toISOString();
  return { desde, ate, rotulo };
}

/**
 * Acha uma janela de tempo no texto. Devolve null quando nao ha pedido de data.
 * @param {string} texto
 * @param {Date} [agora]
 * @returns {{desde:string, ate:string, rotulo:string, termos:string[]}|null}
 */
export function janelaDoTexto(texto, agora = new Date()) {
  const cru = normalizar(texto);
  if (!cru) return null;
  const tok = cru.split(" ").filter(Boolean);
  const p = partesLocais(agora);

  const achar = (alvo) => tok.findIndex((w) => (APELIDOS[w] ? APELIDOS[w] === alvo : pertoDe(w, alvo)));

  // 1. data escrita: 12/09, 12/09/2026
  const m = cru.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const dia = Number(m[1]), mes = Number(m[2]) - 1;
    let ano = m[3] ? Number(m[3]) : p.ano;
    if (ano < 100) ano += 2000;
    if (dia >= 1 && dia <= 31 && mes >= 0 && mes <= 11) {
      const desde = inicioLocalISO(ano, mes, dia);
      return { desde, ate: new Date(new Date(desde).getTime() + DIA_MS).toISOString(), rotulo: `dia ${m[1]}/${m[2]}`, termos: [m[0]] };
    }
  }

  // 2. "ha 3 dias", "ultimos 7 dias", "3 dias atras", "ultimas 2 semanas"
  const rel = cru.match(/\b(?:ha|faz|ultim[oa]s?|nos ultimos)?\s*(\d{1,3})\s*(dias?|semanas?|mes(?:es)?)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const unidade = rel[2].startsWith("dia") ? 1 : rel[2].startsWith("semana") ? 7 : 30;
    const dias = Math.min(n * unidade, 3650);
    return { ...janela(agora, dias, dias + 1, `últimos ${n} ${rel[2]}`), termos: [rel[0]] };
  }

  // 3. duas palavras. Vem antes das soltas: "semana passada" nao e "semana".
  const doisEm = (a, b) => {
    for (let i = 0; i < tok.length - 1; i++) {
      const x = APELIDOS[tok[i]] || tok[i];
      const y = APELIDOS[tok[i + 1]] || tok[i + 1];
      if (pertoDe(x, a) && pertoDe(y, b)) return tok[i] + " " + tok[i + 1];
    }
    return null;
  };

  let t;
  if ((t = doisEm("semana", "passada")) || (t = doisEm("semana", "retrasada"))) {
    const recuo = p.diaSemana + 7;                       // domingo da semana passada
    const retrasada = /retrasada/.test(t) ? 7 : 0;
    return { ...janela(agora, recuo + retrasada, 7, retrasada ? "semana retrasada" : "semana passada"), termos: [t] };
  }
  if ((t = doisEm("mes", "passado"))) {
    const desde = inicioLocalISO(p.ano, p.mes - 1, 1);
    return { desde, ate: inicioLocalISO(p.ano, p.mes, 1), rotulo: "mês passado", termos: [t] };
  }
  if ((t = doisEm("essa", "semana")) || (t = doisEm("esta", "semana")) || (t = doisEm("nessa", "semana"))) {
    return { ...janela(agora, p.diaSemana, p.diaSemana + 1, "esta semana"), termos: [t] };
  }
  if ((t = doisEm("esse", "mes")) || (t = doisEm("este", "mes")) || (t = doisEm("nesse", "mes"))) {
    const desde = inicioLocalISO(p.ano, p.mes, 1);
    return { desde, ate: new Date(agora.getTime() + DIA_MS).toISOString(), rotulo: "este mês", termos: [t] };
  }
  // "dia 12"
  const diaN = cru.match(/\bdia\s+(\d{1,2})\b/);
  if (diaN) {
    const dia = Number(diaN[1]);
    if (dia >= 1 && dia <= 31) {
      // dia que ainda nao chegou e do mes passado, nao do futuro
      const mes = dia > p.dia ? p.mes - 1 : p.mes;
      const desde = inicioLocalISO(p.ano, mes, dia);
      return { desde, ate: new Date(new Date(desde).getTime() + DIA_MS).toISOString(), rotulo: `dia ${dia}`, termos: [diaN[0]] };
    }
  }

  // 4. palavras soltas
  let i;
  if ((i = achar("anteontem")) >= 0) return { ...janela(agora, 2, 1, "anteontem"), termos: [tok[i]] };
  if ((i = achar("ontem")) >= 0) return { ...janela(agora, 1, 1, "ontem"), termos: [tok[i]] };
  if ((i = achar("hoje")) >= 0) return { ...janela(agora, 0, 1, "hoje"), termos: [tok[i]] };

  return null;
}

/* Palavras que sobram e nao dizem assunto nenhum. Sem esta lista, "as notas de
   hoje" pareceria ter tema ("notas") e cairia em busca semantica. */
const VAZIAS = new Set(
  ("a as o os um uma de do da dos das em no na nos nas e ou que qual quais oq " +
   "eu voce vc me mim meu minha teve tem ter foi eh e sobre pra para por com sem " +
   "nota notas anotacao anotacoes anotei escrevi salvei coisa coisas alguma algum " +
   "nada tudo mais menos ai la aqui agora entao blz ok po mano cara ne so").split(" ")
);

/**
 * O assunto que sobra depois de tirar a expressao de tempo e as palavras vazias.
 *
 * NAO decide se filtra por data: decide so a ORDEM dentro da janela, e so
 * quando o periodo tem mais notas do que cabe. Essa distincao importa: uma
 * lista de palavras vazias nunca vai cobrir tudo, e um resto de frase sem
 * sentido ("acheou delas") nao pode fazer o sistema abandonar o filtro de data
 * e voltar a buscar por semelhanca, que e exatamente o defeito que estamos
 * consertando. Tema ruim aqui so piora a ordem, nunca esconde nota. Puro.
 */
export function temaRestante(texto, janelaAchada) {
  const cru = normalizar(texto);
  let resto = cru;
  for (const t of (janelaAchada && janelaAchada.termos) || []) resto = resto.split(t).join(" ");
  const palavras = resto.split(" ").filter((w) => w && !VAZIAS.has(w) && w.length > 2);
  return palavras.join(" ").trim();
}

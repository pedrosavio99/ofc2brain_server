/**
 * Metas pessoais do TREINO: "correr 10 km", "mais ombro e peito".
 *
 * Tudo aqui e puro (sem banco, sem rede), entao da pra testar com numero
 * inventado. O banco fica no banco.mjs e a rota monta os dois.
 *
 * REGRA DE OURO, a mesma do resto do modulo: nada de estimativa passando por
 * dado. O progresso de uma meta so usa
 *   - o que voce DIGITOU (marcos: km corridos, centimetros...), ou
 *   - o que o app ja mede de verdade (series fechadas por grupo muscular).
 * Quando nao ha dado, o progresso diz "sem medida ainda" em vez de chutar.
 */
import { PRINCIPAIS } from "./grupos.mjs";

export const TIPOS_OBJETIVO = {
  corrida: { rotulo: "Correr", unidade: "km" },
  musculo: { rotulo: "Ganhar músculo", unidade: "" },
  outro: { rotulo: "Outra meta", unidade: "" },
};

/** Quantas metas abertas ao mesmo tempo. Mais que isso dilui a ficha. */
export const MAX_ATIVOS = 3;

/* Referencia de volume por grupo, por ciclo de 14 dias (~10 series por
   semana). E o minimo que a literatura de hipertrofia costuma apontar; serve
   de regua da barra, nao de promessa. A tela diz que e referencia. */
export const SERIES_ALVO_POR_GRUPO = 20;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function limpar(v, max) {
  return String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);
}

/* "" e null viram null; fora disso tem que ser numero dentro da faixa.
   Devolve NaN quando e invalido, pra quem chama dar a mensagem certa. */
function numero(v, min, max) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return NaN;
  return Math.round(n * 100) / 100;
}

function fmt(n) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function listaGrupos(grupos) {
  const g = grupos.slice();
  if (g.length <= 1) return g.join("");
  return g.slice(0, -1).join(", ") + " e " + g[g.length - 1];
}

function dataValida(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!ISO.test(s)) return NaN;
  return Number.isNaN(new Date(s + "T12:00:00Z").getTime()) ? NaN : s;
}

/**
 * Poe o que veio da tela em forma, ou diz o que esta errado. Puro.
 * `atual` e a meta ja salva, quando e edicao: o que nao veio mantem o que era.
 *
 * @returns {{ ok: true, valor: object } | { ok: false, erro: string }}
 */
export function normalizarObjetivo(entrada, atual = null) {
  const c = { ...(atual || {}), ...(entrada || {}) };
  const tipo = String(c.tipo || "");
  if (!TIPOS_OBJETIVO[tipo]) return { ok: false, erro: "Escolha o tipo da meta: correr, ganhar músculo ou outra." };

  const prazo = dataValida(c.prazo);
  if (Number.isNaN(prazo)) return { ok: false, erro: "Prazo inválido." };

  let grupos = [];
  let meta = null;
  let inicial = null;
  let unidade = "";

  if (tipo === "musculo") {
    const lista = Array.isArray(c.grupos) ? c.grupos : [];
    grupos = [...new Set(lista.map((g) => String(g).toLowerCase().trim()).filter((g) => PRINCIPAIS.includes(g)))].slice(0, 3);
    if (!grupos.length) return { ok: false, erro: "Escolha de 1 a 3 grupos musculares para a meta." };
  } else if (tipo === "corrida") {
    meta = numero(c.meta_valor, 0.5, 250);
    if (meta === null || Number.isNaN(meta)) return { ok: false, erro: "Diga a distância da meta em km (de 0,5 a 250)." };
    inicial = numero(c.valor_inicial, 0, 250);
    if (Number.isNaN(inicial)) return { ok: false, erro: "A distância de hoje precisa ser um número em km." };
    if (inicial !== null && inicial >= meta) return { ok: false, erro: "Você já corre essa distância. Aumente a meta." };
    unidade = "km";
  } else {
    meta = numero(c.meta_valor, -100000, 100000);
    if (Number.isNaN(meta)) return { ok: false, erro: "O alvo precisa ser um número." };
    inicial = numero(c.valor_inicial, -100000, 100000);
    if (Number.isNaN(inicial)) return { ok: false, erro: "O valor de partida precisa ser um número." };
    unidade = limpar(c.unidade, 12);
    if (meta !== null && !unidade) return { ok: false, erro: "Informe a unidade do alvo (kg, cm, reps...)." };
    if (meta === null) { inicial = null; unidade = ""; }
    if (meta !== null && inicial !== null && meta === inicial) return { ok: false, erro: "O alvo precisa ser diferente do valor de partida." };
  }

  let titulo = limpar(c.titulo, 80);
  if (!titulo) {
    if (tipo === "corrida") titulo = `Correr ${fmt(meta)} km`;
    else if (tipo === "musculo") titulo = `Ganhar ${listaGrupos(grupos)}`;
    else return { ok: false, erro: "Dê um nome para a meta." };
  }

  return { ok: true, valor: { titulo, tipo, grupos, meta_valor: meta, unidade, valor_inicial: inicial, prazo } };
}

function diasAte(prazo, hoje) {
  if (!prazo || !hoje) return null;
  return Math.round((new Date(String(prazo).slice(0, 10) + "T12:00:00Z").getTime()
    - new Date(hoje + "T12:00:00Z").getTime()) / 86400000);
}

/**
 * O progresso de UMA meta. Puro.
 *
 * ctx.seriesCiclo    series por grupo do ciclo atual (seriesPorGrupo)
 * ctx.cicloAnterior  ultimo ciclo fechado, com .grupos quando ja foi gravado
 * ctx.hoje           YYYY-MM-DD, pro prazo
 *
 * Tres formas, e a tela escolhe o desenho pelo "tipo" do retorno:
 *   volume  meta de musculo: series dos grupos contra a referencia
 *   medida  meta com alvo numerico: do ponto de partida ate o alvo
 *   livre   meta sem numero: so orienta a ficha
 */
export function progressoDoObjetivo(obj, marcos = [], ctx = {}) {
  const prazoDias = diasAte(obj.prazo, ctx.hoje);

  if (obj.tipo === "musculo") {
    const grupos = Array.isArray(obj.grupos) ? obj.grupos : [];
    const porGrupo = {};
    let series = 0;
    grupos.forEach((g) => {
      const v = Number((ctx.seriesCiclo || {})[g]) || 0;
      porGrupo[g] = v;
      series += v;
    });
    series = Math.round(series * 2) / 2;
    const alvo = SERIES_ALVO_POR_GRUPO * Math.max(1, grupos.length);

    // ciclo antigo, fechado antes da coluna existir, nao tem o dado: fica null
    let anterior = null;
    const gAnt = ctx.cicloAnterior && ctx.cicloAnterior.grupos;
    if (gAnt && typeof gAnt === "object" && Object.keys(gAnt).length) {
      anterior = Math.round(grupos.reduce((t, g) => t + (Number(gAnt[g]) || 0), 0) * 2) / 2;
    }
    return {
      tipo: "volume", series, alvo, por_grupo: porGrupo, anterior,
      pct: Math.min(100, Math.round((series / alvo) * 100)),
      atingido: series >= alvo, prazo_dias: prazoDias,
    };
  }

  if (obj.meta_valor != null && obj.meta_valor !== "") {
    const meta = Number(obj.meta_valor);
    const ordenados = (marcos || []).slice()
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
    const ultimo = ordenados[ordenados.length - 1] || null;
    const inicial = obj.valor_inicial != null && obj.valor_inicial !== ""
      ? Number(obj.valor_inicial)
      : (ordenados[0] ? Number(ordenados[0].valor) : null);
    const atual = ultimo ? Number(ultimo.valor) : inicial;

    const sobe = inicial === null ? true : meta >= inicial;
    let pct = 0;
    if (inicial !== null && atual !== null && meta !== inicial) {
      pct = Math.max(0, Math.min(100, Math.round(((atual - inicial) / (meta - inicial)) * 100)));
    }
    const atingido = atual !== null && (sobe ? atual >= meta : atual <= meta);
    return {
      tipo: "medida", inicial, atual, meta, unidade: obj.unidade || "",
      pct: atingido ? 100 : pct, atingido, sem_marco: atual === null,
      marcos: ordenados.slice(-8).map((m) => ({ valor: Number(m.valor), em: m.criado_em, nota: m.nota || "" })),
      total_marcos: ordenados.length, prazo_dias: prazoDias,
    };
  }

  return { tipo: "livre", prazo_dias: prazoDias };
}

/**
 * Junta metas, marcos e sessoes do ciclo em metas com progresso. Puro.
 * Mantem a ordem recebida (a mais antiga primeiro).
 */
export function montarObjetivos({ objetivos = [], marcos = [], seriesCiclo = {}, cicloAnterior = null, hoje = null } = {}) {
  const porMeta = new Map();
  for (const m of marcos || []) {
    const k = String(m.objetivo_id);
    if (!porMeta.has(k)) porMeta.set(k, []);
    porMeta.get(k).push(m);
  }
  return (objetivos || []).map((o) => ({
    ...o,
    progresso: progressoDoObjetivo(o, porMeta.get(String(o.id)) || [], { seriesCiclo, cicloAnterior, hoje }),
  }));
}

/* ---------------------------------------------------------- texto pro modelo */

function linhaDaMeta(o) {
  const p = o.progresso || {};
  const prazo = p.prazo_dias != null
    ? (p.prazo_dias >= 0 ? `, prazo em ${p.prazo_dias} dias` : ", prazo vencido")
    : "";
  if (o.tipo === "musculo") {
    const ant = p.anterior != null ? `; no ciclo anterior foram ${p.anterior}` : "";
    return `- ${o.titulo} [musculo: ${(o.grupos || []).join(", ")}]: ${p.series || 0} series nesses grupos neste ciclo (referencia ${p.alvo})${ant}${prazo}`;
  }
  if (p.tipo === "medida") {
    const hoje = p.atual == null ? "sem medida registrada ainda" : `hoje ${fmt(p.atual)} ${p.unidade}`;
    return `- ${o.titulo} [${o.tipo}]: ${hoje}, alvo ${fmt(p.meta)} ${p.unidade}${prazo}`;
  }
  return `- ${o.titulo} [${o.tipo}]${prazo}`;
}

/** As metas abertas como o modelo le na ficha do dia. Puro. */
export function blocoObjetivos(objetivos) {
  const lista = Array.isArray(objetivos) ? objetivos : [];
  if (!lista.length) return "";
  return "Metas dele (pesam na escolha, sem quebrar o rodizio):\n" + lista.map(linhaDaMeta).join("\n");
}

/** A meta que a ficha extra deve servir. Puro. */
export function blocoObjetivoFoco(obj) {
  if (!obj) return "";
  return "META EM FOCO, e o centro desta ficha:\n" + linhaDaMeta(obj);
}

/** Pedido em texto a partir da meta, pra ficha por regras e pro rotulo. Puro. */
export function pedidoDaMeta(obj) {
  if (!obj) return "";
  if (obj.tipo === "musculo") return `Quero treinar ${listaGrupos(obj.grupos || [])}, foco na minha meta`;
  if (obj.tipo === "corrida") return `Treino de corrida para chegar a ${fmt(obj.meta_valor)} km`;
  return `Treino para minha meta: ${obj.titulo}`;
}

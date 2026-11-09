/**
 * RADAR VIVO: o que faz o TrendRadar mudar sozinho, com dado REAL.
 *
 * Antes: 13 oportunidades escritas a mao no codigo, com metricas que nenhuma
 * coleta alimentava. Agora cada oportunidade tem um PULSO medido na imprensa
 * (Google Noticias, RSS gratuito e sem chave): quantas materias distintas nos
 * ultimos 7 dias contra os 7 dias anteriores, mais as manchetes de verdade.
 * O ranking passa a se mexer com isso, e o historico cresce a cada coleta.
 *
 * Alem do pulso, o radar DESCOBRE assuntos novos: varre manchetes recentes por
 * frente, e um modelo propoe oportunidades. Cada uma e ancorada em manchetes
 * reais (indices, nunca links escritos pelo modelo), entao nao ha como citar
 * fonte inventada.
 *
 * Neste arquivo: coletores de rede e funcoes PURAS (testaveis sem rede).
 */
import { chatJSONDetalhado } from "../../../src/groqClient.js";

const UA = "Mozilla/5.0 (compatible; SegundoCerebroRadar/1.0; uso pessoal)";
const DIA_MS = 86400000;

/* ------------------------------------------------------------------ RSS */

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

export function decodificar(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTIDADES[m] || m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</${nome}>`, "i"));
  return m ? m[1] : "";
}

/** RSS do Google Noticias -> [{titulo, fonte, url, data}]. Pura. */
export function parseRss(xml) {
  const out = [];
  const itens = String(xml || "").match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const b of itens) {
    let titulo = decodificar(tag(b, "title"));
    const fonte = decodificar(tag(b, "source"));
    const url = decodificar(tag(b, "link"));
    const t = Date.parse(decodificar(tag(b, "pubDate")));
    if (fonte && titulo.endsWith(" - " + fonte)) titulo = titulo.slice(0, -(fonte.length + 3)).trim();
    if (!titulo || !Number.isFinite(t)) continue;
    out.push({ titulo, fonte: fonte || "Google Notícias", url, data: new Date(t).toISOString() });
  }
  return out;
}

export function normalizarChave(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const STOP = new Set(["de", "da", "do", "das", "dos", "para", "com", "em", "na", "no", "nas", "nos", "por", "uma", "um", "que", "via", "sem"]);

/**
 * O Google Noticias casa palavras soltas: "gestao de eventos corporativos"
 * trouxe resumo de novela. Fica so a materia cujo TITULO tem pelo menos metade
 * dos termos significativos da busca (casando pelo radical, pra plural e
 * flexao). Pura.
 */
export function radicaisDe(termo) {
  return [...new Set(normalizarChave(termo).split(" ").filter((t) => t.length >= 3 && !STOP.has(t)).map((t) => t.slice(0, Math.min(t.length, 5))))];
}

/** Dois conjuntos de radicais falam do mesmo assunto? Sobreposicao sobre o menor, minimo 3 em comum. Puro. */
export function assuntoParecido(a, b) {
  if (!a.length || !b.length) return false;
  const B = new Set(b);
  const comum = a.filter((x) => B.has(x)).length;
  return comum >= 3 && comum / Math.min(a.length, b.length) >= 0.75;
}

export function filtrarRelevantes(itens, termo) {
  const radicais = radicaisDe(termo);
  if (!radicais.length) return itens;
  const exigidos = Math.max(1, Math.ceil(radicais.length / 2));
  return itens.filter((n) => {
    const t = normalizarChave(n.titulo);
    return radicais.filter((r) => t.includes(r)).length >= exigidos;
  });
}

/**
 * Buscas de imprensa por oportunidade. O `termoBusca` da semente e uma frase
 * longa ("automacao whatsapp clinica medica") e o Google Noticias exige todas as
 * palavras: voltava 0 a 1 materia. Aqui cada oportunidade tem 2 buscas curtas e
 * amplas, que acompanham o ASSUNTO e nao a frase exata do produto.
 * Itens sem entrada (os que voce pesquisa) usam o proprio termo.
 */
export const TERMOS_IMPRENSA = {
  "tr-agentes-whatsapp-clinicas": ["atendimento WhatsApp clínicas", "agendamento consultas inteligência artificial clínica"],
  "tr-auditoria-glosas-medicas-tiss": ["glosas médicas convênios", "TISS ANS faturamento clínicas"],
  "tr-conciliacao-taxas-marketplaces": ["taxas marketplace lojistas", "Mercado Livre Shopee vendedores taxas"],
  "tr-simulador-reforma-tributaria-ibs-cbs": ["reforma tributária IBS CBS empresas", "split payment reforma tributária"],
  "tr-regua-recuperacao-pix-inadimplencia": ["inadimplência empresas Pix", "Pix Automático cobrança"],
  "tr-conformidade-nr1-riscos-psicossociais": ["NR-1 riscos psicossociais", "NR-1 saúde mental empresas"],
  "tr-auditoria-ponto-passivo-trabalhista": ["passivo trabalhista horas extras", "controle de ponto empresas TST"],
  "tr-copiloto-licitacoes-pncp": ["licitações PNCP", "nova lei de licitações fornecedores"],
  "tr-monitor-diarios-oficiais-licencas": ["licença ambiental diário oficial", "alvará licenciamento empresas"],
  "tr-diario-obra-audio-foto-construtoras": ["gestão de obras construtoras", "diário de obra"],
  "tr-gestao-pmoc-manutencao-climatizacao-solar": ["PMOC ar condicionado", "manutenção usina solar"],
  "tr-gateway-observabilidade-lgpd-llm": ["LGPD inteligência artificial empresas", "custo LLM empresas agentes de IA"],
  "tr-hype-wrapper-generico-pdf": ["chat com PDF IA", "ferramentas de IA para estudantes"],
};

export function termosDoItem(item) {
  return TERMOS_IMPRENSA[item.id] || [item.termoBusca || item.nome].filter(Boolean);
}

/**
 * Pulso de UM item: roda as buscas curtas, filtra o ruido de cada uma pelo
 * proprio termo, junta e conta as janelas. Nunca lanca por busca individual.
 */
export async function pulsoDoItem(item, agora = new Date(), buscar = buscarNoticias) {
  const termos = termosDoItem(item);
  const listas = await Promise.all(termos.map((t) => buscar(t, { dias: 14 }).then((n) => filtrarRelevantes(n, t), () => null)));
  if (listas.every((l) => l === null)) throw new Error("Google Notícias não respondeu");
  return contarJanelas(listas.filter(Boolean).flat(), agora, [item.termoBusca, item.nome, ...termos].filter(Boolean).join(" "));
}

/** Mesma materia replicada por varios portais conta UMA vez. Pura. */
export function dedupePorTitulo(itens) {
  const vistos = new Set();
  const out = [];
  for (const it of itens) {
    const k = normalizarChave(it.titulo).slice(0, 70);
    if (!k || vistos.has(k)) continue;
    vistos.add(k); out.push(it);
  }
  return out;
}

/* ----------------------------------------------------------- coletores */

export async function buscarNoticias(consulta, { dias = 14, timeoutMs = 9000, fetchImpl = fetch } = {}) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(`${consulta} when:${dias}d`) +
    "&hl=pt-BR&gl=BR&ceid=BR:pt-419";
  const ctrl = new AbortController();
  const rel = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml,text/xml" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Google Notícias respondeu ${r.status}`);
    return parseRss(await r.text());
  } finally { clearTimeout(rel); }
}

/** Roda `fn` sobre a lista com no maximo `n` em paralelo. Nunca lanca: erro vira { erro }. */
export async function emLotes(lista, n, fn) {
  const resultados = new Array(lista.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) {
      const k = i++;
      try { resultados[k] = { ok: true, valor: await fn(lista[k], k) }; }
      catch (e) { resultados[k] = { ok: false, erro: e.message }; }
    }
  }));
  return resultados;
}

/* --------------------------------------------------------------- pulso */

/**
 * Conta materias distintas: ultimos 7 dias x 7 dias anteriores. Pura.
 * @returns {{sete:number, anteriores:number, manchetes:object[]}}
 */
export function contarJanelas(itens, agora = new Date(), preferir = "") {
  const t = agora.getTime();
  const unicos = dedupePorTitulo([...itens].sort((a, b) => b.data.localeCompare(a.data)));
  const recentes = unicos.filter((n) => Date.parse(n.data) >= t - 7 * DIA_MS && Date.parse(n.data) <= t + DIA_MS);
  const antes = unicos.filter((n) => { const d = Date.parse(n.data); return d < t - 7 * DIA_MS && d >= t - 14 * DIA_MS; });
  /* As manchetes de EXEMPLO sao as mais pertinentes ao assunto (mais radicais do
     produto no titulo), e so depois as mais novas: "Clinica-Escola abre vagas"
     nao e prova de demanda por WhatsApp pra clinicas. */
  const radicais = radicaisDe(preferir);
  const pertinencia = (n) => { const t = normalizarChave(n.titulo); return radicais.filter((r) => t.includes(r)).length; };
  const exemplos = radicais.length ? [...recentes].sort((a, b) => pertinencia(b) - pertinencia(a) || b.data.localeCompare(a.data)) : recentes;
  return {
    sete: recentes.length,
    anteriores: antes.length,
    manchetes: exemplos.slice(0, 3).map((n) => ({ titulo: n.titulo, fonte: n.fonte, url: n.url, data: n.data.slice(0, 10) })),
  };
}

/**
 * Estado do pulso. Pouco dado = "sem_dado" (nunca finge tendencia). Pura.
 * @returns {{estado:'subindo'|'esfriando'|'estavel'|'sem_dado', variacaoPct:number|null, sete:number, anteriores:number}}
 */
export function estadoDoPulso({ sete = 0, anteriores = 0 } = {}) {
  if (sete + anteriores < 4) return { estado: "sem_dado", variacaoPct: null, sete, anteriores };
  const variacaoPct = anteriores === 0 ? (sete >= 3 ? 100 : 0) : Math.round(((sete - anteriores) / anteriores) * 100);
  let estado = "estavel";
  if (variacaoPct >= 35 && sete >= 3) estado = "subindo";
  else if (variacaoPct <= -35 && anteriores >= 3) estado = "esfriando";
  return { estado, variacaoPct, sete, anteriores };
}

/** 0..100: 50 e neutro; sobe com variacao positiva e com volume. Pura. */
export function momentumScore({ variacaoPct, sete }) {
  if (variacaoPct == null) return null;
  const v = Math.max(-35, Math.min(35, variacaoPct / 3));
  const vol = Math.min(15, sete);
  return Math.max(0, Math.min(100, Math.round(50 + v + vol / 2)));
}

/**
 * A pontuacao "viva": a tese editorial (base) pesa 65%, o pulso medido 35%.
 * Sem dado do pulso, fica a base. Pura.
 */
export function pontuacaoViva(base, pulso) {
  const b = Number.isFinite(Number(base)) ? Number(base) : 50;
  const m = pulso ? momentumScore(pulso) : null;
  return m == null ? Math.round(b) : Math.max(0, Math.min(100, Math.round(b * 0.65 + m * 0.35)));
}

/**
 * Cola o pulso nos itens: `pulso`, `pontuacaoViva` e `historicoPulso` (dias
 * reais de coleta). Nao muda o item original. Pura.
 * @param {object[]} itens
 * @param {Map<string, object[]>} porItem  item_id -> linhas de radar_pulso (qualquer ordem)
 */
export function enriquecerComPulso(itens, porItem) {
  return itens.map((it) => {
    const linhas = [...((porItem && porItem.get(it.id)) || [])].sort((a, b) => String(a.dia).localeCompare(String(b.dia)));
    const ultima = linhas[linhas.length - 1];
    if (!ultima) return { ...it, pontuacaoViva: Math.round(Number(it.pontuacao) || 50), pulso: null, historicoPulso: [] };
    const e = estadoDoPulso({ sete: ultima.mencoes_7d, anteriores: ultima.mencoes_prev_7d });
    const pulso = { ...e, dia: String(ultima.dia).slice(0, 10), manchetes: ultima.manchetes || [] };
    return {
      ...it,
      pulso,
      pontuacaoViva: pontuacaoViva(it.pontuacao, pulso),
      historicoPulso: linhas.slice(-14).map((l) => ({ data: String(l.dia).slice(0, 10), valor: l.mencoes_7d })),
    };
  });
}

/* ------------------------------------------------------------ descoberta */

export const FRENTES = ["saude", "fintech", "regtech", "govtech", "operacoes", "ia_devtools"];

/* Buscas por frente: dores, prazos e mudancas de regra que viram software. */
export const CONSULTAS_FRENTE = {
  saude: ["clínicas glosa convênio prejuízo", "clínica agendamento WhatsApp pacientes", "ANS nova regra operadoras planos"],
  fintech: ["reforma tributária IBS CBS empresas adaptação", "lojistas marketplace taxas e-commerce", "Pix cobrança inadimplência empresas"],
  regtech: ["NR-1 riscos psicossociais empresas", "eSocial nova obrigação empresas", "LGPD multa ANPD empresas"],
  govtech: ["licitações PNCP nova lei empresas fornecedores", "prefeitura alvará licença burocracia empresas", "cartórios regulamentação digital prazo"],
  operacoes: ["construtoras atraso obras gestão", "manutenção ar condicionado PMOC obrigação", "energia solar manutenção empresas"],
  ia_devtools: ["agentes de IA empresas falha produção", "custo LLM tokens empresas brasileiras", "governança IA LGPD empresas"],
};

/**
 * Resposta do modelo -> descobertas limpas e ANCORADAS. Pura.
 * Os links vem de `manchetes` pelos indices; o modelo nunca escreve URL.
 * @param {any} bruto  { descobertas: [{titulo, frente, termo, dor, porque_agora, indices}] }
 * @param {{titulo,fonte,url,data}[]} manchetes  lista indexada a partir de 1
 * @param {Set<string>} chavesExistentes  chaves ja conhecidas (nao repetir)
 */
/* Redes sociais e afins nao sao fonte de mercado B2B. */
const RE_NAO_B2B = /pessoa f[ií]sica|benefici[aá]ri|cidad[aã]|consumidor|aposentad|usu[aá]rios? final|brasileiros|segurad[oa]s?\b|pacientes?\b|eleitor|torcedor/i;
const FONTES_FRACAS = /instagram|facebook|youtube|tiktok|kwai|twitter|^x$|pinterest|reddit|whatsapp/i;

export function sanearDescobertas(bruto, manchetes, chavesExistentes = new Set()) {
  const lista = Array.isArray(bruto && bruto.descobertas) ? bruto.descobertas : [];
  /* O modelo as vezes escreve "(manchete 4)" no texto: isso e indice interno, nao pra tela. */
  const limpa = (v, max) => String(v || "").replace(/\s+/g, " ").replace(/\s*—\s*/g, ", ")
    .replace(/\s*\((?:manchetes?|indices?)\s*\d+(?:\s*(?:,|e|a)\s*\d+)*\)/gi, "")
    .replace(/\s*\[\d+\]/g, "").trim().slice(0, max);
  const vistas = new Set(chavesExistentes);
  const radicaisExistentes = [...chavesExistentes].map((c) => radicaisDe(c));
  const out = [];
  for (const d of lista) {
    if (!d || typeof d !== "object") continue;
    const titulo = limpa(d.titulo, 90), termo = limpa(d.termo, 60);
    const quemPaga = limpa(d.quem_paga, 120);
    /* O modelo tem que NOMEAR quem paga. Se a resposta e pessoa fisica, cidadao ou
       beneficiario, nao e B2B e cai fora (foi assim que passou "identidade do INSS"). */
    if (quemPaga.length < 6 || RE_NAO_B2B.test(quemPaga)) continue;
    const dor = limpa(`Quem paga: ${quemPaga}. ${String(d.dor || "").trim().replace(/^./, (c) => c.toUpperCase())}`, 320), porque = limpa(d.porque_agora, 240);
    const frente = FRENTES.includes(String(d.frente)) ? String(d.frente) : null;
    const indices = [...new Set((Array.isArray(d.indices) ? d.indices : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= manchetes.length))];
    const sinais = indices.map((n) => manchetes[n - 1]).filter((m) => !FONTES_FRACAS.test(m.fonte)).slice(0, 4)
      .map((m) => ({ titulo: m.titulo, fonte: m.fonte, url: m.url, data: String(m.data).slice(0, 10) }));
    /* Um assunto so e sinal se DUAS fontes diferentes falam dele: uma materia so
       e anedota, e foi o que trouxe "ofício digital em Rondônia" como oportunidade. */
    const fontesDistintas = new Set(sinais.map((s) => normalizarChave(s.fonte))).size;
    if (!frente || titulo.length < 8 || termo.length < 4 || porque.length < 15 || fontesDistintas < 2) continue;
    const chave = normalizarChave(termo);
    if (!chave || vistas.has(chave)) continue;
    /* Mesmo assunto com outras palavras ("compliance CBS notas fiscais" x "compliance
       para CBS em notas"): dois dias seguidos de manchetes parecidas geram isso. */
    const rad = radicaisDe(`${termo} ${titulo}`);
    if (radicaisExistentes.some((r) => assuntoParecido(rad, r))) continue;
    vistas.add(chave);
    radicaisExistentes.push(radicaisDe(termo));
    out.push({ chave, titulo, frente, termo, dor, porque_agora: porque, sinais });
    if (out.length >= 6) break;
  }
  return out;
}

/** Quem recebe as oportunidades. Troque com RADAR_PERFIL no ambiente. */
export const PERFIL_PADRAO = "Desenvolvedor solo brasileiro que constrói micro-SaaS B2B e vende serviços de implantação para pequenas e médias empresas. Prefere dores operacionais, fiscais, regulatórias e de IA aplicada que uma equipe de 1 a 3 pessoas consiga resolver em semanas.";

const SISTEMA_DESCOBRIR = `Você é analista de inteligência de mercado B2B no Brasil. Recebe MANCHETES recentes (numeradas) e propõe oportunidades de software ou serviço para pequenas e médias empresas brasileiras que essas manchetes SINALIZAM agora.

Quem vai usar suas oportunidades: {{PERFIL}}

Regras:
- O cliente que PAGA é uma empresa (B2B). Descarte serviço a pessoa física, política, esporte, celebridade e assunto de governo sem comprador empresarial claro.
- Tem que ser algo que uma equipe minúscula consiga construir. Descarte o que exige banco, operadora ou licença pesada.
- Não escreva números de manchete no texto dos campos; eles vão só em "indices".
- Use só as manchetes dadas. Nunca invente fato, número, empresa ou lei. Se uma manchete não sustenta a ideia, não a use.
- Cada oportunidade precisa de pelo menos 2 manchetes de fontes DIFERENTES ("indices"). Uma matéria isolada não é sinal.
- Prefira mudança de regra, prazo chegando, reclamação recorrente ou setor sob pressão: coisas que criam urgência de pagar.
- Não repita assuntos da lista "JÁ MONITORADOS" nem "JÁ PROPOSTOS ANTES", mesmo com outras palavras.
- Não expanda nem explique siglas (CBS, IBS, NF-e, PMOC...) a não ser que a manchete traga o significado. Se não tem certeza, use só a sigla.
- 3 a 6 oportunidades. Menos é melhor que fraco: se só houver 2 boas, devolva 2.
- "porque_agora": o que aconteceu (citando o fato da manchete) e por que isso abre espaço agora. 1 ou 2 frases. Sem hype.
- "quem_paga": o TIPO de empresa que pagaria, concreto (ex.: "contabilidades com 20 a 200 clientes", "clínicas com 2 a 10 profissionais"). Se quem paga seria pessoa física ou governo, a ideia não serve.
- "dor": o que dói nessa empresa, concreto.
- "termo": 2 a 5 palavras, o jeito que se pesquisaria no Google.
- "frente": uma de saude, fintech, regtech, govtech, operacoes, ia_devtools.
- Sem travessão. Português do Brasil.

Responda SOMENTE com JSON:
{"descobertas":[{"titulo":"...","frente":"...","termo":"...","quem_paga":"...","dor":"...","porque_agora":"...","indices":[1,5]}]}`;

export async function descobrirComIa(manchetes, jaMonitorados = [], jaPropostos = []) {
  const linhas = manchetes.map((m, i) => `[${i + 1}] (${m.frente}, ${m.fonte}, ${m.data.slice(0, 10)}) ${m.titulo}`).join("\n");
  const sistema = SISTEMA_DESCOBRIR.replace("{{PERFIL}}", process.env.RADAR_PERFIL || PERFIL_PADRAO);
  const propostos = jaPropostos.slice(0, 40).map((n) => "- " + n).join("\n");
  const usuario = `JÁ MONITORADOS (não repetir):\n${jaMonitorados.slice(0, 40).map((n) => "- " + n).join("\n")}${propostos ? `\n\nJÁ PROPOSTOS ANTES (não repetir):\n${propostos}` : ""}\n\nMANCHETES:\n${linhas}`;
  let erro = null;
  /* Duas tentativas: com raciocinio o modelo as vezes gasta todo o limite de
     tokens pensando e devolve vazio ("json_validate_failed"). A 2a vai mais leve. */
  for (const tent of [{ raciocinio: "low", maxTokens: 6000 }, { raciocinio: "low", maxTokens: 8000 }]) {
    try {
      const r = await chatJSONDetalhado(sistema, usuario, {
        modelo: process.env.GROQ_MODEL_RADAR || process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
        temperatura: 0.4, tentativas: 1, ...tent,
      });
      if (r && r.dados) return r.dados;
    } catch (e) { erro = e; }
  }
  throw erro || new Error("modelo sem resposta");
}

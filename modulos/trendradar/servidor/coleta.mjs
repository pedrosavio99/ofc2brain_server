/**
 * A COLETA do radar vivo: roda no cron diario da Vercel (e sob demanda, quando
 * o painel percebe que os dados estao velhos).
 *
 *   1. PULSO de cada oportunidade monitorada (materias dos ultimos 7 dias x 7
 *      anteriores no Google Noticias) -> radar_pulso.
 *   2. DESCOBERTA: manchetes recentes por frente -> modelo propoe oportunidades
 *      ancoradas nelas -> radar_descobertas.
 *   3. AFINIDADE: pra cada descoberta, a nota SUA mais parecida (embedding).
 *      E o que faz o radar parecer feito pra voce e nao um feed generico.
 *
 * Cada etapa falha sozinha: Google fora do ar nao impede de gravar o que veio;
 * modelo fora do ar nao apaga o pulso.
 */
import crypto from "node:crypto";
import * as db from "../../../src/db.js";
import { gerarEmbeddings } from "../../../src/embeddings.js";
import {
  buscarNoticias, pulsoDoItem, emLotes, dedupePorTitulo,
  CONSULTAS_FRENTE, sanearDescobertas, descobrirComIa,
} from "./vivo.mjs";
import {
  gravarPulso, chavesConhecidas, gravarDescobertas, registrarColeta, ultimaColeta, radarBancoOk,
  pulsosRecentes, listarDescobertas, dicaDoBanco, motivoDoBanco,
} from "./radar-banco.mjs";
import { montarCartoes, resumoDosCartoes, visivel, idPulso } from "./cartoes.mjs";

const DIA_MS = 86400000;
export const VALIDADE_COLETA_MS = 14 * 3600000;
const LIMITE_PADRAO_MS = 48000;
/* 0.6 ligava "conta de luz" a "tokens do 2brain": com Gemini, texto sem relacao
   ja da ~0.6. So aparece "combina com sua nota" quando e parecido de verdade. */
const PISO_AFINIDADE = Number(process.env.RADAR_PISO_AFINIDADE) || 0.72;

let emVoo = null;

/** Os dados do radar estao velhos o bastante pra valer coletar de novo? */
export async function coletaDefasada(agora = Date.now()) {
  const ultima = await ultimaColeta();
  return { ultima, defasada: !ultima || agora - ultima > VALIDADE_COLETA_MS };
}

/** A nota sua que mais combina com cada descoberta. Nunca lanca. */
async function acharAfinidades(descobertas) {
  if (!descobertas.length) return descobertas;
  try {
    const vetores = await gerarEmbeddings(descobertas.map((d) => `${d.titulo}. ${d.dor || ""}`.slice(0, 500)));
    const topos = await Promise.all(vetores.map((v) => db.topKSimilares(v, { k: 1, piso: PISO_AFINIDADE }).catch(() => [])));
    const ids = [...new Set(topos.map((t) => t[0] && t[0].id).filter(Boolean))];
    const notas = ids.length ? await db.buscarVariasResumidas(ids) : [];
    const porId = new Map((notas || []).map((n) => [n.id, n]));
    return descobertas.map((d, i) => {
      const hit = topos[i] && topos[i][0];
      const nota = hit && porId.get(hit.id);
      return nota
        ? { ...d, afinidade: { nota_id: nota.id, resumo: String(nota.resumo || nota.texto_original || "").slice(0, 160), data: String(nota.criado_em || "").slice(0, 10), score: Math.round(hit.score * 100) / 100 } }
        : d;
    });
  } catch (e) {
    console.warn("[radar] afinidade falhou: " + e.message);
    return descobertas;
  }
}

async function coletarUmaVez({ agora = new Date(), limiteMs = LIMITE_PADRAO_MS } = {}) {
  const t0 = Date.now();
  const restante = () => limiteMs - (Date.now() - t0);
  const erros = [];
  const dia = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);

  /* 1. descoberta: manchetes por frente -> oportunidades ancoradas nelas */
  let novas = 0;
  const ativos = async () => (await listarDescobertas({ status: ["nova", "salva", "investigada"], limite: 120 })).filter((r) => visivel(r));
  if (restante() > 15000) {
    const consultas = Object.entries(CONSULTAS_FRENTE).flatMap(([frente, qs]) => qs.map((q) => ({ frente, q })));
    const feeds = await emLotes(consultas, 6, async ({ frente, q }) => {
      const n = await buscarNoticias(q, { dias: 3 });
      return n.map((x) => ({ ...x, frente }));
    });
    feeds.forEach((r, i) => { if (!r.ok) erros.push(`manchetes ${consultas[i].q}: ${r.erro}`); });
    const manchetes = dedupePorTitulo(feeds.filter((r) => r.ok).flatMap((r) => r.valor)
      .sort((a, b) => b.data.localeCompare(a.data))).slice(0, 90);

    if (manchetes.length >= 8) {
      try {
        // assunto ja visto (inclusive o que voce descartou) nao volta como novo
        const existentes = await chavesConhecidas();
        const atuais = await ativos();
        const bruto = await descobrirComIa(manchetes, atuais.map((a) => a.titulo), [...existentes].slice(-40));
        let descobertas = sanearDescobertas(bruto, manchetes, existentes);
        descobertas = await acharAfinidades(descobertas);
        novas = await gravarDescobertas(descobertas);
      } catch (e) {
        erros.push("descoberta: " + e.message);
      }
    } else {
      erros.push(`descoberta: so ${manchetes.length} manchetes (Google Notícias fora do ar?)`);
    }
  } else {
    erros.push("descoberta pulada: tempo esgotado");
  }

  /* 2. pulso de cada alvo vivo (inclusive os recem descobertos): historico real */
  let linhas = [];
  if (restante() > 5000) {
    const alvos = await ativos();
    const res = await emLotes(alvos, 6, async (a) => {
      const j = await pulsoDoItem({ termo: a.termo }, agora);
      return { item_id: idPulso(a.chave), dia, mencoes_7d: j.sete, mencoes_prev_7d: j.anteriores, manchetes: j.manchetes, coletado_em: new Date().toISOString() };
    });
    linhas = res.filter((r) => r.ok).map((r) => r.valor);
    res.forEach((r, i) => { if (!r.ok) erros.push(`pulso ${alvos[i].termo}: ${r.erro}`); });
    await gravarPulso(linhas);
  } else {
    erros.push("pulso pulado: tempo esgotado");
  }

  const resumo = { itens: linhas.length, novas, erros, ms: Date.now() - t0, persistente: radarBancoOk() };
  await registrarColeta({ iniciadoEm: t0, duracaoMs: resumo.ms, itens: linhas.length, novas, erros: erros.slice(0, 10) });
  return resumo;
}

/** Uma coleta por vez: clique duplo ou cron + painel nao disparam duas. */
export function coletarTudo(opcoes) {
  if (!emVoo) emVoo = coletarUmaVez(opcoes).finally(() => { emVoo = null; });
  return emVoo;
}

/* ------------------------------------------------------- cron e painel */

/**
 * O cron da Vercel manda "Authorization: Bearer <CRON_SECRET>". Sem a variavel o
 * endpoint nao existe (503), nunca fica aberto. Tempo constante. Pura.
 */
export function cronAutorizado(cabecalho, segredo) {
  const esperado = Buffer.from(String(segredo || ""), "utf8");
  if (!esperado.length) return false;
  const m = String(cabecalho || "").match(/^Bearer\s+(.+)$/i);
  const recebido = Buffer.from(m ? m[1].trim() : "", "utf8");
  if (recebido.length !== esperado.length) { crypto.timingSafeEqual(esperado, esperado); return false; }
  return crypto.timingSafeEqual(recebido, esperado);
}

/** Tudo que a tela do radar mostra: cartoes reais, resumo e saude da coleta. */
export async function montarRadar(agora = Date.now()) {
  const [rows, porId, def] = await Promise.all([
    listarDescobertas({ status: ["nova", "salva", "investigada"], limite: 200 }).catch(() => []),
    pulsosRecentes(45).catch(() => new Map()),
    coletaDefasada(agora),
  ]);
  const cartoes = montarCartoes(rows, porId, agora);
  return {
    coletadoEm: def.ultima, defasado: def.defasada,
    banco: { ok: radarBancoOk(), dica: dicaDoBanco(), motivo: motivoDoBanco() },
    resumo: resumoDosCartoes(cartoes),
    cartoes,
  };
}

/** Texto curto pra Conversa (ferramenta ver_radar). So o que o radar mediu ou achou. */
export async function resumoDoRadar() {
  const { cartoes, resumo, coletadoEm } = await montarRadar();
  if (!cartoes.length) {
    return "### TrendRadar\n- Ainda não há nada coletado. A coleta roda uma vez por dia (ou na primeira abertura do radar).";
  }
  const nome = (c) => c.titulo;
  const pct = (c) => `${c.pulso.variacaoPct > 0 ? "+" : ""}${c.pulso.variacaoPct}%`;
  const subindo = cartoes.filter((c) => c.pulso && c.pulso.estado === "subindo").slice(0, 4);
  const novos = cartoes.filter((c) => c.novo).slice(0, 4);
  const comNota = cartoes.filter((c) => c.afinidade && c.afinidade.nota_id).slice(0, 3);
  const quando = coletadoEm ? new Date(coletadoEm).toISOString().slice(0, 10) : "nunca";
  return [
    "### TrendRadar (dados coletados de imprensa real, última coleta " + quando + ")",
    `- ${resumo.total} alvos no radar (${resumo.novos} novos, ${resumo.salvos} salvos, ${resumo.investigados} investigados)`,
    subindo.length ? `- Subindo na imprensa (7d vs 7d anteriores): ${subindo.map((c) => `${nome(c)} (${pct(c)})`).join("; ")}` : "",
    novos.length ? `- Sinais novos: ${novos.map(nome).join("; ")}` : "",
    comNota.length ? `- Combinam com notas dele(a): ${comNota.map(nome).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

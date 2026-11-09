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
import { carregarOportunidadesPersistidas } from "./nucleo.mjs";
import {
  buscarNoticias, pulsoDoItem, emLotes, dedupePorTitulo, normalizarChave,
  CONSULTAS_FRENTE, sanearDescobertas, descobrirComIa, enriquecerComPulso,
} from "./vivo.mjs";
import {
  gravarPulso, chavesConhecidas, gravarDescobertas, registrarColeta, ultimaColeta, radarBancoOk,
  pulsosRecentes, listarDescobertas, dicaDoBanco,
} from "./radar-banco.mjs";

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

  /* 1. pulso */
  const itens = await carregarOportunidadesPersistidas();
  const monitorados = itens;
  const res = await emLotes(monitorados, 6, async (it) => {
    const j = await pulsoDoItem(it, agora);
    return { item_id: it.id, dia, mencoes_7d: j.sete, mencoes_prev_7d: j.anteriores, manchetes: j.manchetes, coletado_em: new Date().toISOString() };
  });
  const linhas = res.filter((r) => r.ok).map((r) => r.valor);
  res.forEach((r, i) => { if (!r.ok) erros.push(`pulso ${monitorados[i].id}: ${r.erro}`); });
  await gravarPulso(linhas);

  /* 2. descoberta */
  let novas = 0;
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
        const existentes = await chavesConhecidas();
        // o que ja monitoramos tambem conta como "conhecido"
        for (const it of itens) existentes.add(normalizarChave(it.termoBusca || it.nome));
        const bruto = await descobrirComIa(manchetes, itens.map((i) => i.nome), [...existentes].slice(-40));
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

/** O que a tela "Hoje no radar" mostra. */
export async function montarHoje(agora = Date.now()) {
  const [base, porItem, novas, salvas, def] = await Promise.all([
    carregarOportunidadesPersistidas(),
    pulsosRecentes(30).catch(() => new Map()),
    listarDescobertas({ status: "nova", limite: 8 }).catch(() => []),
    listarDescobertas({ status: "salva", limite: 20 }).catch(() => []),
    coletaDefasada(agora),
  ]);
  const itens = enriquecerComPulso(base, porItem);
  const comPulso = itens.filter((i) => i.pulso && i.pulso.estado !== "sem_dado");
  const movimentos = itens
    .filter((i) => i.pulso && (i.pulso.estado === "subindo" || i.pulso.estado === "esfriando"))
    .sort((a, b) => Math.abs(b.pulso.variacaoPct) - Math.abs(a.pulso.variacaoPct))
    .slice(0, 6)
    .map((i) => ({
      id: i.id, nome: i.nome, frente: i.frente, estado: i.pulso.estado, variacaoPct: i.pulso.variacaoPct,
      mencoes7d: i.pulso.sete, anteriores: i.pulso.anteriores, pontuacaoViva: i.pontuacaoViva,
      manchete: (i.pulso.manchetes && i.pulso.manchetes[0]) || null,
    }));
  return {
    coletadoEm: def.ultima, defasado: def.defasada,
    banco: { ok: radarBancoOk(), dica: dicaDoBanco() },
    novas, salvas: salvas.length, movimentos,
    resumo: {
      monitorados: itens.length, comPulso: comPulso.length,
      subindo: itens.filter((i) => i.pulso && i.pulso.estado === "subindo").length,
      esfriando: itens.filter((i) => i.pulso && i.pulso.estado === "esfriando").length,
      novas: novas.length,
    },
  };
}

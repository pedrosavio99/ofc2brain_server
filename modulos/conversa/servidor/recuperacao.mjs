/**
 * Formatadores de nota do modulo CONVERSA. Puro, zero I/O.
 *
 * Este arquivo era o "tunnel vision" inteiro (busca + limiar fixo + blocos de
 * prompt). A busca foi pra busca.mjs (hibrida, com reranking) e os blocos de
 * cada fonte foram pra ferramentas.mjs. Sobrou aqui o que e so formatacao.
 */
import { diaLocal } from "./tempo.mjs";

export const corta = (t, n) => {
  const s = String(t || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/**
 * A idade da nota em palavras, pra LINHA da nota no prompt.
 *
 * Existe porque a data crua nao bastava: o prompt dizia "Hoje e 2026-09-18" e a
 * nota "guardada em 2026-09-18", mas a conta ficava por conta do modelo, e ele
 * errava (chamava nota de hoje de "aquela vez que voce escreveu"). Dias de
 * CALENDARIO, nao horas: nota de ontem as 20h tem 18h de idade e e de ontem.
 */
export function rotuloDaNota(criadoEm, agora = new Date()) {
  const t = new Date(criadoEm).getTime();
  if (!Number.isFinite(t)) return "data desconhecida";
  const dias = diaLocal(agora) - diaLocal(t);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias === 2) return "anteontem";
  if (dias <= 13) return `há ${dias} dias`;
  if (dias <= 60) {
    const sem = Math.round(dias / 7);
    return `há ${sem} semana${sem === 1 ? "" : "s"}`;
  }
  const d = new Date(t);
  return `em ${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Uma nota em linhas de prompt. `max` = quanto do texto original entra. */
export function formatarNota(n, i, { agora = new Date(), max = 600 } = {}) {
  const data = String(n.criado_em || "").slice(0, 10);
  const evento = n.tipo === "lembrete_evento" && n.data_evento ? ` · evento marcado p/ ${String(n.data_evento).slice(0, 10)}` : "";
  const cabeca = `${i + 1}. [${n.area || "sem área"}] ${n.resumo || "(sem resumo)"}\n   guardada em ${data} (${rotuloDaNota(n.criado_em, agora)})${evento}`;
  const texto = max > 0 && n.texto_original ? `\n   texto: ${corta(n.texto_original, max)}` : "";
  return cabeca + texto;
}

/**
 * O panorama em texto pro prompt. Puro.
 * Existe pro caso em que a busca nao acha nota do tema: sem isto o modelo fica
 * sem chao e enche linguica. Com isto ele sabe o tamanho e o recorte da base.
 */
export function blocoDoPanorama(p) {
  if (!p || !p.total) return "";
  const lista = (arr, n) => (Array.isArray(arr) ? arr : []).slice(0, n)
    .map((x) => `${x.nome} (${x.n})`).join(", ");
  const areas = lista(p.areas, 10);
  const periodo = p.primeira && p.ultima ? ` De ${p.primeira} a ${p.ultima}.` : "";
  return `A base de notas tem ${p.total} nota(s).${periodo}${areas ? ` Áreas: ${areas}.` : ""} ` +
    "Isso é o retrato geral, não o recorte deste assunto.";
}

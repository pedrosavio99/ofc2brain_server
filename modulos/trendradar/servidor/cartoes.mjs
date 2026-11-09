/**
 * Linha de radar_descobertas + linhas de radar_pulso -> cartao da tela. Tudo puro.
 *
 * O cartao so carrega o que foi medido ou citado de uma fonte:
 *   sinais   manchetes reais (veiculo, data, link)
 *   pulso    materias na imprensa, 7 dias contra 7 anteriores
 *   serie    um ponto por dia de coleta (cresce sozinha)
 *   trends   serie do Google Trends, SO se veio de CSV seu ou da chave do SerpApi
 *   dossie   hipoteses da IA (a tela rotula como "a validar")
 * Nada de score editorial, curva estimada ou mapa de estados fabricado.
 */
import { pulsoDeLinhas } from "./vivo.mjs";
import { analisarSerieTemporal } from "./nucleo.mjs";

const HORA_MS = 3600000;
export const JANELA_NOVA_DIAS = 21;
export const idPulso = (chave) => "c:" + chave;

/** Descartada nunca aparece. "Nova" que ninguem tocou em 21 dias sai da frente (a linha fica no banco). */
export function visivel(row, agora = Date.now()) {
  if (!row || row.status === "descartada") return false;
  if (row.status === "nova" && row.origem !== "pesquisa" && row.origem !== "csv") {
    return agora - Date.parse(row.criado_em) <= JANELA_NOVA_DIAS * 24 * HORA_MS;
  }
  return true;
}

export function cartaoDoAlvo(row, linhasPulso = [], agora = Date.now()) {
  const { pulso, serie, calor } = pulsoDeLinhas(linhasPulso);
  const trends = Array.isArray(row.serie) && row.serie.length >= 2 ? row.serie : null;
  return {
    id: row.id,
    origem: row.origem || "radar",
    status: row.status,
    titulo: row.titulo,
    frente: row.frente,
    termo: row.termo,
    dor: row.dor || null,
    porqueAgora: row.porque_agora || null,
    sinais: Array.isArray(row.sinais) ? row.sinais : [],
    afinidade: row.afinidade || null,
    detectadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em || row.criado_em,
    novo: row.status === "nova" && agora - Date.parse(row.criado_em) <= 36 * HORA_MS,
    pulso,
    serie,
    calor,
    trends,
    curva: trends && trends.length >= 4 ? analisarSerieTemporal(trends) : null,
    regioes: Array.isArray(row.regioes) && row.regioes.length ? row.regioes : null,
    dossie: row.dossie || null,
  };
}

/** Mais novo primeiro. A tela reordena do jeito que a pessoa escolher. */
export function montarCartoes(rows, pulsosPorId, agora = Date.now()) {
  return (rows || [])
    .filter((r) => visivel(r, agora))
    .map((r) => cartaoDoAlvo(r, (pulsosPorId && pulsosPorId.get(idPulso(r.chave))) || [], agora))
    .sort((a, b) => String(b.detectadoEm).localeCompare(String(a.detectadoEm)));
}

export function resumoDosCartoes(cards) {
  const por = (f) => cards.filter(f).length;
  return {
    total: cards.length,
    novos: por((c) => c.novo),
    salvos: por((c) => c.status === "salva"),
    investigados: por((c) => c.status === "investigada"),
    subindo: por((c) => c.pulso && c.pulso.estado === "subindo"),
    esfriando: por((c) => c.pulso && c.pulso.estado === "esfriando"),
    comMedicao: por((c) => c.pulso && c.pulso.estado !== "sem_dado"),
    combinamComVoce: por((c) => c.afinidade && c.afinidade.nota_id),
  };
}

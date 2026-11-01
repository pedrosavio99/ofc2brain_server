/**
 * Contas de data (dia "AAAA-MM-DD") para o gráfico e o heatmap.
 *
 * Tudo em UTC, então horário de verão e fuso do aparelho não mexem no dia.
 * O "hoje" nunca nasce aqui: quem chama passa a data.
 * Não faz: formatar para a tela além do rótulo curto.
 */
const MS_DIA = 86400000;

export const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Dia ISO -> milissegundos UTC, ou null se não for um dia real. */
export function paraDia(iso) {
  const m = typeof iso === "string" && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(a, mes - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === a && x.getUTCMonth() === mes - 1 && x.getUTCDate() === d ? t : null;
}

export function isoDe(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function somarDias(iso, n) {
  const t = paraDia(iso);
  return t === null ? null : isoDe(t + n * MS_DIA);
}

/** 0 = segunda ... 6 = domingo. */
export function diaDaSemana(iso) {
  const t = paraDia(iso);
  return t === null ? null : (new Date(t).getUTCDay() + 6) % 7;
}

/** "AAAA-MM-DD" -> "DD/MM". */
export function rotuloCurto(iso) {
  return iso.slice(8, 10) + "/" + iso.slice(5, 7);
}

/** "AAAA-MM-DD" -> "DD/MM/AAAA". */
export function rotuloCompleto(iso) {
  return rotuloCurto(iso) + "/" + iso.slice(0, 4);
}

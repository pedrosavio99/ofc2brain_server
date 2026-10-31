/**
 * Escala de tons compartilhada pelos componentes.
 *
 * Recebe: uma fração (0..1) e quantos níveis a escala tem.
 * Devolve: 0 quando não há nada a pintar (zero, negativo, NaN, não numérico) e
 *   1..niveis nos demais casos, arredondando para cima: qualquer coisa acima de zero
 *   já acende o primeiro tom.
 * Não faz: escolher cor. A cor de cada tom mora no CSS do componente, por token.
 */
export function tomDe(fracao, niveis = 4) {
  const v = typeof fracao === "number" ? fracao : NaN;
  if (!(v > 0)) return 0;
  return Math.min(niveis, Math.max(1, Math.ceil(v * niveis)));
}

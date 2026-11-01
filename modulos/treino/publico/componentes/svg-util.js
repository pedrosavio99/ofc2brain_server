/**
 * Utilidades de texto para montar SVG à mão.
 *
 * Recebe: texto ou número. Devolve: texto seguro para dentro de atributo ou nó de texto,
 * e número formatado em pt-BR. Não faz: desenhar.
 */

/** Escapa & < > " ' para o texto entrar em SVG sem abrir tag. */
export function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Coordenada com no máximo 2 casas, sem notação científica. */
export function coord(n) {
  return Number(n.toFixed(2));
}

/** 78 -> "78", 78.46 -> "78,5". */
export function numero(n) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** Corta texto longo com reticências, para rótulo não estourar o desenho. */
export function curto(texto, max) {
  const t = String(texto ?? "");
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

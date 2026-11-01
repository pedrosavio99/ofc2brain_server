/**
 * <grafico-linha>: série no tempo com área, linha de meta tracejada opcional, eixo de
 * datas e o ponto final destacado. SVG puro, sem biblioteca.
 *
 * Recebe: `pontos` = [{ data: "AAAA-MM-DD", valor: número }] (propriedade ou atributo JSON),
 *   `meta` (número, opcional) e `unidade` (texto, opcional: "kg").
 * Devolve: SVG responsivo em shadow DOM, só com tokens do estilos.css.
 * Não faz: buscar dado, ordenar por você (ele ordena por data), ler relógio.
 *   Ponto com data inválida ou valor que não é número é descartado.
 *
 * `calcularGrafico` (conta) e `desenharGrafico` (texto SVG) são puros e testáveis sem DOM.
 */
import { paraDia, isoDe, rotuloCurto } from "./datas.js";
import { esc, coord, numero, curto } from "./svg-util.js";

const MS_DIA = 86400000;
const MARGEM = { esq: 10, dir: 14, topo: 22, base: 24 };

export function calcularGrafico(pontos, { largura = 320, altura = 160, meta } = {}) {
  const validos = (Array.isArray(pontos) ? pontos : [])
    .map((p) => ({ data: p?.data, valor: p?.valor, t: paraDia(p?.data) }))
    .filter((p) => p.t !== null && typeof p.valor === "number" && Number.isFinite(p.valor))
    .sort((a, b) => a.t - b.t);
  const metaValida = typeof meta === "number" && Number.isFinite(meta) ? meta : null;
  if (!validos.length) return { vazio: true, pontos: [], linha: "", area: "", metaY: null, ultimo: null, eixo: [] };

  const x0 = MARGEM.esq, x1 = largura - MARGEM.dir;
  const y0 = MARGEM.topo, y1 = altura - MARGEM.base;
  const t0 = validos[0].t, t1 = validos.at(-1).t;
  const valores = validos.map((p) => p.valor).concat(metaValida === null ? [] : [metaValida]);
  let lo = Math.min(...valores), hi = Math.max(...valores);
  const folga = hi === lo ? Math.max(1, Math.abs(hi) * 0.1) : (hi - lo) * 0.12;
  lo -= folga; hi += folga;

  const xDe = (t) => (t1 === t0 ? (x0 + x1) / 2 : x0 + ((t - t0) / (t1 - t0)) * (x1 - x0));
  const yDe = (v) => y0 + (1 - (v - lo) / (hi - lo)) * (y1 - y0);

  const resultado = validos.map((p) => ({ data: p.data, valor: p.valor, x: coord(xDe(p.t)), y: coord(yDe(p.valor)) }));
  const linha = resultado.length > 1 ? resultado.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") : "";
  const area = linha ? `${linha} L${resultado.at(-1).x} ${coord(y1)} L${resultado[0].x} ${coord(y1)} Z` : "";

  // Eixo: até 4 rótulos espaçados no tempo, do primeiro ao último dia.
  const dias = Math.round((t1 - t0) / MS_DIA);
  const quantos = Math.min(4, dias + 1);
  const eixo = [];
  for (let i = 0; i < quantos; i++) {
    const t = quantos === 1 ? t0 : t0 + Math.round((i * dias) / (quantos - 1)) * MS_DIA;
    const rotulo = rotuloCurto(isoDe(t));
    if (eixo.at(-1)?.rotulo === rotulo) continue;
    eixo.push({ x: coord(xDe(t)), rotulo, ancora: i === 0 && quantos > 1 ? "start" : i === quantos - 1 && quantos > 1 ? "end" : "middle" });
  }

  return {
    vazio: false, pontos: resultado, linha, area,
    metaY: metaValida === null ? null : coord(yDe(metaValida)),
    ultimo: resultado.at(-1), eixo, limites: { x0, x1, y0, y1 },
  };
}

/** SVG (texto) do gráfico. */
export function desenharGrafico(pontos, { meta, unidade = "", largura = 320, altura = 160 } = {}) {
  const g = calcularGrafico(pontos, { largura, altura, meta });
  const cab = `<svg viewBox="0 0 ${largura} ${g.vazio ? 60 : altura}" role="img" aria-label="Gráfico de linha">`;
  if (g.vazio) return `${cab}<text class="vazio" x="${largura / 2}" y="30" text-anchor="middle">Sem dados ainda</text></svg>`;

  const { x0, x1, y1 } = g.limites;
  const sufixo = unidade ? ` ${esc(curto(unidade, 9))}` : "";
  const ultimo = g.ultimo;
  const perto = ultimo.x > x1 - 30; // não deixa o valor sair pela direita
  const partes = [cab, `<line class="base" x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}"/>`];
  if (g.area) partes.push(`<path class="area" d="${g.area}"/>`);
  if (g.metaY !== null) {
    partes.push(`<line class="meta" x1="${x0}" x2="${x1}" y1="${g.metaY}" y2="${g.metaY}"/>`
      + `<text class="rotulo" x="${x0}" y="${coord(g.metaY - 4)}" text-anchor="start">meta ${esc(numero(meta))}${sufixo}</text>`);
  }
  if (g.linha) partes.push(`<path class="linha" d="${g.linha}"/>`);
  partes.push(
    `<circle class="final" cx="${ultimo.x}" cy="${ultimo.y}" r="5"/>`,
    `<text class="valor" x="${ultimo.x}" y="${coord(ultimo.y - 10)}" text-anchor="${perto ? "end" : "middle"}">${esc(numero(ultimo.valor))}${sufixo}</text>`);
  for (const t of g.eixo) partes.push(`<text class="eixo" x="${t.x}" y="${altura - 6}" text-anchor="${t.ancora}">${t.rotulo}</text>`);
  partes.push("</svg>");
  return partes.join("");
}

const ESTILO = `
:host { display: block; }
svg { display: block; width: 100%; height: auto; font-family: var(--fonte, system-ui); overflow: visible; }
.base { stroke: var(--separador); stroke-width: 1; }
.area { fill: color-mix(in srgb, var(--acento) 16%, transparent); stroke: none; }
.linha { fill: none; stroke: var(--acento); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.meta { stroke: var(--texto-3); stroke-width: 1.25; stroke-dasharray: 4 4; }
.final { fill: var(--acento); stroke: var(--superficie); stroke-width: 2.5; }
text { font-size: 10px; fill: var(--texto-2); }
.valor { font-size: 12px; font-weight: 700; fill: var(--texto); }
.vazio { font-size: 12px; fill: var(--texto-3); }
`;

const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

export class GraficoLinha extends Base {
  static observedAttributes = ["pontos", "meta", "unidade"];
  #pontos = null;

  get pontos() { return this.#pontos ?? this.#json(); }
  set pontos(valor) { this.#pontos = valor; this.#pintar(); }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.#pintar();
  }

  attributeChangedCallback(nome) {
    if (nome === "pontos") this.#pontos = null;
    this.#pintar();
  }

  #json() {
    try { return JSON.parse(this.getAttribute("pontos") || "[]"); } catch { return []; }
  }

  #pintar() {
    if (!this.shadowRoot) return;
    const bruto = this.getAttribute("meta");
    const meta = bruto === null || bruto === "" ? undefined : Number(bruto);
    this.shadowRoot.innerHTML = `<style>${ESTILO}</style>`
      + desenharGrafico(this.pontos, { meta, unidade: this.getAttribute("unidade") ?? "" });
  }
}

if (typeof customElements !== "undefined" && !customElements.get("grafico-linha")) {
  customElements.define("grafico-linha", GraficoLinha);
}

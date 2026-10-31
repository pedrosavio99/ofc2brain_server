/**
 * <mapa-corpo>: corpo de frente e de costas com os músculos pintados por intensidade.
 * O desenho é o CorpoMapa do protótipo aprovado (issue #90): silhueta cinza, músculo no tom do --acento.
 *
 * Recebe: `dados` (propriedade ou atributo JSON) = { musculo: intensidade 0..1 }. A chave
 *   pode ser o id da região (peito, triceps) ou o nome do catálogo (ver mapa-corpo-nomes.js).
 *   Atributo `vista`: "ambas" (padrão), "frente" ou "costas". Altura: variável CSS
 *   `--mapa-altura` (240px nas telas cheias; sem ela o mapa usa até 420px).
 * Devolve: SVG em shadow DOM, 4 tons do --acento (0 fica sem tom; 1 = tom 4, 0,5 = tom 2).
 *   Tocar num músculo, ou Enter/Espaço nele, dispara o evento `musculo` com
 *   detail { musculo, rotulo, intensidade }.
 * Não faz: buscar dado, guardar estado, usar cor própria (só tokens do estilos.css).
 *
 * `desenharMapa` é a parte pura: texto SVG a partir de dados + geometria, testável sem DOM.
 * A geometria (~3 KB) só é baixada quando o primeiro mapa aparece.
 */
import { tomDe } from "./escala-tons.js";
import { regiaoDe, rotuloDe } from "./mapa-corpo-nomes.js";

/** Espelho em x = 50: o desenho guarda só o lado esquerdo do corpo. */
const ESPELHO = 'transform="matrix(-1 0 0 1 100 0)"';
const NOME_DA_VISTA = { frente: "Frente", costas: "Costas" };

/** Chaves do catálogo ou ids -> { regiao: 0..1 }. Chave solta e valor torto saem; repetida fica com a maior. */
export function normalizarDados(dados) {
  const saida = {};
  if (!dados || typeof dados !== "object") return saida;
  for (const [chave, bruto] of Object.entries(dados)) {
    const regiao = regiaoDe(chave);
    if (!regiao || typeof bruto !== "number" || !Number.isFinite(bruto)) continue;
    saida[regiao] = Math.max(saida[regiao] ?? 0, Math.min(1, Math.max(0, bruto)));
  }
  return saida;
}

const paths = (lista) => lista.map((d) => `<path d="${d}"/>`).join("");
const comEspelho = (lista) => `${paths(lista)}<g ${ESPELHO}>${paths(lista)}</g>`;

/** SVG (texto) de uma vista: "frente" ou "costas". */
export function desenharMapa(dados, geometria, vista) {
  const v = geometria?.[vista];
  if (!v) return "";
  const valores = normalizarDados(dados);
  const musculo = (regiao, trechos) => {
    const intensidade = valores[regiao] ?? 0;
    const rotulo = rotuloDe(regiao);
    const nome = intensidade > 0 ? `${rotulo}, ${Math.round(intensidade * 100)}%` : rotulo;
    return `<g data-musculo="${regiao}" class="m t${tomDe(intensidade, 4)}" role="button" tabindex="0" aria-label="${nome}">${trechos}</g>`;
  };
  const inertes = `<path d="${v.cabeca}"/>${comEspelho(v.silhueta)}`;
  const laterais = Object.entries(v.p).map(([regiao, lista]) => musculo(regiao, comEspelho(lista)));
  const centrais = Object.entries(v.unico ?? {}).map(([regiao, lista]) => musculo(regiao, paths(lista)));
  return `<svg viewBox="${v.vb}" role="group" aria-label="${NOME_DA_VISTA[vista] ?? vista}">`
    + `<g class="silhueta">${inertes}</g>${laterais.join("")}${centrais.join("")}</svg>`;
}

const ESTILO = `
:host { display: block; }
.vistas { display: flex; justify-content: center; gap: 6px; margin: 0 auto; max-width: calc(var(--mapa-altura, 420px) * 1.1); }
figure { margin: 0; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
figcaption { text-align: center; font: 600 11px/1 var(--fonte, system-ui); color: var(--texto-2); }
svg { display: block; width: 100%; height: auto; max-height: var(--mapa-altura, 420px); }
.silhueta path { fill: color-mix(in srgb, var(--texto-3) 18%, var(--superficie)); }
.m { cursor: pointer; outline: none; -webkit-tap-highlight-color: transparent; }
.m path { fill: color-mix(in srgb, var(--texto-3) 40%, var(--superficie)); transition: fill .2s; }
.m.t1 path { fill: color-mix(in srgb, var(--acento) 30%, color-mix(in srgb, var(--texto-3) 40%, var(--superficie))); }
.m.t2 path { fill: color-mix(in srgb, var(--acento) 50%, color-mix(in srgb, var(--texto-3) 40%, var(--superficie))); }
.m.t3 path { fill: color-mix(in srgb, var(--acento) 75%, color-mix(in srgb, var(--texto-3) 40%, var(--superficie))); }
.m.t4 path { fill: var(--acento); }
.m:focus-visible path { stroke: var(--texto); stroke-width: 1.2; }
@media (hover: hover) { .m:hover path { stroke: var(--acento); stroke-width: .8; } }
@media (prefers-reduced-motion: reduce) { .m path { transition: none; } }
`;

const Base = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

export class MapaCorpo extends Base {
  static observedAttributes = ["vista", "dados"];
  #dados = null;
  #geometria = null;
  #pedindo = false;

  get dados() { return this.#dados ?? this.#doAtributo(); }
  set dados(valor) { this.#dados = valor; this.#pintar(); }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this.#tocar(e));
      this.shadowRoot.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.#tocar(e); }
      });
    }
    this.#pintar();
  }

  attributeChangedCallback(nome) {
    if (nome === "dados") this.#dados = null;
    this.#pintar();
  }

  #doAtributo() {
    try { return JSON.parse(this.getAttribute("dados") || "{}"); } catch { return {}; }
  }

  async #pintar() {
    if (!this.shadowRoot) return;
    if (!this.#geometria) {
      if (this.#pedindo) return;
      this.#pedindo = true;
      try { this.#geometria = (await import("./mapa-corpo-geometria.js")).default; }
      catch (erro) { this.#pedindo = false; this.shadowRoot.innerHTML = ""; throw erro; }
      this.#pedindo = false;
    }
    const vista = this.getAttribute("vista");
    const vistas = vista === "frente" || vista === "costas" ? [vista] : ["frente", "costas"];
    const dados = this.dados;
    this.shadowRoot.innerHTML = `<style>${ESTILO}</style><div class="vistas">`
      + vistas.map((v) => `<figure>${desenharMapa(dados, this.#geometria, v)}<figcaption>${NOME_DA_VISTA[v]}</figcaption></figure>`).join("")
      + `</div>`;
  }

  #tocar(e) {
    const alvo = e.target.closest?.("[data-musculo]");
    if (!alvo) return;
    const musculo = alvo.dataset.musculo;
    const intensidade = normalizarDados(this.dados)[musculo] ?? 0;
    this.dispatchEvent(new CustomEvent("musculo", {
      bubbles: true, composed: true, detail: { musculo, rotulo: rotuloDe(musculo), intensidade },
    }));
  }
}

if (typeof customElements !== "undefined" && !customElements.get("mapa-corpo")) {
  customElements.define("mapa-corpo", MapaCorpo);
}

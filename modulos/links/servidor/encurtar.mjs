/**
 * Encurtadores. Roda no SERVIDOR de proposito: do navegador, is.gd, da.gd e
 * TinyURL esbarram em CORS e em bloqueador de anuncio. Daqui a chamada e uma
 * requisicao comum.
 *
 * Nenhum precisa de chave. Cada um devolve o link curto em texto ou JSON; o
 * que mudou entre eles esta todo neste arquivo.
 *
 * Se um servico recusar o IP do servidor, a tela oferece "Abrir no site" +
 * colar o resultado (servico "manual"), entao nunca fica sem saida.
 */

export const SERVICOS = {
  isgd: { rotulo: "is.gd", aliasMin: 5 },
  dagd: { rotulo: "da.gd", aliasMin: 3 },
  tiny: { rotulo: "TinyURL", aliasMin: 0 }, // TinyURL ignora o nome pedido
};

const TIMEOUT_MS = 10000;
const MAX_URL = 2048;

export class ErroEncurtar extends Error {
  constructor(mensagem, status = 502) {
    super(mensagem);
    this.status = status;
  }
}

/** Normaliza o que a pessoa colou: poe https:// se faltar e valida. null se invalido. */
export function normalizarUrl(bruta) {
  let u = String(bruta || "").trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  if (u.length > MAX_URL) return null;
  try {
    const p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return null;
    if (!p.hostname.includes(".") && p.hostname !== "localhost") return null;
    return u;
  } catch {
    return null;
  }
}

/** So letras, numeros e _. Foi o que os servicos aceitam no "final do endereco". */
export function limparAlias(a) {
  return String(a || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 30);
}

/** Endereco da pagina do servico com tudo preenchido, pro "Abrir no site". */
export function urlManual(servico, longa, alias = "") {
  const u = encodeURIComponent(longa);
  const a = limparAlias(alias);
  if (servico === "isgd") return `https://is.gd/create.php?format=simple&url=${u}` + (a.length >= 5 ? `&shorturl=${a}` : "");
  if (servico === "dagd") return `https://da.gd/s?url=${u}` + (a.length >= 3 ? `&shorturl=${a}` : "");
  return `https://tinyurl.com/api-create.php?url=${u}`;
}

async function buscar(url) {
  let r;
  try {
    r = await fetch(url, {
      headers: { "User-Agent": "segundo-cerebro/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const lento = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new ErroEncurtar(lento ? "O encurtador demorou demais para responder." : "Não consegui falar com o encurtador.", 504);
  }
  return r;
}

/**
 * Gera o link curto. Devolve a URL curta ou lanca ErroEncurtar com a frase que
 * o proprio servico deu (ex.: "esse nome ja esta em uso").
 */
export async function encurtar(servico, longa, alias = "") {
  const cfg = SERVICOS[servico];
  if (!cfg) throw new ErroEncurtar("Serviço de encurtamento desconhecido.", 400);
  const a = limparAlias(alias);
  const u = encodeURIComponent(longa);

  if (servico === "isgd") {
    // Com nome menor que o minimo o is.gd devolve erro; sem nome ele sorteia.
    const r = await buscar(`https://is.gd/create.php?format=json&url=${u}` + (a.length >= cfg.aliasMin ? `&shorturl=${a}` : ""));
    const d = await r.json().catch(() => null);
    if (d?.shorturl) return d.shorturl;
    throw new ErroEncurtar(d?.errormessage || "O is.gd não aceitou esse link.");
  }

  const url = servico === "dagd"
    ? `https://da.gd/s?url=${u}` + (a.length >= cfg.aliasMin ? `&shorturl=${a}` : "")
    : `https://tinyurl.com/api-create.php?url=${u}`;
  const r = await buscar(url);
  const t = (await r.text()).trim();
  if (r.ok && /^https?:\/\/\S+$/.test(t)) return t;
  throw new ErroEncurtar((t.slice(0, 140) || `${cfg.rotulo} respondeu ${r.status}.`));
}

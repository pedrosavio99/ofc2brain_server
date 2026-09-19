/**
 * Porta de entrada por PIN.
 *
 * O PIN vive em PIN_ACESSO, no ambiente. Sem a variavel, nada e protegido: e
 * de proposito, pra um deploy sem a variavel nao trancar voce pra fora do seu
 * proprio sistema.
 *
 * O que PROTEGE: tudo que devolve dado. Ideias, insight, backup, as rotas dos
 * modulos, a documentacao.
 *
 * O que NAO protege: a casca (o HTML, o CSS, o JS das telas). Sem ela carregar
 * nao existe modal onde digitar o PIN, e a casca nao tem dado nenhum: suas
 * notas e conversas estao todas atras da API.
 *
 * LIMITE CONHECIDO: PIN curto e quebravel por tentativa e erro. O atraso
 * progressivo abaixo ajuda, mas na Vercel cada instancia tem a propria
 * memoria, entao o contador nao e confiavel entre requisicoes. Use PIN longo.
 */
import crypto from "crypto";

const PIN = String(process.env.PIN_ACESSO || "").trim();

export function pinAtivo() {
  return PIN.length > 0;
}

/** Comparacao de tempo constante. Puro o bastante pra testar. */
export function conferirPin(valor) {
  if (!pinAtivo()) return true;
  const a = Buffer.from(String(valor || ""), "utf8");
  const b = Buffer.from(PIN, "utf8");
  // timingSafeEqual exige mesmo tamanho; comparar o tamanho antes ja vaza um
  // bit, mas vazar "o PIN tem outro tamanho" e muito menos que vazar prefixo.
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b); // gasta o mesmo tempo, nao devolve nada
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/* Caminhos que passam sem PIN. A casca e o health, nada mais.
   Extensao no fim cobre os estaticos dos modulos (/conversa/conversa.js etc).

   MODULO NOVO PRECISA ENTRAR AQUI. Nao da pra liberar "qualquer caminho de um
   segmento so": /ideias, /insight e /backup tambem tem um segmento e SAO dados.
   Sem a entrada, a pagina do modulo cai no 401 e o navegador mostra o JSON cru
   em vez da tela. Foi o que aconteceu quando o treino entrou. */
const CASCA = ["/", "/trabalho", "/conversa", "/treino"];
const ESTATICO = /\.(js|mjs|css|html|svg|png|jpe?g|gif|webp|ico|webmanifest|woff2?|ttf|map)$/i;

/** Este caminho pode ser servido sem PIN? Puro. */
export function ehPublico(caminho) {
  const p = String(caminho || "").split("?")[0];
  if (p === "/health" || p === "/acesso") return true;
  if (CASCA.includes(p) || CASCA.includes(p.replace(/\/$/, ""))) return true;
  return ESTATICO.test(p);
}

/* Atraso progressivo por origem. Nao e rate limit de verdade: e o suficiente
   pra tentativa e erro manual ficar insuportavel. */
const falhas = new Map();
const TETO_FALHAS = 10;
const CASTIGO_MS = 60000;

function chaveDe(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || "anon").split(",")[0].trim();
}

function registrarFalha(req) {
  const k = chaveDe(req);
  const atual = falhas.get(k) || { erros: 0, ate: 0 };
  atual.erros += 1;
  if (atual.erros >= TETO_FALHAS) atual.ate = Date.now() + CASTIGO_MS;
  falhas.set(k, atual);
  return atual;
}

function limparFalha(req) {
  falhas.delete(chaveDe(req));
}

function espera(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Middleware. Deixa a casca passar e exige o PIN no resto. */
export async function exigirPin(req, res, next) {
  if (!pinAtivo()) return next();
  if (ehPublico(req.path)) return next();

  const k = chaveDe(req);
  const estado = falhas.get(k);
  if (estado && estado.ate > Date.now()) {
    const faltam = Math.ceil((estado.ate - Date.now()) / 1000);
    return res.status(429).json({ erro: `Muitas tentativas. Tente de novo em ${faltam}s.`, pin: true });
  }

  // Header, nao query string: query aparece em log de acesso e no historico.
  const enviado = req.headers["x-pin"] || req.headers["x-acesso"];
  if (conferirPin(enviado)) {
    limparFalha(req);
    return next();
  }

  const agora = registrarFalha(req);
  // atraso cresce com o erro; a primeira tentativa ainda responde rapido
  await espera(Math.min(agora.erros * 300, 3000));
  res.status(401).json({
    erro: enviado ? "PIN incorreto." : "Este sistema pede um PIN.",
    // a tela usa esta marca pra abrir o modal em vez de mostrar erro cru
    pin: true,
  });
}

/**
 * Conferencia do PIN, usada pelo modal antes de guardar no navegador.
 * Fica FORA do exigirPin (ehPublico deixa passar), senao nao haveria como
 * validar um PIN sem ja ter um PIN.
 */
export function rotaDeAcesso(app) {
  app.post("/acesso", async (req, res) => {
    if (!pinAtivo()) return res.json({ ok: true, exigido: false });

    const k = chaveDe(req);
    const estado = falhas.get(k);
    if (estado && estado.ate > Date.now()) {
      const faltam = Math.ceil((estado.ate - Date.now()) / 1000);
      return res.status(429).json({ ok: false, erro: `Muitas tentativas. Tente de novo em ${faltam}s.` });
    }

    const enviado = (req.body && req.body.pin) || req.headers["x-pin"];
    if (conferirPin(enviado)) {
      limparFalha(req);
      return res.json({ ok: true, exigido: true });
    }
    const agora = registrarFalha(req);
    await espera(Math.min(agora.erros * 300, 3000));
    res.status(401).json({ ok: false, erro: "PIN incorreto." });
  });

  // A tela pergunta isto na abertura: precisa pedir PIN ou nao?
  app.get("/acesso", (_req, res) => res.json({ exigido: pinAtivo() }));
}

/**
 * Meta: fez o Duolingo hoje?
 *
 * Usa o endpoint publico e NAO OFICIAL do perfil. Pode mudar ou ser bloqueado
 * sem aviso, por isso tudo aqui falha para "erro" e nunca derruba o balao.
 * Tem que rodar no servidor: do navegador o Duolingo bloqueia por CORS.
 *
 * Criterio: a ofensiva atual termina hoje (streakData.currentStreak.endDate),
 * comparando com a data no fuso local que o registro passa em `hoje`.
 * Precisa de perfil publico.
 */

const USUARIO = String(process.env.DUOLINGO_USUARIO || "").trim();
const URL_BASE = "https://www.duolingo.com/2017-06-30/users?username=";

/* Cache do perfil cru, nao do estado: o estado depende de `hoje` e e barato
   recalcular. 5 min basta pra nao consultar a cada carregamento do inicio.
   Na Vercel vale por instancia, entao e economia, nao garantia. */
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { em, perfil }

async function buscarPerfil() {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.perfil;

  const resp = await fetch(URL_BASE + encodeURIComponent(USUARIO), {
    headers: { Accept: "application/json" },
    // abaixo do prazo do registro (6s), pra falhar com mensagem propria
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`Duolingo respondeu HTTP ${resp.status}`);

  const dados = await resp.json();
  const perfil = dados && Array.isArray(dados.users) ? dados.users[0] : null;
  if (!perfil) throw new Error(`usuario "${USUARIO}" nao encontrado ou perfil privado`);

  cache = { em: Date.now(), perfil };
  return perfil;
}

function avatarDe(perfil) {
  // vem como "//d3gq3s1iyyx31w.cloudfront.net/...": sem protocolo e sem tamanho
  const p = String(perfil.picture || "");
  if (!p) return null;
  const base = p.startsWith("//") ? "https:" + p : p;
  return base.replace(/\/(small|medium|large|xlarge|xlarge400|xxlarge)$/, "") + "/large";
}

async function verificar({ hoje }) {
  if (!USUARIO) {
    return { estado: "erro", detalhe: "Defina DUOLINGO_USUARIO no ambiente." };
  }

  const perfil = await buscarPerfil();
  const ofensiva = Number(perfil.streak) || 0;
  const fim = perfil.streakData && perfil.streakData.currentStreak
    ? perfil.streakData.currentStreak.endDate
    : null;
  const feita = fim === hoje;

  let detalhe;
  if (feita) detalhe = `Ofensiva de ${ofensiva} ${ofensiva === 1 ? "dia" : "dias"}`;
  else if (ofensiva > 0) detalhe = `Faça a lição pra manter ${ofensiva} ${ofensiva === 1 ? "dia" : "dias"}`;
  else detalhe = "Nenhuma lição hoje";

  return {
    estado: feita ? "feita" : "pendente",
    titulo: "Duolingo",
    detalhe,
    imagem: avatarDe(perfil),
    destaque: { tipo: "ofensiva", valor: ofensiva, ativo: feita },
  };
}

export default { id: "duolingo", rotulo: "Duolingo", verificar };

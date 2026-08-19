// Cliente do Gemini, usado APENAS na geracao de insight e nas sugestoes.
//
// Sobre cota (o motivo desta complexidade toda): na camada gratuita o que
// aperta primeiro nao e o volume de tokens, e sim REQUISICOES por minuto e por
// dia. Uma chamada de insight gasta ~1.7k tokens, o que e irrelevante perto do
// limite de tokens; mas o limite de requisicoes estoura rapido. Por isso a
// estrategia aqui e: varias chaves em rodizio, com descanso por chave quando
// uma estoura, em vez de tentar economizar token.
//
// Ordem de tentativa: MODELO por fora, CHAVE por dentro. Assim esgotamos todas
// as chaves no modelo bom antes de cair pra um modelo pior.
//
// Config no .env:
//   GEMINI_API_KEYS   chaves separadas por virgula (recomendado)
//   GEMINI_API_KEY    chave unica (ainda funciona; usada se a de cima faltar)
//   GEMINI_MODELOS    modelos em ordem de preferencia, separados por virgula
//   GEMINI_THINKING   MINIMAL | LOW | MEDIUM | HIGH (padrao HIGH)

import { GoogleGenAI } from "@google/genai";

const clientes = new Map();   // chave -> instancia do SDK
const descanso = new Map();   // "chave|modelo" -> timestamp ate quando ficar de fora
const invalidas = new Set(); // chaves recusadas pela API (nao adianta reusar)
const semModelo = new Set(); // "chave|modelo" que a API disse nao existir
const descobertos = new Map(); // chave -> modelos que a propria API listou
let ponteiro = 0;             // rodizio: de qual chave comecar na proxima chamada

export function listaChaves() {
  const bruto = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "";
  return bruto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "coloque_sua_chave_aqui");
}

export function temGemini() {
  return listaChaves().length > 0;
}

function getCliente(chave) {
  if (!clientes.has(chave)) clientes.set(chave, new GoogleGenAI({ apiKey: chave }));
  return clientes.get(chave);
}

function listaModelos() {
  const bruto = process.env.GEMINI_MODELOS || process.env.GEMINI_MODEL;
  if (bruto) return bruto.split(",").map((m) => m.trim()).filter(Boolean);
  // padrao: flash primeiro (tem cota gratuita de verdade), depois o mais leve.
  // NAO usar 2.5-pro como padrao: na camada gratuita ele estoura quase de cara.
  // "flash-latest" primeiro de proposito: e um alias que acompanha o modelo
  // atual, entao sobrevive quando o Google aposenta uma versao especifica.
  // Se nenhum destes existir, o cliente descobre os modelos pela propria API.
  return ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
}

const ehCota = (msg) => /429|quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg);
const ehChaveRuim = (msg) =>
  /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|401|403/i.test(msg);
/* O Google aposenta modelos e libera modelos diferentes por chave: a mesma
   requisicao pode dar 429 numa chave (que tem acesso) e 404 noutra (que nao
   tem). Isso NAO e erro fatal: e so pular pra proxima combinacao. */
const ehModeloIndisponivel = (msg) =>
  /404|NOT_FOUND|not found|no longer available|is not supported|does not exist/i.test(msg);
const ehPensamentoInvalido = (msg) =>
  /thinking/i.test(msg) && /invalid|not supported|unknown|400/i.test(msg);

/** A propria API informa quanto esperar; se nao informar, assume 60s. */
function segundosDeEspera(msg) {
  // a mensagem costuma chegar como JSON ja stringificado, entao as aspas vem
  // escapadas (\"retryDelay\":\"48s\"). O padrao abaixo tolera os dois casos.
  const m = String(msg).match(/retryDelay["\\\s:]*(\d+)(?:\.\d+)?s/i);
  return m ? Number(m[1]) : 60;
}

/* A cota do Gemini e POR MODELO: estourar no flash nao significa estar sem cota
   no flash-lite. Por isso o descanso e da dupla chave+modelo, e nao da chave. */
function chaveDescanso(chave, modelo) { return chave + "|" + modelo; }

function emDescanso(chave, modelo) {
  const k = chaveDescanso(chave, modelo);
  const ate = descanso.get(k);
  if (!ate) return false;
  if (Date.now() >= ate) { descanso.delete(k); return false; }
  return true;
}

function porDescanso(chave, modelo, segundos) {
  descanso.set(chaveDescanso(chave, modelo), Date.now() + segundos * 1000);
}

/** Comeca de uma chave diferente a cada chamada, pra nao queimar sempre a primeira. */
function ordemRodizio(chaves) {
  const n = chaves.length;
  const inicio = ponteiro % n;
  const fora = [];
  for (let i = 0; i < n; i++) fora.push({ chave: chaves[(inicio + i) % n], indice: ((inicio + i) % n) + 1 });
  return fora;
}

/**
 * Pergunta a API quais modelos ESTA chave pode usar. Evita depender de nomes
 * fixos no codigo, que o Google aposenta sem aviso (foi o que aconteceu com o
 * gemini-2.5-flash, que virou 404 para chaves novas).
 */
async function modelosDaChave(chave) {
  if (descobertos.has(chave)) return descobertos.get(chave);
  let lista = [];
  try {
    const pager = await getCliente(chave).models.list();
    const itens = pager && pager.page ? pager.page : [];
    lista = itens
      .filter((m) => !m.supportedActions || m.supportedActions.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n && !/embedding|aqa|vision|image|tts|audio|veo|imagen/i.test(n));

    // preferencia: flash mais novo primeiro (rapido e com cota decente),
    // depois o resto. "latest"/"preview" ficam por ultimo por serem instaveis.
    const peso = (n) => {
      let p = 0;
      if (/flash/i.test(n)) p -= 10;
      if (/lite/i.test(n)) p -= 2;
      if (/pro/i.test(n)) p += 5;      // pro costuma nao ter cota gratuita
      if (/preview|exp|latest/i.test(n)) p += 3;
      const v = (n.match(/(\d+)\.(\d+)/) || [])[0];
      if (v) p -= parseFloat(v);        // versao maior primeiro
      return p;
    };
    lista.sort((a, b) => peso(a) - peso(b));
    console.log(`[gemini] modelos disponiveis nesta chave: ${lista.slice(0, 6).join(", ")}`);
    if (lista.length) {
      console.log(
        `[gemini] dica: ponha GEMINI_MODELOS=${lista.slice(0, 2).join(",")} no .env ` +
        `pra ir direto ao ponto nas proximas execucoes.`
      );
    }
  } catch (err) {
    console.warn("[gemini] nao consegui listar os modelos da chave:", err.message);
  }
  descobertos.set(chave, lista);
  return lista;
}

function limparCercas(texto) {
  return String(texto || "").replace(/```json|```/g, "").trim();
}

async function umaTentativa(chave, modelo, instrucaoSistema, prompt, opcoes, comPensamento) {
  const ai = getCliente(chave);
  const config = {
    systemInstruction: instrucaoSistema,
    temperature: opcoes.temperatura ?? 0.7,
    maxOutputTokens: opcoes.maxTokens ?? 8192,
    responseMimeType: "application/json",
  };
  if (comPensamento) {
    config.thinkingConfig = { thinkingLevel: process.env.GEMINI_THINKING || "HIGH" };
  }
  const resposta = await ai.models.generateContent({ model: modelo, contents: prompt, config });
  return resposta.text;
}

/**
 * Pede um JSON ao Gemini, percorrendo modelos e chaves ate conseguir.
 * Lanca erro so quando TODAS as combinacoes falharem.
 */
export async function gerarJSON(instrucaoSistema, prompt, opcoes = {}) {
  const chaves = listaChaves();
  if (!chaves.length) {
    throw new Error(
      "Nenhuma chave do Gemini configurada. Coloque GEMINI_API_KEYS no .env (pegue em https://aistudio.google.com)."
    );
  }

  const estado = { ultimoErro: null, tentativas: 0 };

  // 1a rodada: os modelos escolhidos no .env
  let r = await percorrer(chaves, listaModelos(), instrucaoSistema, prompt, opcoes, estado);
  if (r.ok) return r.dados;

  // 2a rodada: se nenhum dos configurados serviu, pergunta a API o que existe
  // nesta conta. E o que salva quando o Google aposenta um modelo.
  for (const chave of chaves) {
    if (invalidas.has(chave)) continue;
    const doServidor = (await modelosDaChave(chave)).filter((m) => !semModelo.has(chaveDescanso(chave, m)));
    if (!doServidor.length) continue;
    r = await percorrer([chave], doServidor.slice(0, 4), instrucaoSistema, prompt, opcoes, estado);
    if (r.ok) return r.dados;
  }

  const modelos = listaModelos();
  const emEspera = chaves.filter((c) => modelos.every((m) => emDescanso(c, m))).length;
  throw new Error(
    `Gemini indisponivel apos ${estado.tentativas} tentativa(s) em ${chaves.length} chave(s)` +
    (emEspera ? `. ${emEspera} chave(s) em espera por cota` : "") +
    `. Ultimo erro: ${estado.ultimoErro && estado.ultimoErro.message ? estado.ultimoErro.message : estado.ultimoErro}`
  );
}

/** Tenta cada modelo em cada chave. Devolve { ok, dados } no primeiro sucesso. */
async function percorrer(chaves, modelos, instrucaoSistema, prompt, opcoes, estado) {
  for (const modelo of modelos) {
    for (const { chave, indice } of ordemRodizio(chaves)) {
      if (invalidas.has(chave)) continue;
      if (semModelo.has(chaveDescanso(chave, modelo))) continue;
      if (emDescanso(chave, modelo)) continue;

      for (const comPensamento of [true, false]) {
        estado.tentativas++;
        try {
          const texto = limparCercas(
            await umaTentativa(chave, modelo, instrucaoSistema, prompt, opcoes, comPensamento)
          );
          if (!texto) throw new Error("resposta vazia");
          const dados = JSON.parse(texto);
          ponteiro++;
          console.log(
            `[gemini] ok com ${modelo} na chave ${indice}/${listaChaves().length}${comPensamento ? " (pensando)" : ""}`
          );
          return { ok: true, dados };
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          estado.ultimoErro = err;

          if (comPensamento && ehPensamentoInvalido(msg)) {
            console.warn(`[gemini] ${modelo} nao aceitou o modo de pensamento, repetindo sem ele.`);
            continue;
          }
          if (ehModeloIndisponivel(msg)) {
            semModelo.add(chaveDescanso(chave, modelo));
            console.warn(
              `[gemini] ${modelo} nao existe para a chave ${indice} (aposentado ou sem acesso). Pulando essa dupla.`
            );
            break;
          }
          if (ehCota(msg)) {
            const seg = segundosDeEspera(msg);
            porDescanso(chave, modelo, seg);
            console.warn(
              `[gemini] cota estourada na chave ${indice} em ${modelo}. Essa dupla descansa ${seg}s; seguindo.`
            );
            break;
          }
          if (ehChaveRuim(msg)) {
            invalidas.add(chave);
            console.error(`[gemini] chave ${indice} recusada pela API. Ignorando ela nesta execucao.`);
            break;
          }
          if (err instanceof SyntaxError) {
            console.warn(`[gemini] ${modelo} devolveu JSON invalido, tentando outra combinacao.`);
            break;
          }
          throw err; // erro mesmo (rede, bug): nao adianta insistir
        }
      }
    }
  }
  return { ok: false };
}

/** Estado das chaves, util pra diagnostico. */
export function estadoChaves() {
  const chaves = listaChaves();
  const modelos = listaModelos();
  return chaves.map((c, i) => {
    const porModelo = modelos.map((m) => {
      const ate = descanso.get(chaveDescanso(c, m));
      return {
        modelo: m,
        disponivel: !emDescanso(c, m),
        liberaEm: ate && ate > Date.now() ? Math.ceil((ate - Date.now()) / 1000) + "s" : null,
      };
    });
    return {
      chave: i + 1,
      final: "..." + c.slice(-4),
      invalida: invalidas.has(c),
      modelos: porModelo.map((m) => ({
        ...m,
        existe: !semModelo.has(chaveDescanso(c, m.modelo)),
      })),
      descobertosNaApi: (descobertos.get(c) || []).slice(0, 6),
    };
  });
}
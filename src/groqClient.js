// Cliente da Groq, com rodizio de chaves.
//
// Por que rodizio: a camada gratuita limita requisicoes por minuto E tokens por
// dia. Uma reconstrucao de ligacoes (relink) faz UMA chamada por nota; numa base
// de 50 notas isso passa de 90k tokens, o que estoura o teto diario e resulta
// em esperas de 15 minutos. Com varias chaves, quando uma esgota a gente troca.
//
// O descanso e por CHAVE+MODELO: estourar o teto do 70b nao significa estar sem
// cota no 8b, que tem limites bem mais folgados.
//
// Config no .env:
//   GROQ_API_KEYS        chaves separadas por virgula (recomendado)
//   GROQ_API_KEY         chave unica (compatibilidade)
//   GROQ_CHAT_MODEL      modelo padrao (analise de nota nova, insight de reserva)
//   GROQ_MODEL_RELINK    modelo do relink; use um pequeno, e trabalho em lote

const BASE_URL = "https://api.groq.com/openai/v1";

const descanso = new Map();   // "chave|modelo" -> timestamp de liberacao
const invalidas = new Set();  // chaves recusadas pela API
let ponteiro = 0;             // rodizio

export function listaChaves() {
  const bruto = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "";
  return bruto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "coloque_sua_chave_aqui");
}

function exigirChaves() {
  const chaves = listaChaves();
  if (!chaves.length) {
    throw new Error(
      "Nenhuma chave da Groq configurada. Coloque GROQ_API_KEYS no .env (varias, separadas por virgula)."
    );
  }
  return chaves;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const marca = (chave, modelo) => chave + "|" + modelo;

function emDescanso(chave, modelo) {
  const ate = descanso.get(marca(chave, modelo));
  if (!ate) return false;
  if (Date.now() >= ate) { descanso.delete(marca(chave, modelo)); return false; }
  return true;
}

function porDescanso(chave, modelo, ms) {
  descanso.set(marca(chave, modelo), Date.now() + ms);
}

/** A Groq manda "retry-after" em segundos e repete o tempo na mensagem. */
function esperaDoLimite(resposta, corpo) {
  const header = resposta.headers.get("retry-after");
  if (header && !Number.isNaN(Number(header))) return Number(header) * 1000;
  const m = String(corpo).match(/try again in (\d+(?:\.\d+)?)\s*(m|s)/i);
  if (m) return Math.ceil(parseFloat(m[1]) * (m[2].toLowerCase() === "m" ? 60000 : 1000));
  return 8000;
}

function ordemRodizio(chaves) {
  const n = chaves.length;
  const inicio = ponteiro % n;
  const fila = [];
  for (let i = 0; i < n; i++) {
    const idx = (inicio + i) % n;
    fila.push({ chave: chaves[idx], indice: idx + 1 });
  }
  return fila;
}

function parseJSONSeguro(texto) {
  const limpo = String(texto || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    throw new Error(`Nao foi possivel interpretar a resposta do modelo como JSON: ${limpo.slice(0, 200)}`);
  }
}

/* So deixa passar o que a API aceita. O historico vem do banco ou do
   cliente, entao nao da pra confiar no formato: uma entrada torta aqui
   derruba a chamada inteira com 400. */
function historicoLimpo(bruto) {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
    .filter((m) => m.content.trim());
}

async function umaChamada(chave, modelo, systemPrompt, userPrompt, opcoes = {}) {
  /* mensagens: turnos anteriores, no formato da propria API. Entram ENTRE o
     system e o userPrompt, que continua sendo o turno atual. Sem elas o corpo
     sai identico ao de antes. Achatar historico dentro do user prompt (que e o
     que o continuarInsight faz) serve pra insight, mas em conversa o modelo
     perde quem falou o que. */
  const historico = historicoLimpo(opcoes.mensagens);
  const resposta = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      // 0.2 continua o padrao: e o certo pra classificar nota. Conversa pede mais.
      temperature: opcoes.temperatura ?? 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...historico,
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resposta.ok) {
    const corpoErro = await resposta.text();
    const erro = new Error(`Groq ${resposta.status}: ${corpoErro.slice(0, 200)}`);
    if (resposta.status === 429 || resposta.status === 503) {
      erro.limiteAtingido = true;
      erro.esperaMs = esperaDoLimite(resposta, corpoErro);
    }
    if (resposta.status === 401 || resposta.status === 403) erro.chaveRuim = true;
    throw erro;
  }

  const dados = await resposta.json();
  return parseJSONSeguro(dados.choices?.[0]?.message?.content ?? "{}");
}

/**
 * Chat da Groq com resposta em JSON.
 * Devolve so os dados (compatibilidade). Use chatJSONDetalhado quando precisar
 * saber de qual chave/modelo a resposta saiu.
 * @param {object} [opcoes] { modelo, tentativas, temperatura, mensagens }
 */
export async function chatJSON(systemPrompt, userPrompt, opcoes = {}) {
  const { dados } = await chatJSONDetalhado(systemPrompt, userPrompt, opcoes);
  return dados;
}

/**
 * Igual ao chatJSON, mas devolve { dados, meta } com provedor/modelo/chave.
 * Percorre as chaves: se uma bate no limite, ela descansa e a proxima assume.
 * So espera de verdade quando TODAS estao em descanso.
 * @param {object} [opcoes] { modelo, tentativas, temperatura, mensagens }
 *        mensagens = [{ role: "user"|"assistant", content: string }], turnos
 *        anteriores da conversa. Opcional: sem elas o comportamento e o de antes.
 * @returns {Promise<{ dados: any, meta: { provedor, modelo, chave, totalChaves } }>}
 */
export async function chatJSONDetalhado(systemPrompt, userPrompt, opcoes = {}) {
  const chaves = exigirChaves();
  const modelo = opcoes.modelo || process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile";
  const maxRodadas = opcoes.tentativas ?? 3;
  let ultimoErro = null;

  for (let rodada = 1; rodada <= maxRodadas; rodada++) {
    let menorEspera = Infinity;

    for (const { chave, indice } of ordemRodizio(chaves)) {
      if (invalidas.has(chave)) continue;
      if (emDescanso(chave, modelo)) {
        const falta = descanso.get(marca(chave, modelo)) - Date.now();
        menorEspera = Math.min(menorEspera, Math.max(0, falta));
        continue;
      }
      try {
        const r = await umaChamada(chave, modelo, systemPrompt, userPrompt, opcoes);
        ponteiro++;
        return {
          dados: r,
          meta: { provedor: "groq", modelo, chave: indice, totalChaves: chaves.length },
        };
      } catch (err) {
        ultimoErro = err;
        if (err.limiteAtingido) {
          porDescanso(chave, modelo, err.esperaMs);
          menorEspera = Math.min(menorEspera, err.esperaMs);
          console.warn(
            `[groq] chave ${indice}/${chaves.length} no limite em ${modelo} ` +
            `(${Math.ceil(err.esperaMs / 1000)}s). Tentando a proxima.`
          );
          continue;
        }
        if (err.chaveRuim) {
          invalidas.add(chave);
          console.error(`[groq] chave ${indice}/${chaves.length} recusada. Ignorando ela.`);
          continue;
        }
        throw err; // erro real
      }
    }

    // todas em descanso: espera o menor tempo e tenta de novo
    if (rodada < maxRodadas && menorEspera !== Infinity) {
      const espera = Math.min(Math.max(500, menorEspera), 60000); // teto de 1 min por rodada
      console.warn(
        `[groq] todas as ${chaves.length} chave(s) no limite em ${modelo}. ` +
        `Esperando ${Math.ceil(espera / 1000)}s (rodada ${rodada}/${maxRodadas}).`
      );
      await dormir(espera);
    }
  }

  throw ultimoErro || new Error("Groq indisponivel.");
}

/** Estado das chaves, pra diagnostico. */
export function estadoChavesGroq() {
  const chaves = listaChaves();
  const modelos = [
    process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile",
    process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant",
  ];
  return chaves.map((c, i) => ({
    chave: i + 1,
    final: "..." + c.slice(-4),
    invalida: invalidas.has(c),
    modelos: modelos.map((m) => {
      const ate = descanso.get(marca(c, m));
      return {
        modelo: m,
        disponivel: !emDescanso(c, m),
        liberaEm: ate && ate > Date.now() ? Math.ceil((ate - Date.now()) / 1000) + "s" : null,
      };
    }),
  }));
}

// Nota: a Groq nao oferece endpoint de embeddings (so chat, Whisper e TTS).
// A geracao de embeddings vive em src/embeddings.js, rodando localmente.
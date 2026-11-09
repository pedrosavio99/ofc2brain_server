/**
 * IA do TrendRadar: so uma tarefa, gerar HIPOTESES a partir das manchetes reais.
 *
 * Regras que nao mudam:
 *  - O modelo recebe as manchetes e fala so delas. Nada de estatistica inventada.
 *  - Tudo que sai daqui e rotulado na tela como "hipotese da IA, a validar".
 *  - Se o modelo falhar, devolve null. NUNCA entrega um texto pronto "plausivel":
 *    dossie vazio e honesto, dossie de modelo pronto e mentira.
 */
import { chatJSONDetalhado } from "../../../src/groqClient.js";

export const FRENTES_VALIDAS = ["saude", "fintech", "regtech", "govtech", "operacoes", "ia_devtools"];

const SISTEMA = `Você é analista de produto B2B no Brasil. Recebe um ASSUNTO e as MANCHETES reais que a imprensa publicou sobre ele. Monte hipóteses para quem quer decidir se vale construir um software ou serviço para pequenas e médias empresas.

Regras:
- Fale só do que as manchetes e o bom senso de mercado sustentam. Nunca invente estatística, percentual, preço exato, lei ou empresa. Se não tem certeza de que um concorrente existe, não cite.
- Tudo aqui é HIPÓTESE a validar com clientes de verdade. Escreva assim ("provavelmente", "se for verdade que...").
- Não expanda siglas a não ser que a manchete traga o significado.
- Sem travessão. Português do Brasil, direto.

Responda SOMENTE com JSON:
{"nome":"título curto da oportunidade (até 80 caracteres)",
 "frente":"saude|fintech|regtech|govtech|operacoes|ia_devtools",
 "quemPaga":"tipo concreto de empresa que pagaria",
 "dores":["2 a 3 dores prováveis dessa empresa, concretas"],
 "concorrentesProvaveis":["até 3 tipos ou nomes de solução que provavelmente já existem, ou [] se não souber"],
 "testeRapido":"como validar em 7 dias sem gastar dinheiro, em 2 frases",
 "validar":["2 a 3 coisas que ainda não se sabe e precisam de conversa com cliente"]}`;

const limpa = (v, max) => String(v || "").replace(/\s+/g, " ").replace(/\s*—\s*/g, ", ").trim().slice(0, max);
const lista = (v, n, max) => (Array.isArray(v) ? v : []).map((x) => limpa(x, max)).filter((x) => x.length >= 6).slice(0, n);

/** Resposta do modelo -> hipoteses limpas, ou null se nao der pra aproveitar. Pura. */
export function sanearHipoteses(bruto) {
  if (!bruto || typeof bruto !== "object") return null;
  const nome = limpa(bruto.nome, 90);
  const dores = lista(bruto.dores, 3, 220);
  const quemPaga = limpa(bruto.quemPaga, 160);
  if (nome.length < 6 || !dores.length || quemPaga.length < 6) return null;
  return {
    nome,
    frente: FRENTES_VALIDAS.includes(String(bruto.frente)) ? String(bruto.frente) : null,
    quemPaga,
    dores,
    concorrentesProvaveis: lista(bruto.concorrentesProvaveis, 3, 80),
    testeRapido: limpa(bruto.testeRapido, 360),
    validar: lista(bruto.validar, 3, 200),
  };
}

/**
 * @param {{termo:string, manchetes:{titulo:string,fonte:string,data:string}[], dor?:string}} entrada
 * @returns {Promise<object|null>} hipoteses, ou null se a IA nao respondeu
 */
export async function gerarHipoteses({ termo, manchetes = [], dor = "" }) {
  const linhas = manchetes.slice(0, 8).map((m, i) => `[${i + 1}] (${m.fonte}, ${m.data}) ${m.titulo}`).join("\n");
  const usuario = `ASSUNTO: ${termo}\n${dor ? `LEITURA ANTERIOR: ${dor}\n` : ""}\nMANCHETES:\n${linhas || "(nenhuma manchete encontrada: diga que não há base e devolva hipóteses mínimas)"}`;
  for (const tent of [{ raciocinio: "low", maxTokens: 4000 }, { raciocinio: "low", maxTokens: 6000 }]) {
    try {
      const r = await chatJSONDetalhado(SISTEMA, usuario, {
        modelo: process.env.GROQ_MODEL_RADAR || process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
        temperatura: 0.3, tentativas: 1, ...tent,
      });
      const h = sanearHipoteses(r && r.dados);
      if (h) return { ...h, geradoPor: "groq", geradoEm: new Date().toISOString() };
    } catch (e) { console.warn("[radar] hipoteses: " + e.message); }
  }
  return null;
}

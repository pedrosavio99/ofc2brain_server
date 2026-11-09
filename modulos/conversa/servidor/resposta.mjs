/**
 * A RESPOSTA do modulo CONVERSA: prompt do turno e geracao.
 *
 * Mudancas de fundo em relacao a versao anterior:
 *
 *   TEXTO LIVRE, nao JSON. A fala saia dentro de {"mensagem": "..."} com
 *   responseMimeType=application/json. Formato forcado degrada o raciocinio
 *   (Tam et al. 2024) e, com thinking gastando o mesmo orcamento de tokens,
 *   truncava o JSON no meio ("devolveu JSON invalido"). Agora e texto.
 *
 *   SISTEMA ESTAVEL, TURNO VARIAVEL. O prompt de sistema traz so principios que
 *   valem em qualquer papel. O papel do turno (amigo, ouvinte, tecnico...) vem
 *   no prompt do turno, escolhido pelo planejador. Antes um unico prompt tentava
 *   ser tudo e mandava mencionar treino por conta propria.
 *
 *   ORDEM DO PROMPT. O que mais importa nas pontas, o menos importante no meio
 *   (Liu et al. 2023): contexto geral no comeco, evidencias, e no fim o papel
 *   do turno e a mensagem da pessoa.
 *
 *   MODELO MELHOR. O .env tinha so modelos flash-lite; a conversa agora tenta
 *   GEMINI_MODELOS_CONVERSA (ou gemini-3.5-flash) primeiro e cai pros lite.
 */
import { gerarTextoDetalhado, temGemini } from "../../../src/geminiClient.js";
import { chatTextoDetalhado } from "../../../src/groqClient.js";
import { blocoDaAlma } from "./alma.mjs";
import { blocoDoPanorama } from "./recuperacao.mjs";
import { instrucaoDoModo, transicao, resolverModo, tokensDoTurno } from "./modos.mjs";
import { agoraPorExtenso } from "./planejador.mjs";

export const SISTEMA = `Você é o segundo cérebro da pessoa com quem fala: a parte da cabeça dela que guardou tudo (notas, treinos, refeições, trabalho, memórias) e conversa de igual pra igual. Não é atendente nem assistente genérico.

Princípios, valem em qualquer papel:

1. Verdade antes de agrado. Só afirme o que está nas EVIDÊNCIAS, nas MEMÓRIAS ou na própria conversa. Nunca invente nota, data, número, nome, exercício ou lembrança. Se a evidência não cobre, diga que não achou e, se couber, o que chega perto.

2. Use a informação com critério. Ter o dado não é motivo pra citar o dado. Use só o que serve ao que a pessoa disse agora. Peso, altura e saúde só quando ela tocar no assunto ou for central. Nunca puxe treino, comida ou tarefa por conta própria numa conversa que não é sobre isso.

3. Cite com data natural ("a nota de terça", "em setembro", "há duas semanas"), nunca com id. Números exatos vêm das evidências, copiados, nunca arredondados de memória.

4. Conecte, não despeje. O valor está em ligar duas coisas que a pessoa não ligou (uma nota antiga com a situação de hoje), não em listar tudo que você achou. Tendência e padrão só quando os dados sustentam; senão diga que são poucos.

5. Fale como a pessoa fala (bloco COMO A PESSOA FALA, quando houver), sem caricatura e sem comentar isso.

6. Português do Brasil, natural. Sem travessão. Nada de "posso ajudar", "que interessante", "espero ter ajudado", nada de resumir o que a pessoa acabou de dizer. Trate a pessoa por "você".

7. O papel muda conforme o momento (amigo, ouvinte, interlocutor reflexivo, colega técnico, sparring, analista). A instrução do turno diz qual. A troca é invisível: nunca anuncie o papel nem diga que mudou de tom.

8. Você não é terapeuta e não diagnostica, mas pode ouvir, refletir e ajudar a pessoa a se entender. Se aparecer risco à vida ou autolesão, a instrução do turno muda, e a segurança da pessoa vem antes de qualquer outra coisa.

Formato: texto corrido, markdown leve (negrito e listas só quando ajudam; código em bloco com a linguagem). UMA resposta só, inteira, sem JSON, sem cercas em volta do texto todo.

Música: se a pessoa pedir pra tocar ou ouvir algo, reaja como parceiro e termine com a tag [TOCAR_MUSICA: artista, estilo ou música]. A tela toca na hora.`;

/* ------------------------------------------------------------- prompt */

/** Bloco das memorias. Base (fixadas) + as ligadas ao assunto, sem repetir. Puro. */
export function blocoDeMemorias(base = [], relacionadas = []) {
  const vistos = new Set();
  const linhas = [];
  for (const m of [...base, ...relacionadas]) {
    if (!m || vistos.has(m.id)) continue;
    vistos.add(m.id);
    linhas.push(`- ${m.fato}`);
  }
  if (!linhas.length) return "";
  return `QUEM É A PESSOA (memórias de conversas anteriores; use só o que serve a esta mensagem, sem recitar):\n${linhas.join("\n")}`;
}

/**
 * Prompt do turno. Pura, pra testar sem rede.
 * Ordem: contexto geral -> como a pessoa fala -> quem e -> evidencias -> papel
 * do turno -> mensagem. As pontas levam o que mais pesa.
 */
export function montarPromptTurno({ agora = new Date(), tracos = [], panorama = null, memoriasBase = [], memoriasRelacionadas = [], evidencia = "", plano, texto }) {
  const m = resolverModo(plano.modo);
  const ponte = transicao({ anterior: plano.modo_anterior, atual: m.id, cargaAnterior: plano.carga_anterior });
  const blocos = [
    `Agora: ${agoraPorExtenso(agora)}.`,
    blocoDaAlma(tracos),
    blocoDeMemorias(memoriasBase, memoriasRelacionadas),
    // em crise, o retrato geral da base so distrai
    m.id === "crise" ? "" : blocoDoPanorama(panorama),
    evidencia,
    instrucaoDoModo({ modo: m.id, secundario: plano.modo_secundario, tamanho: plano.tamanho, ponte }),
  ].filter(Boolean);

  const reescrita = plano.pergunta && plano.pergunta.trim() && plano.pergunta.trim() !== String(texto || "").trim()
    ? `\n(Em termos autossuficientes, a pessoa quer dizer: ${plano.pergunta.trim()})`
    : "";

  return `${blocos.join("\n\n")}\n\nMENSAGEM DA PESSOA (responda a esta):\n"""\n${String(texto || "").slice(0, 4000)}\n"""${reescrita}`;
}

/** Historico do banco no formato da API. Turnos velhos entram enxutos. Puro. */
export function historicoParaMensagens(turnos, { max = 16, recentes = 6 } = {}) {
  const lista = (Array.isArray(turnos) ? turnos : [])
    .filter((t) => t && t.texto && String(t.texto).trim())
    .slice(-max);
  return lista.map((t, i) => {
    const velho = i < lista.length - recentes;
    const texto = String(t.texto);
    return {
      role: t.papel === "pessoa" ? "user" : "assistant",
      // so a fala do cerebro e encurtada; o que a PESSOA disse nunca e cortado
      content: velho && t.papel !== "pessoa" && texto.length > 900 ? texto.slice(0, 900) + "…" : texto,
    };
  });
}

/* ------------------------------------------------------------ geracao */

/** Modelos da conversa: os do .env pra ela, ou um flash cheio na frente dos lite. */
export function modelosDaConversa() {
  const especificos = (process.env.GEMINI_MODELOS_CONVERSA || "").split(",").map((m) => m.trim()).filter(Boolean);
  if (especificos.length) return especificos;
  const doEnv = (process.env.GEMINI_MODELOS || process.env.GEMINI_MODEL || "").split(",").map((m) => m.trim()).filter(Boolean);
  // modelo inexistente nao quebra: o cliente pula (404) e segue pro proximo
  return [...new Set(["gemini-3.5-flash", ...doEnv])];
}

/**
 * Limpa a saida do modelo. Pura.
 *  - desembrulha JSON, por habito do modelo ({"mensagem": "..."});
 *  - tira travessao FORA de bloco de codigo (a regra de estilo do projeto, e
 *    prompt sozinho nao garante);
 *  - nao mexe em nada dentro de cerca de codigo.
 */
export function limparResposta(bruto) {
  let t = String(bruto || "").trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const j = JSON.parse(t);
      const v = typeof j.mensagem === "string" ? j.mensagem : Array.isArray(j.mensagens) ? j.mensagens.join("\n\n") : null;
      if (v) t = v.trim();
    } catch { /* nao e JSON: segue como texto */ }
  }
  const partes = t.split(/(```[\s\S]*?```)/g);
  t = partes.map((p, i) => (i % 2 === 1 ? p : p.replace(/\s*—\s*/g, ", "))).join("");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Gera a resposta: Gemini primeiro (texto livre, pensamento conforme o modo),
 * Groq de reserva. Lanca so se os dois falharem.
 * @returns {Promise<{texto:string, meta:object}>}
 */
export async function gerarResposta({ prompt, historico, plano }) {
  const modo = resolverModo(plano.modo);
  const maxTokens = tokensDoTurno(plano.modo, plano.tamanho);

  if (temGemini()) {
    try {
      const g = await gerarTextoDetalhado(SISTEMA, prompt, {
        temperatura: modo.temp, mensagens: historico, maxTokens,
        modelos: modelosDaConversa(), pensamento: modo.pensamento,
      });
      const texto = limparResposta(g.dados);
      if (texto) return { texto, meta: g.meta };
      console.warn("[conversa] gemini devolveu texto vazio, caindo pro groq");
    } catch (e) {
      console.warn("[conversa] gemini falhou, caindo pro groq: " + e.message);
    }
  }
  /* tentativas: 1 de proposito: cada rodada pode dormir ate 60s com as chaves
     em descanso. Aqui e melhor falhar rapido e avisar. */
  const q = await chatTextoDetalhado(SISTEMA, prompt, {
    temperatura: modo.temp, mensagens: historico, tentativas: 1,
    maxTokens: Math.min(maxTokens, 4096),
    raciocinio: modo.pensamento === "HIGH" ? "high" : modo.pensamento === "LOW" ? "low" : "medium",
  });
  const texto = limparResposta(q.dados);
  if (!texto) throw new Error("O modelo nao devolveu mensagem.");
  return { texto, meta: q.meta };
}

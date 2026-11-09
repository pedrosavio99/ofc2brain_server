/**
 * A MEMORIA de fatos do modulo CONVERSA.
 *
 * A "alma" (alma.mjs) guarda o JEITO de falar da pessoa. Faltava guardar QUEM
 * ela e: projetos, pessoas, rotina, decisoes, preferencias. E isso que faz um
 * assistente parecer que lembra de voce entre uma conversa e outra.
 *
 * Desenho (Mem0, Chhikara et al. 2025):
 *   1. EXTRAIR  fatos atomicos que a pessoa declarou na mensagem
 *   2. COMPARAR cada fato com as memorias parecidas que ja existem
 *   3. DECIDIR  ADD / UPDATE / DELETE / NOOP, um LLM por lote
 *
 * Travas, porque memoria errada contamina toda resposta depois:
 *   - so entra o que a pessoa AFIRMOU. Nada de inferir diagnostico ou intencao;
 *   - memoria `fixada` (escrita ou travada por voce) nunca e reescrita nem
 *     desativada pelo sistema;
 *   - o sistema nunca apaga de verdade: "DELETE" so desativa. Apagar e com voce,
 *     pela tela;
 *   - fato temporario carrega `valido_ate` e some sozinho;
 *   - nada de senha, documento ou cartao.
 *
 * Roda FORA do turno (rota /memorizar, chamada pela tela depois da resposta),
 * porque em serverless trabalho depois do response e descartado.
 */
import * as banco from "./banco.mjs";
import { gerarEmbeddings } from "../../../src/embeddings.js";
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { montarTsQuery, fundirConsultas, separarSemRerank } from "./busca.mjs";

export const CATEGORIAS = ["pessoa", "relacao", "trabalho", "projeto", "rotina", "preferencia", "decisao", "objetivo", "saude", "evento", "outro"];
const MAX_FATOS_POR_TURNO = 4;
const SIM_RELACIONADA = 0.6;

/* O SQL novo pode nao ter sido rodado ainda. Sem isto cada turno gastaria uma
   ida ao banco so pra descobrir de novo que a tabela nao existe. */
const estado = { ok: null, desde: 0 };
const RECHECAR_MS = 5 * 60 * 1000;

export function memoriaDisponivel() {
  if (estado.ok === false && Date.now() - estado.desde > RECHECAR_MS) estado.ok = null;
  return estado.ok !== false;
}

function marcarAusente(e) {
  if (e && (e.faltaTabela || e.faltaFuncao)) {
    estado.ok = false; estado.desde = Date.now();
    console.warn("[conversa] memorias indisponiveis: rode supabase/conversa-v2.sql.");
    return true;
  }
  return false;
}

const literal = (v) => "[" + v.map(Number).join(",") + "]";
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* ------------------------------------------------------------- leitura */

let baseCache = { em: 0, dados: [] };
const BASE_TTL_MS = 90 * 1000;

/** As memorias que entram em TODO turno (fixadas ou muito importantes). */
export async function memoriasBase() {
  if (!memoriaDisponivel()) return [];
  if (Date.now() - baseCache.em < BASE_TTL_MS) return baseCache.dados;
  try {
    const dados = await banco.memoriasFixadas(8);
    baseCache = { em: Date.now(), dados };
    estado.ok = true;
    return dados;
  } catch (e) {
    if (!marcarAusente(e)) console.warn("[conversa] memoriasBase: " + e.message);
    return [];
  }
}

/** A pessoa mexeu nas memorias: o cache nao pode servir a versao velha. */
export function invalidarCache() { baseCache = { em: 0, dados: [] }; }

/**
 * As memorias que se ligam ao assunto do turno (alem das de base).
 * Corte relativo: top-k do vetor SEMPRE devolve algo, e memoria que nao tem a
 * ver e pior que nenhuma (o modelo a cita com a mesma confianca das boas).
 */
export async function buscarMemorias({ consultas = [], embed, k = 8 }) {
  if (!memoriaDisponivel()) return [];
  const textos = [...new Set(consultas.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 3);
  if (!textos.length) return [];
  let vetores = textos.map(() => null);
  try { vetores = await embed(textos); } catch { /* so por palavra */ }

  try {
    const listas = await Promise.all(textos.map(async (t, i) => {
      const linhas = await banco.chamarRpc("buscar_memorias_hibrido", {
        q_lex: montarTsQuery([t]), q_emb: vetores[i] ? literal(vetores[i]) : null, k,
      });
      return (linhas || []).map((r) => ({ ...r, sim: Number(r.sim) || 0, lex_rank: r.lex_rank == null ? null : Number(r.lex_rank) }));
    }));
    estado.ok = true;
    const fundidas = fundirConsultas(listas, k);
    return separarSemRerank(fundidas, { piso: 0.5, folga: 0.07, maxFortes: 5, maxFracas: 0 }).fortes;
  } catch (e) {
    if (!marcarAusente(e)) console.warn("[conversa] buscarMemorias: " + e.message);
    return [];
  }
}

/* ------------------------------------------------------------- extracao */

const SISTEMA_EXTRAIR = `Você mantém a memória de longo prazo de uma pessoa. Leia a mensagem dela e extraia FATOS DURÁVEIS que ELA declarou.

O que vale registrar: pessoas e relações ("Irmão se chama Lucas"), trabalho e projetos, rotina, preferências, decisões tomadas, objetivos, eventos de vida, condições de saúde que ela mencionou, valores ou limites que ela declarou, planos com data.

O que NÃO vale: perguntas, humor passageiro, opinião sobre o assunto do dia, o que o assistente disse, dado de passagem ("hoje almocei arroz"), senhas, números de documento ou cartão, e qualquer coisa que ela não afirmou (nada de inferir diagnóstico, personalidade ou intenção).

Escreva cada fato como frase curta SEM sujeito e sem pronome ("Mora em Recife", "Prepara entrevista na empresa X pra sexta", "Evita glúten"). Um fato por item, autossuficiente (nada de "isso" ou "ele" soltos).

importancia: 1 (trivial) a 5 (central na vida dela).
validade: data AAAA-MM-DD se o fato é temporário e tem fim claro (viagem, prazo, evento), senão null.
categoria: ${CATEGORIAS.join(" | ")}

No máximo ${MAX_FATOS_POR_TURNO} fatos. Se não há nada durável, devolva a lista vazia: é o caso mais comum.
Responda SOMENTE com JSON: {"fatos":[{"fato":"...","categoria":"...","importancia":3,"validade":null}]}`;

const RE_SEGREDO = /\b(senha|password|cpf|rg|cartao|cvv|token|chave de api|api key)\b/i;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Saida crua do extrator -> candidatos validos. Pura. */
export function sanearCandidatos(bruto, hoje = new Date().toISOString().slice(0, 10)) {
  const lista = bruto && Array.isArray(bruto.fatos) ? bruto.fatos : [];
  const vistos = new Set();
  const saida = [];
  for (const f of lista) {
    const fato = String((f && f.fato) || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (fato.length < 6 || RE_SEGREDO.test(fato)) continue;
    const chave = norm(fato);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const validade = RE_DATA.test(String(f.validade || "")) && String(f.validade) >= hoje ? String(f.validade) : null;
    saida.push({
      fato,
      categoria: CATEGORIAS.includes(f.categoria) ? f.categoria : "outro",
      importancia: Math.max(1, Math.min(5, Math.round(Number(f.importancia) || 3))),
      validade,
    });
    if (saida.length >= MAX_FATOS_POR_TURNO) break;
  }
  return saida;
}

/* ------------------------------------------------------------- decisao */

const SISTEMA_DECIDIR = `Você mantém a memória de longo prazo de uma pessoa. Para cada FATO NOVO, decida o que fazer olhando as memórias parecidas que já existem.

Operações:
- ADD: o fato é novo e nenhuma memória parecida o cobre.
- UPDATE: o fato novo complementa ou atualiza uma memória existente. Informe o "id" dela e o texto FINAL já fundido (curto, completo, sem sujeito).
- DELETE: o fato novo CONTRADIZ uma memória existente que deixou de ser verdade. Informe o "id" dela. Neste caso devolva também um ADD com o fato novo.
- NOOP: já está coberto ou é redundante.

Nunca mexa em memória marcada FIXADA: use NOOP ou ADD.
"i" é o número do fato novo. Pode haver mais de uma operação com o mesmo "i" (DELETE + ADD).
Responda SOMENTE com JSON: {"ops":[{"i":1,"op":"ADD","id":null,"fato":null}]}`;

/**
 * Saida crua do decisor -> operacoes validas. Pura.
 * @param {object} bruto
 * @param {{cand:object, vizinhas:{id:string, fato:string, fixado:boolean}[]}[]} grupos
 */
export function sanearDecisoes(bruto, grupos) {
  const lista = bruto && Array.isArray(bruto.ops) ? bruto.ops : [];
  const ops = [];
  const cobertos = new Set();
  for (const o of lista) {
    const i = Number(o && o.i);
    const g = grupos[i - 1];
    if (!g) continue;
    const op = String((o && o.op) || "").toUpperCase();
    const viz = g.vizinhas.find((v) => v.id === o.id);
    if (op === "ADD") {
      ops.push({ op: "ADD", i, cand: g.cand });
      cobertos.add(i);
    } else if (op === "NOOP") {
      cobertos.add(i);
    } else if (op === "UPDATE" && viz && !viz.fixado) {
      const fato = String(o.fato || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (fato.length >= 6 && !RE_SEGREDO.test(fato)) { ops.push({ op: "UPDATE", i, id: viz.id, fato, cand: g.cand }); cobertos.add(i); }
    } else if (op === "DELETE" && viz && !viz.fixado) {
      ops.push({ op: "DELETE", i, id: viz.id });
    }
  }
  /* Candidato sem nenhuma decisao valida vira ADD: perder um fato real por um
     JSON torto e pior que uma memoria a mais (a pessoa apaga pela tela). */
  grupos.forEach((g, n) => { if (!cobertos.has(n + 1) && !ops.some((o) => o.i === n + 1 && o.op === "ADD")) ops.push({ op: "ADD", i: n + 1, cand: g.cand }); });
  return ops;
}

/* -------------------------------------------------------------- memorizar */

/**
 * Extrai e grava os fatos de UMA mensagem da pessoa.
 * @returns {Promise<{ok:boolean, motivo?:string, candidatos:number, add:number, update:number, desativadas:number, noop:number}>}
 */
export async function memorizar({ textoPessoa, contexto = [], conversaId = null, ordem = null, hoje = new Date().toISOString().slice(0, 10) }) {
  const zero = { ok: true, candidatos: 0, add: 0, update: 0, desativadas: 0, noop: 0 };
  if (!memoriaDisponivel()) return { ...zero, ok: false, motivo: "tabela memorias ausente: rode supabase/conversa-v2.sql" };

  const modelo = process.env.GROQ_MODEL_MEMORIA || process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

  // 1. extrair
  const antes = contexto.length ? `Mensagens anteriores dela (só pra entender referências):\n${contexto.map((t) => "- " + String(t).slice(0, 240)).join("\n")}\n\n` : "";
  const ex = await chatJSONDetalhado(SISTEMA_EXTRAIR,
    `Hoje: ${hoje}\n\n${antes}Mensagem dela:\n"""\n${String(textoPessoa || "").slice(0, 2000)}\n"""`,
    { modelo, temperatura: 0.1, raciocinio: "low", tentativas: 1 });
  const candidatos = sanearCandidatos(ex.dados, hoje);
  if (!candidatos.length) return { ...zero, motivo: "nada durável" };

  // 2. comparar com o que ja existe
  const vetores = await gerarEmbeddings(candidatos.map((c) => c.fato)).catch(() => candidatos.map(() => null));
  const grupos = [];
  for (let i = 0; i < candidatos.length; i++) {
    let vizinhas = [];
    try {
      const linhas = await banco.chamarRpc("buscar_memorias_hibrido", {
        q_lex: montarTsQuery([candidatos[i].fato]), q_emb: vetores[i] ? literal(vetores[i]) : null, k: 3,
      });
      vizinhas = (linhas || [])
        .filter((r) => r.lex_rank != null || Number(r.sim) >= SIM_RELACIONADA)
        .map((r) => ({ id: r.id, fato: r.fato, fixado: Boolean(r.fixado) }));
      estado.ok = true;
    } catch (e) {
      if (marcarAusente(e)) return { ...zero, ok: false, motivo: "SQL novo nao aplicado" };
      throw e;
    }
    grupos.push({ cand: { ...candidatos[i], vetor: vetores[i] }, vizinhas });
  }

  // 3. decidir. Sem vizinha em nenhum, e tudo ADD e nem precisa de modelo.
  let ops;
  const temVizinha = grupos.some((g) => g.vizinhas.length);
  if (!temVizinha) {
    ops = grupos.map((g, n) => ({ op: "ADD", i: n + 1, cand: g.cand }));
  } else {
    // fato identico a uma vizinha: nao gasta modelo nem grava duplicata
    const jaTem = (g) => g.vizinhas.some((v) => norm(v.fato) === norm(g.cand.fato));
    const pendentes = grupos.filter((g) => !jaTem(g));
    if (!pendentes.length) return { ...zero, candidatos: candidatos.length, noop: candidatos.length, motivo: "tudo já registrado" };
    const prompt = pendentes.map((g, n) =>
      `FATO NOVO ${n + 1}: ${g.cand.fato}\nMemórias parecidas:\n` +
      (g.vizinhas.length ? g.vizinhas.map((v) => `  - id=${v.id}${v.fixado ? " (FIXADA)" : ""}: ${v.fato}`).join("\n") : "  (nenhuma)")
    ).join("\n\n");
    const d = await chatJSONDetalhado(SISTEMA_DECIDIR, prompt, { modelo, temperatura: 0, raciocinio: "low", tentativas: 1 });
    ops = sanearDecisoes(d.dados, pendentes);
  }

  // 4. aplicar
  const r = { ...zero, candidatos: candidatos.length };
  for (const o of ops) {
    try {
      if (o.op === "ADD") {
        await banco.inserirMemoria({
          fato: o.cand.fato, categoria: o.cand.categoria, importancia: o.cand.importancia,
          validoAte: o.cand.validade, embedding: o.cand.vetor, origem: { conversaId, ordem },
        });
        r.add++;
      } else if (o.op === "UPDATE") {
        const [v] = await gerarEmbeddings([o.fato]).catch(() => [null]);
        await banco.atualizarMemoria(o.id, { fato: o.fato, embedding: v || undefined });
        r.update++;
      } else if (o.op === "DELETE") {
        await banco.atualizarMemoria(o.id, { ativo: false });
        r.desativadas++;
      }
    } catch (e) {
      console.warn(`[conversa] memorizar ${o.op}: ${e.message}`);
    }
  }
  r.noop = Math.max(0, candidatos.length - r.add - r.update);
  if (r.add || r.update || r.desativadas) invalidarCache();
  return r;
}

/**
 * SUGESTOES: o "feed" do segundo cerebro. Ao abrir a conversa, em vez de quatro
 * botoes fixos (comi o que hoje?), ele oferece assuntos que valem a pena AGORA,
 * tirados do que a pessoa de fato guardou:
 *
 *   retomar     fio solto: ideia, projeto ou decisao que parou de andar
 *   conexao     liga duas notas de epocas diferentes que a pessoa nao ligou
 *   lembrar     nota antiga que ganha sentido hoje ("ha 8 meses voce escreveu...")
 *   agora       prazo, lembrete ou tarefa chegando
 *   curiosidade um padrao ou pergunta que as notas sugerem
 *
 * Como e feito (sem inventar):
 *   1. GARIMPO, sem modelo: notas recentes, notas antigas amostradas (semente do
 *      dia, entao o conjunto muda a cada dia mas nao a cada abertura), eventos,
 *      tarefas, memorias e os titulos das conversas recentes (pra nao repetir).
 *   2. UMA chamada ao modelo, so com esse material, pedindo cartoes. Ele nao
 *      tem como citar o que nao esta no digest.
 *   3. SANEAMENTO: formato, tamanho, duplicata, tipos validos, no maximo 2 por tipo.
 *   4. Se o modelo falhar, cartoes por heuristica (eventos, tarefas, nota recente):
 *      a tela nunca fica vazia nem volta pro botao fixo.
 *
 * Privacidade: isto aparece NA TELA, as vezes perto de outras pessoas. Tema intimo
 * (saude, relacao, dinheiro, emocao) vai com redacao discreta no titulo.
 *
 * Cache de 40 min em memoria + o front guarda o do dia: abrir o app nao vira
 * uma chamada ao modelo a cada vez.
 */
import * as db from "../../../src/db.js";
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import * as clickup from "../../trabalho/servidor/clickup.mjs";
import * as banco from "./banco.mjs";
import { memoriasBase } from "./memoria.mjs";
import { corta, rotuloDaNota } from "./recuperacao.mjs";
import { agoraPorExtenso } from "./planejador.mjs";

const DIA_MS = 86400000;
const TTL_MS = 40 * 60000;
const TETO_MS = Number(process.env.TETO_SUGESTOES_MS) || 12000;
const TIPOS = ["retomar", "conexao", "lembrar", "agora", "curiosidade"];
const MAX_POR_TIPO = 2;
const MAX_CARTOES = 5;

/* --------------------------------------------------------------- puras */

/** Embaralhamento deterministico: mesma semente, mesma ordem. Puro. */
export function amostraDoDia(lista, n, semente) {
  let h = 2166136261;
  for (const c of String(semente)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const linhaNota = (n, tag, agora) =>
  `${tag} · ${rotuloDaNota(n.criado_em, agora)} · [${n.area || "sem área"}] ${corta(n.resumo || n.texto_original, 160)}`;

/**
 * O material que o modelo enxerga. Cada nota ganha uma etiqueta (N1, N2...):
 * o modelo cita por etiqueta e a gente nao depende dele copiar um id.
 * @returns {{texto:string, notas:Map<string,object>}}
 */
export function montarDigest({ agora = new Date(), recentes = [], antigas = [], eventos = [], tarefas = [], memorias = [], conversas = [] }) {
  const notas = new Map();
  let i = 0;
  const etiqueta = (n) => { const t = `N${++i}`; notas.set(t, n); return t; };

  const blocos = [`AGORA: ${agoraPorExtenso(agora)}`];
  if (recentes.length) blocos.push("NOTAS RECENTES (últimos dias):\n" + recentes.map((n) => linhaNota(n, etiqueta(n), agora)).join("\n"));
  if (antigas.length) blocos.push("NOTAS ANTIGAS PRA REDESCOBRIR (amostra):\n" + antigas.map((n) => linhaNota(n, etiqueta(n), agora)).join("\n"));
  if (eventos.length) blocos.push("EVENTOS/LEMBRETES PRÓXIMOS:\n" + eventos.map((e) => `- ${e.quando}: ${corta(e.resumo, 120)}`).join("\n"));
  if (tarefas.length) blocos.push("TAREFAS (vencidas ou pra hoje):\n" + tarefas.map((t) => `- [${t.prazo}] ${corta(t.name, 100)}`).join("\n"));
  if (memorias.length) blocos.push("O QUE JÁ SE SABE DA PESSOA:\n" + memorias.map((m) => `- ${corta(m.fato, 140)}`).join("\n"));
  if (conversas.length) blocos.push("CONVERSAS RECENTES (já conversado, não repita):\n" + conversas.map((c) => `- ${corta(c, 80)}`).join("\n"));
  return { texto: blocos.join("\n\n"), notas };
}

/** Cartoes do modelo -> cartoes limpos. Puro. */
export function sanearCartoes(bruto) {
  const lista = Array.isArray(bruto && bruto.cartoes) ? bruto.cartoes : [];
  const porTipo = {};
  const vistos = new Set();
  const out = [];
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const tipo = TIPOS.includes(String(c.tipo)) ? String(c.tipo) : null;
    const limpa = (v, max) => String(v || "").replace(/\s+/g, " ").replace(/\s*—\s*/g, ", ").trim().slice(0, max);
    const titulo = limpa(c.titulo, 56), gancho = limpa(c.gancho, 190), abrir = limpa(c.abrir, 160);
    if (!tipo || titulo.length < 4 || gancho.length < 10 || abrir.length < 6) continue;
    const k = titulo.toLowerCase();
    if (vistos.has(k) || (porTipo[tipo] || 0) >= MAX_POR_TIPO) continue;
    vistos.add(k); porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    out.push({ tipo, titulo, gancho, abrir });
    if (out.length >= MAX_CARTOES) break;
  }
  return out;
}

/** Plano B sem modelo: o que ja e fato (evento, prazo, nota recente). Puro. */
export function cartoesPorHeuristica({ eventos = [], tarefas = [], recentes = [] }) {
  const out = [];
  for (const e of eventos.slice(0, 2)) {
    out.push({ tipo: "agora", titulo: corta(e.resumo, 50), gancho: `Marcado ${e.quando}. Dá pra se preparar agora.`, abrir: `Me ajuda a me preparar pra ${corta(e.resumo, 70)}?` });
  }
  const t = tarefas[0];
  if (t) out.push({ tipo: "agora", titulo: corta(t.name, 50), gancho: `Tarefa ${t.prazo}. Vale decidir o próximo passo.`, abrir: `Qual o próximo passo pra "${corta(t.name, 70)}"?` });
  const n = recentes[0];
  if (n && (n.resumo || n.texto_original)) {
    out.push({ tipo: "retomar", titulo: corta(n.resumo || n.texto_original, 50), gancho: "Você anotou isso há pouco. Quer desenvolver?", abrir: `Quero desenvolver aquela nota: ${corta(n.resumo || n.texto_original, 90)}` });
  }
  return sanearCartoes({ cartoes: out });
}

const SISTEMA = `Você escolhe assuntos que uma pessoa vai querer conversar com o próprio "segundo cérebro" (um assistente que guardou as notas, memórias e rotina dela). Pense num feed muito bom: cada cartão é um convite específico e irresistível, que só faz sentido PRA ELA, hoje.

Você recebe apenas o material abaixo. Use SÓ ele. Nunca invente nota, data, nome ou fato.

Tipos:
- retomar: fio solto (ideia, projeto, decisão que parou). Algo que ela deixaria cair se ninguém lembrasse.
- conexao: liga DUAS notas de épocas diferentes que ela provavelmente não ligou (cite as duas pela data natural).
- lembrar: nota antiga que ganha sentido hoje.
- agora: prazo, lembrete ou tarefa chegando.
- curiosidade: um padrão ou pergunta que as notas sugerem e ela toparia explorar.

Regras:
- 4 a 5 cartões, variados (no máximo 2 do mesmo tipo). Pelo menos um deve ser leve ou curioso, não só pendência.
- "titulo": até 50 caracteres, específico (nunca "Seu projeto" ou "Uma ideia").
- "gancho": 1 ou 2 frases curtas, com data natural ("há 3 semanas", "em março"), que façam a pessoa querer abrir. Mostra o que você viu, sem enrolar e sem elogio vazio.
- "abrir": a primeira mensagem que a pessoa mandaria ao tocar no cartão, em PRIMEIRA PESSOA, natural, até 120 caracteres, que já puxa o assunto certo.
- Não repita o que já foi conversado recentemente.
- Tema íntimo (saúde, relacionamento, dinheiro, emoção forte): título discreto e neutro ("Um assunto pessoal em aberto"), sem detalhe exposto na tela; o "abrir" pode ser mais direto. Nada de cartão sobre crise ou dor pesada.
- Sem travessão. Português do Brasil, tom de amigo esperto, não de app.

Responda SOMENTE com JSON:
{"cartoes":[{"tipo":"retomar|conexao|lembrar|agora|curiosidade","titulo":"...","gancho":"...","abrir":"..."}]}`;

/* ------------------------------------------------------------ garimpo */

async function garimpar(agora) {
  const dia = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
  const iso = (ms) => new Date(ms).toISOString();
  const seguro = (p, vazio) => p.catch((e) => { console.warn("[sugestoes] " + e.message); return vazio; });

  const [recentesBrutas, antigasBrutas, eventosBrutos, tarefasBrutas, memorias, conversasBrutas] = await Promise.all([
    seguro(db.listarPorPeriodo(iso(agora.getTime() - 10 * DIA_MS), iso(agora.getTime() + DIA_MS)), []),
    seguro(db.listarPorPeriodo(iso(agora.getTime() - 420 * DIA_MS), iso(agora.getTime() - 25 * DIA_MS)), []),
    seguro(db.listarEventos(), []),
    seguro(clickup.buscarTasks({ fechadas: false }), []),
    seguro(memoriasBase(), []),
    seguro(banco.listarConversas({ limite: 8 }), []),
  ]);

  const utilidade = (n) => String(n.resumo || n.texto_original || "").trim().length >= 25;
  const recentes = recentesBrutas.filter(utilidade).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))).slice(0, 12);
  const antigas = amostraDoDia(antigasBrutas.filter((n) => utilidade(n) && String(n.texto_original || "").length >= 60), 8, dia);

  const eventos = eventosBrutos
    .map((n) => ({ t: new Date(n.data_evento).getTime(), resumo: n.resumo || n.texto_original }))
    .filter((e) => Number.isFinite(e.t) && e.t >= agora.getTime() - DIA_MS && e.t <= agora.getTime() + 10 * DIA_MS && e.resumo)
    .sort((a, b) => a.t - b.t).slice(0, 5)
    .map((e) => {
      const d = Math.round((e.t - agora.getTime()) / DIA_MS);
      return { resumo: e.resumo, quando: d <= 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias` };
    });

  const tarefas = (Array.isArray(tarefasBrutas) ? clickup.ordenarPorPrazo(tarefasBrutas) : [])
    .filter((t) => t.prazo === "vencida" || t.prazo === "hoje").slice(0, 5);

  const conversas = conversasBrutas.map((c) => c.titulo).filter(Boolean).slice(0, 6);
  return { recentes, antigas, eventos, tarefas, memorias: (memorias || []).slice(0, 8), conversas };
}

/* ----------------------------------------------------------- orquestra */

let cache = { em: 0, chave: "", dados: null };
let emVoo = null;

/**
 * @returns {Promise<{cartoes:object[], fonte:'modelo'|'heuristica'|'vazio', gerado_em:string}>}
 */
export async function gerarSugestoes({ agora = new Date(), forcar = false } = {}) {
  const chave = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
  if (!forcar && cache.dados && cache.chave === chave && Date.now() - cache.em < TTL_MS) return cache.dados;
  if (emVoo && !forcar) return emVoo;

  emVoo = (async () => {
    const material = await garimpar(agora);
    const temAlgo = material.recentes.length || material.antigas.length || material.eventos.length || material.tarefas.length;
    let dados;
    if (!temAlgo) {
      dados = { cartoes: [], fonte: "vazio", gerado_em: agora.toISOString() };
    } else {
      let cartoes = [];
      try {
        const { texto } = montarDigest({ agora, ...material });
        const chamada = chatJSONDetalhado(SISTEMA, texto, {
          modelo: process.env.GROQ_MODEL_SUGESTOES || process.env.GROQ_MODEL_PLANEJADOR || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
          temperatura: 0.8, raciocinio: "medium", tentativas: 1, maxTokens: 2500,
        });
        const r = await Promise.race([
          chamada,
          new Promise((_, rej) => setTimeout(() => rej(new Error(`sem resposta em ${TETO_MS / 1000}s`)), TETO_MS)),
        ]);
        cartoes = sanearCartoes(r && r.dados);
      } catch (e) {
        console.warn("[sugestoes] modelo falhou, usando heuristica: " + e.message);
      }
      dados = cartoes.length
        ? { cartoes, fonte: "modelo", gerado_em: agora.toISOString() }
        : { cartoes: cartoesPorHeuristica(material), fonte: "heuristica", gerado_em: agora.toISOString() };
    }
    cache = { em: Date.now(), chave, dados };
    return dados;
  })().finally(() => { emVoo = null; });
  return emVoo;
}

export function invalidarSugestoes() { cache = { em: 0, chave: "", dados: null }; }

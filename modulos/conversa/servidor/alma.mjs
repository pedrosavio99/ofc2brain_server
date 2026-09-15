/**
 * A alma do modulo CONVERSA.
 *
 * A alma NAO e um perfil psicologico: e o JEITO DE FALAR da pessoa, pra ele
 * responder no mesmo registro. Vocabulario, tamanho de frase, grau de rodeio,
 * o que irrita numa resposta. Isso e observavel na conversa e verificavel por
 * voce; "ela pensa assim" nao e nem uma coisa nem outra.
 *
 * Fica em alma_tracos, uma linha por traco, com contagem de repeticao. A
 * tabela `alma` guarda so o controle (versao, turnos_lidos) e uma observacao
 * livre que VOCE escreve.
 *
 * Traco com fixado = true foi escrito por voce. O destilador nao reescreve nem
 * apaga: e a trava contra o modelo redestilar por cima do proprio erro.
 *
 * A destilacao roda FORA do turno de conversa, na rota /destilar.
 */
import { createClient } from "@supabase/supabase-js";
import { chatJSON } from "../../../src/groqClient.js";

if (typeof globalThis.WebSocket === "undefined") {
  const { default: WS } = await import("ws");
  globalThis.WebSocket = WS;
}

const URL = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const sb = createClient(URL || "http://invalido", KEY || "invalido", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const TURNOS_ENTRE_DESTILACOES = 20;
/* Teto por destilacao. Sem ele, uma conversa longa gera 30 tracos de uma vez e
   a tabela deixa de ser legivel exatamente quando voce mais precisaria ler. */
export const MAX_TRACOS_POR_VEZ = 6;

const ALMA_VAZIA = { perfil: "", versao: 0, turnos_lidos: 0, atualizado_em: null };

export async function lerAlma() {
  const { data, error } = await sb
    .from("alma").select("perfil, versao, turnos_lidos, atualizado_em")
    .eq("id", "unica").maybeSingle();
  if (error) throw new Error(`lerAlma: ${error.message}`);
  return data || { ...ALMA_VAZIA };
}

export async function salvarAlma(perfil, turnosLidos) {
  const atual = await lerAlma();
  const patch = { versao: (atual.versao || 0) + 1, atualizado_em: new Date().toISOString() };
  if (typeof perfil === "string") patch.perfil = perfil.trim().slice(0, 800);
  if (Number.isFinite(Number(turnosLidos))) patch.turnos_lidos = Number(turnosLidos);
  const { data, error } = await sb
    .from("alma").update(patch).eq("id", "unica")
    .select("perfil, versao, turnos_lidos, atualizado_em").single();
  if (error) throw new Error(`salvarAlma: ${error.message}`);
  return data;
}

const ROTULO = {
  vocabulario: "Palavras e expressoes que ela usa",
  ritmo: "Ritmo e tamanho",
  tom: "Tom",
  formato: "Formato da resposta",
  evitar: "O que NAO fazer",
  geral: "Outros",
};

/**
 * O pedaco da alma que entra no prompt do chat. Puro.
 * Alma vazia NAO vira silencio: vira instrucao pra ele reparar em como voce
 * fala, que e o unico jeito de a tabela sair do zero.
 */
export function blocoDaAlma(tracos) {
  const ativos = (Array.isArray(tracos) ? tracos : []).filter((t) => t && t.ativo !== false);
  if (!ativos.length) {
    return (
      "Voce ainda nao sabe como essa pessoa fala. Nao invente um registro.\n" +
      "Espelhe o jeito dela nesta conversa e repare no vocabulario: isso vira memoria depois."
    );
  }
  const porCat = new Map();
  for (const t of ativos) {
    const c = ROTULO[t.categoria] ? t.categoria : "geral";
    if (!porCat.has(c)) porCat.set(c, []);
    porCat.get(c).push(t);
  }
  const partes = [];
  for (const [cat, lista] of porCat) {
    const linhas = lista
      .sort((a, b) => (b.vezes || 1) - (a.vezes || 1))
      .map((t) => `- ${t.traco}${t.exemplo ? ` (ex: "${String(t.exemplo).slice(0, 80)}")` : ""}`);
    partes.push(`${ROTULO[cat]}:\n${linhas.join("\n")}`);
  }
  return (
    "COMO ELA FALA. Responda no mesmo registro, sem imitar de forma caricata e\n" +
    "sem comentar que voce esta fazendo isso:\n\n" + partes.join("\n\n")
  );
}

export function precisaDestilar(alma, totalTurnos, aCada = TURNOS_ENTRE_DESTILACOES) {
  const lidos = Number(alma && alma.turnos_lidos) || 0;
  const total = Number(totalTurnos) || 0;
  return total - lidos >= aCada;
}

const corta = (t, n) => {
  const s = String(t || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
};

/** Os turnos crus viram texto pro destilador. Puro. */
export function blocoDosTurnos(turnos) {
  const lista = Array.isArray(turnos) ? turnos : [];
  if (!lista.length) return "(sem turnos novos)";
  return lista
    .map((t) => `${t.papel === "pessoa" ? "ELA" : "VOCE"}: ${corta(t.texto, 400)}`)
    .join("\n");
}

const SISTEMA_DESTILAR = `Voce observa COMO uma pessoa escreve, pra outro sistema conseguir falar no mesmo registro que ela.

Voce so registra JEITO DE FALAR. Nunca conteudo, nunca opiniao dela, nunca personalidade, nunca diagnostico.
- Serve: "usa blz e vms", "escreve tudo minusculo", "frases curtas, sem virgula", "corta assunto sem aviso", "nao gosta de resposta que comeca resumindo o que ela disse".
- Nao serve: "gosta de tecnologia", "e ansiosa", "trabalha com eventos", "se preocupa com preco".

Regras:
- So registre o que aparece MAIS DE UMA VEZ nos turnos, ou com muito peso numa vez so. Uma palavra solta nao e traco.
- Olhe so o que ELA escreveu. O que VOCE respondeu esta ali so pra dar contexto.
- Nada de saude, dinheiro, religiao, politica ou vida intima, nem como exemplo.
- Os tracos que ja existem podem ser repetidos se aparecerem de novo: repetir e util, e como o sistema conta a frequencia. Nao repita traco marcado como FIXADO.
- No maximo 6 tracos. Se nao houver nada novo, devolva a lista vazia.
- Cada traco em uma frase curta, em portugues.

categoria e uma de: vocabulario, ritmo, tom, formato, evitar

Responda SOMENTE com JSON:
{"tracos": [{"traco": "...", "categoria": "...", "exemplo": "trecho curto dela ou null"}], "observacao": "uma frase"}`;

const CATEGORIAS = ["vocabulario", "ritmo", "tom", "formato", "evitar", "geral"];

/**
 * Le os turnos novos e devolve tracos candidatos. NAO grava: quem grava e a
 * rota, pra poder registrar um por um pela RPC que deduplica.
 * @returns {Promise<{ tracos: object[], observacao: string }>}
 */
export async function destilar({ tracos = [], turnos = [] }) {
  const existentes = (tracos || []).filter((t) => t.ativo !== false);
  const fixados = existentes.filter((t) => t.fixado);

  const prompt =
    (existentes.length
      ? `Tracos ja registrados:\n${existentes.map((t) => `- [${t.categoria}] ${t.traco}${t.fixado ? "  (FIXADO)" : ""}`).join("\n")}\n\n`
      : "Nenhum traco registrado ainda: esta e a primeira leitura.\n\n") +
    (fixados.length ? "Os FIXADOS foram escritos pela propria pessoa. Nao proponha nada que os contradiga.\n\n" : "") +
    `Turnos novos:\n${blocoDosTurnos(turnos)}`;

  const r = await chatJSON(SISTEMA_DESTILAR, prompt, { temperatura: 0.3 });

  const fixadoTexto = new Set(fixados.map((t) => String(t.traco).trim().toLowerCase()));
  const limpos = (Array.isArray(r && r.tracos) ? r.tracos : [])
    .map((t) => ({
      traco: String((t && t.traco) || "").trim().slice(0, 160),
      categoria: CATEGORIAS.includes(t && t.categoria) ? t.categoria : "geral",
      exemplo: t && t.exemplo ? String(t.exemplo).trim().slice(0, 120) : null,
    }))
    .filter((t) => t.traco && !fixadoTexto.has(t.traco.toLowerCase()))
    .slice(0, MAX_TRACOS_POR_VEZ);

  return { tracos: limpos, observacao: String((r && r.observacao) || "") };
}

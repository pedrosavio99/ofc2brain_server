/**
 * O CATALOGO de ferramentas do segundo cerebro. So especificacao, zero I/O.
 *
 * Fica separado da implementacao (ferramentas.mjs) por dois motivos:
 *   - o planejador e o servidor MCP precisam saber O QUE existe e QUAIS
 *     argumentos cada uma aceita sem importar banco, ClickUp e companhia;
 *   - da pra testar a validacao de argumentos sem rede.
 *
 * Uma unica definicao alimenta tres consumidores: o prompt do planejador, a
 * execucao dentro da conversa e as tools do endpoint MCP. Se uma ferramenta
 * muda aqui, muda nos tres.
 *
 * tipo de argumento: "texto" | "numero" | "lista" (de textos) | "escolha"
 */

export const ESPEC = {
  buscar_notas: {
    fonte: "notas",
    descricao:
      "Busca nas notas guardadas, por significado E por palavra. Use pra qualquer assunto, ideia, pessoa, " +
      "projeto ou lembrança que a pessoa possa ter anotado.",
    args: {
      consultas: {
        tipo: "lista", max: 3,
        descricao: "1 a 3 consultas curtas e autossuficientes (nada de 'isso' ou 'ele' soltos). Varie o ângulo.",
      },
    },
  },
  notas_por_periodo: {
    fonte: "notas",
    descricao: "Notas guardadas num período: 'o que anotei hoje', 'ontem', 'semana passada'. Filtro por data, não busca.",
    args: {
      dias: { tipo: "numero", min: 1, max: 365, padrao: 7, descricao: "Últimos N dias (a data escrita na mensagem tem prioridade)." },
    },
  },
  buscar_memoria: {
    fonte: "memoria",
    descricao:
      "Fatos duráveis que a pessoa já contou em conversas (projetos, pessoas, rotina, decisões, preferências). " +
      "Barata. Use sempre que a resposta puder depender de quem a pessoa é.",
    args: {
      consultas: { tipo: "lista", max: 3, descricao: "Assuntos a lembrar sobre a pessoa." },
    },
  },
  buscar_conversas: {
    fonte: "conversas",
    descricao: "Conversas passadas com o segundo cérebro, por palavra. Use pra 'a gente já falou disso', 'o que eu te disse sobre'.",
    args: {
      termos: { tipo: "lista", max: 4, descricao: "Palavras-chave que apareceriam na conversa antiga." },
    },
  },
  ver_treinos: {
    fonte: "treino",
    descricao: "Treinos: sessões, exercícios, calorias, esforço, progresso do ciclo de 14 dias e ciclos anteriores.",
    args: {
      dias: { tipo: "numero", min: 1, max: 60, padrao: 14, descricao: "Janela em dias." },
    },
  },
  ver_refeicoes: {
    fonte: "refeicao",
    descricao: "Refeições: o que comeu, calorias e macros por dia, comparado com a meta calórica.",
    args: {
      dias: { tipo: "numero", min: 1, max: 30, padrao: 3, descricao: "Janela em dias (1 = só hoje)." },
    },
  },
  ver_peso: {
    fonte: "peso",
    descricao: "Histórico de peso e perfil corporal (altura, nível, restrições). Só quando a pessoa falar de peso, corpo ou evolução física.",
    args: {
      limite: { tipo: "numero", min: 2, max: 60, padrao: 12, descricao: "Quantas pesagens." },
    },
  },
  ver_metas: {
    fonte: "metas",
    descricao: "Metas de hoje (ex.: Duolingo) e se foram cumpridas.",
    args: {},
  },
  ver_tarefas: {
    fonte: "tarefas",
    descricao: "Tarefas do trabalho (ClickUp): vencidas, de hoje, da semana, status.",
    args: {
      foco: { tipo: "escolha", opcoes: ["hoje", "vencidas", "semana", "todas"], padrao: "todas", descricao: "Qual recorte." },
    },
  },
  ver_lembretes: {
    fonte: "lembretes",
    descricao: "Lembretes e eventos marcados nas notas (compromissos, prazos, datas).",
    args: {
      dias: { tipo: "numero", min: 1, max: 120, padrao: 30, descricao: "Próximos N dias." },
    },
  },
  ver_radar: {
    fonte: "radar",
    descricao: "TrendRadar: oportunidades de mercado mapeadas. Só se a pessoa falar de mercado, tendência ou oportunidade.",
    args: {},
  },
};

export const NOMES_FERRAMENTAS = Object.keys(ESPEC);

/* Estas duas rodam em TODO turno, mesmo que o planejador nao peca: sao baratas
   (um embedding compartilhado) e sao o que da ao modelo a pessoa por tras da
   mensagem. Fora no modo crise, que corta tudo menos a memoria. */
export const SEMPRE = ["buscar_memoria"];

/** Descricao das ferramentas pro prompt do planejador. Pura. */
export function descreverParaPlanejador() {
  return NOMES_FERRAMENTAS.map((nome) => {
    const e = ESPEC[nome];
    const args = Object.entries(e.args)
      .map(([k, a]) => `${k}${a.tipo === "lista" ? "[]" : ""}`)
      .join(", ");
    return `- ${nome}(${args}): ${e.descricao}`;
  }).join("\n");
}

const limitar = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Valida e normaliza os argumentos de UMA ferramenta contra a especificacao.
 * Nunca lanca: argumento torto vira o padrao. Pura.
 * Entrada vem de um LLM ou de um cliente MCP, entao nada aqui e confiavel.
 */
export function sanearArgs(nome, brutos) {
  const espec = ESPEC[nome];
  if (!espec) return {};
  const entrada = brutos && typeof brutos === "object" && !Array.isArray(brutos) ? brutos : {};
  const saida = {};
  for (const [k, def] of Object.entries(espec.args)) {
    const v = entrada[k];
    if (def.tipo === "lista") {
      const lista = (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
        .map((x) => String(x ?? "").replace(/\s+/g, " ").trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, def.max || 3);
      if (lista.length) saida[k] = lista;
    } else if (def.tipo === "numero") {
      const n = Number(v);
      saida[k] = Number.isFinite(n) ? limitar(Math.round(n), def.min, def.max) : def.padrao;
    } else if (def.tipo === "escolha") {
      const s = String(v ?? "").toLowerCase();
      saida[k] = def.opcoes.includes(s) ? s : def.padrao;
    } else {
      const s = String(v ?? "").trim().slice(0, 300);
      if (s) saida[k] = s;
    }
  }
  return saida;
}

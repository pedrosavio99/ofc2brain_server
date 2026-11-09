/**
 * O PACOTE DE EVIDENCIAS: o que as ferramentas trouxeram, arrumado pro prompt.
 *
 * Tres decisoes de projeto:
 *   1. ROTULADO por fonte e por data. O modelo precisa saber de onde veio cada
 *      coisa pra citar com data natural e pra nao misturar nota com treino.
 *   2. COM ORCAMENTO. Contexto demais afoga a pergunta (Liu et al. 2023): o
 *      pacote tem teto de caracteres e, ao estourar, corta no fim de linha e
 *      AVISA, pra o modelo nao afirmar que aquilo e tudo que existe.
 *   3. O QUE NAO ACHOU tambem e evidencia. "Consultei as notas e nada saiu"
 *      e o que impede o modelo de inventar uma nota pra preencher o buraco.
 *
 * Puro: recebe resultados, devolve texto. Da pra testar sem rede.
 */
import { ehSensivel } from "./modos.mjs";

export const ORCAMENTO_EVIDENCIA = Number(process.env.CONVERSA_ORCAMENTO_EVIDENCIA) || 14000;

const TITULOS = {
  buscar_notas: "NOTAS GUARDADAS (busca por significado e por palavra)",
  notas_por_periodo: "NOTAS DO PERÍODO PEDIDO",
  buscar_conversas: "CONVERSAS ANTIGAS COM O SEGUNDO CÉREBRO",
  ver_treinos: "TREINOS",
  ver_refeicoes: "REFEIÇÕES",
  ver_peso: "PESO E PERFIL CORPORAL",
  ver_metas: "METAS DE HOJE",
  ver_tarefas: "TAREFAS DO TRABALHO",
  ver_lembretes: "LEMBRETES E EVENTOS",
  ver_radar: "TRENDRADAR",
};

const ROTULO_CURTO = {
  buscar_notas: "notas", notas_por_periodo: "notas do período", buscar_conversas: "conversas antigas",
  ver_treinos: "treinos", ver_refeicoes: "refeições", ver_peso: "peso", ver_metas: "metas",
  ver_tarefas: "tarefas", ver_lembretes: "lembretes", ver_radar: "radar",
};

/** Corta no ultimo fim de linha que cabe. Pura. */
export function cortarEmLinhas(texto, max) {
  const t = String(texto || "");
  if (t.length <= max) return { texto: t, cortou: false };
  const janela = t.slice(0, max);
  const fim = janela.lastIndexOf("\n");
  return { texto: (fim > max * 0.4 ? janela.slice(0, fim) : janela).trimEnd(), cortou: true };
}

/**
 * Monta o pacote.
 * @param {object[]} resultados saida do executarPlano (mesma ordem do plano)
 * @param {{orcamento?:number}} [opcoes]
 * @returns {{texto:string, fontes:object[], semResultado:object[], ids:string[], achado:object, resumosRapida:object[]}}
 */
export function montarEvidencia(resultados, { orcamento = ORCAMENTO_EVIDENCIA } = {}) {
  // memoria tem secao propria no prompt ("quem e a pessoa"), nao entra aqui
  const lista = (Array.isArray(resultados) ? resultados : []).filter((r) => r && r.nome !== "buscar_memoria");

  const comDado = lista.filter((r) => !r.vazio && !r.erro);
  const semDado = lista.filter((r) => r.vazio || r.erro);

  let restante = orcamento;
  const blocos = [];
  const fontes = [];
  for (const r of comDado) {
    if (restante < 300) {
      fontes.push({ ferramenta: r.nome, itens: r.itens, chars: 0, omitida: true });
      continue;
    }
    const { texto, cortou } = cortarEmLinhas(r.texto, restante);
    const aviso = cortou ? "\n(…cortado por tamanho: há mais registros do que couberam aqui. Não afirme que isto é tudo.)" : "";
    blocos.push(`### ${TITULOS[r.nome] || r.nome.toUpperCase()}\n${texto}${aviso}`);
    restante -= texto.length + aviso.length;
    fontes.push({ ferramenta: r.nome, itens: r.itens, chars: texto.length, cortou, ms: r.ms });
  }

  const semResultado = semDado.map((r) => ({ ferramenta: r.nome, motivo: r.texto, erro: r.erro || null }));
  if (semResultado.length) {
    blocos.push(
      "### CONSULTADO SEM RESULTADO\n" +
      semResultado.map((s) => `- ${ROTULO_CURTO[s.ferramenta] || s.ferramenta}: ${s.motivo}`).join("\n") +
      "\nSe a pessoa perguntar disso, diga que consultou e não achou. Não invente."
    );
  }

  // numeros pra tela: so as ferramentas de nota alimentam o "N notas usadas"
  const doNotas = lista.filter((r) => (r.nome === "buscar_notas" || r.nome === "notas_por_periodo") && r.meta);
  const areas = [...new Set(doNotas.flatMap((r) => r.meta.areas || []))];
  const achado = {
    total: doNotas.reduce((s, r) => s + (r.meta.total || 0), 0),
    fortes: doNotas.reduce((s, r) => s + (r.meta.fortes || 0), 0),
    areas,
  };
  const ids = [...new Set(lista.flatMap((r) => r.ids || []))];
  const resumosRapida = doNotas.flatMap((r) => r.meta.resumos || []).slice(0, 5);

  return {
    texto: blocos.length ? "=== O QUE FOI CONSULTADO PARA ESTA MENSAGEM ===\n\n" + blocos.join("\n\n") : "",
    fontes, semResultado, ids, achado, resumosRapida,
  };
}

/* Como cada fonte aparece na frase da camada 1. */
const FRASE_FONTE = {
  buscar_conversas: "conversas antigas", ver_treinos: "seus treinos", ver_refeicoes: "suas refeições",
  ver_peso: "seu histórico de peso", ver_metas: "suas metas", ver_tarefas: "suas tarefas",
  ver_lembretes: "seus lembretes", ver_radar: "o radar",
};

/**
 * A fala da camada 1: sai DEPOIS da busca e ANTES do modelo pensar, entao diz
 * coisa verdadeira em vez de enrolar. Zero modelo. Pura.
 * Em modo sensivel (desabafo, crise) nao fala de nota nenhuma: "achei 3 notas"
 * em cima de uma dor soa como relatorio.
 */
export function fraseDoPlano(plano, pacote, memorias = 0) {
  if (plano.modo === "crise") return "Tô aqui com você.";
  if (ehSensivel(plano.modo)) return "Tô te ouvindo.";

  const partes = [];
  for (const f of pacote.fontes) {
    if (f.omitida || !f.itens) continue;
    if (f.ferramenta === "buscar_notas") {
      const n = pacote.achado.fortes;
      if (n) partes.push(n === 1 ? "1 nota sua sobre isso" : `${n} notas suas sobre isso`);
    } else if (f.ferramenta === "notas_por_periodo") {
      const n = f.itens;
      partes.push(`${n === 1 ? "1 nota" : `${n} notas`} de ${plano.janela ? plano.janela.rotulo : "esse período"}`);
    } else if (FRASE_FONTE[f.ferramenta]) {
      partes.push(FRASE_FONTE[f.ferramenta]);
    }
  }
  if (memorias > 0 && !partes.length) partes.push("o que eu sei de você");

  if (!partes.length) {
    /* "Nao achei nada" so quando ele PROCUROU nas notas e voltou vazio. Sem busca
       (papo, cumprimento) a frase negativa soava estranha: "ola" -> "nao encontrei nada". */
    const procurou = (plano.ferramentas || []).some((f) => ["buscar_notas", "notas_por_periodo"].includes(f.nome || f))
      && (pacote.fontes || []).length > 0;
    return procurou && ["resgate", "analise"].includes(plano.modo)
      ? "Procurei nas suas notas e não achei. Vou pensar com o que eu sei de você."
      : "Já te respondo.";
  }
  const lista = partes.length === 1 ? partes[0] : partes.slice(0, -1).join(", ") + " e " + partes[partes.length - 1];
  return `Peguei ${lista}. Deixa eu ler.`;
}

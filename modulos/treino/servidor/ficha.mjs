/**
 * A ficha do dia, montada pelo Gemini.
 *
 * O modelo le tres coisas: os equipamentos que voce tem, o que voce treinou
 * nas ultimas duas semanas e o seu perfil. Devolve os exercicios e o MOTIVO
 * de ter montado assim, que e o que permite voce discordar dele.
 *
 * DUAS COISAS QUE O MODELO NAO DECIDE:
 *
 * 1. Carga em quilos. Ele nao sabe quanto voce levanta. Prescrever peso ou
 *    machuca ou e ignorado. Ele prescreve series, repeticoes e descanso.
 * 2. O MET. Ele ja foi validado no cadastro do equipamento, contra faixa por
 *    tipo. Deixar o gerador de ficha opinar de novo faria o mesmo aparelho
 *    valer 5 hoje e 8 amanha, e a caloria pararia de ser comparavel.
 *
 * A parte pura (resumo dos dias e normalizacao) e testavel sem rede.
 */
import { gerarJSONDetalhado } from "../../../src/geminiClient.js";
import { metValido, minutosDoItem } from "./calorias.mjs";
import { JANELA_DIAS } from "./banco.mjs";

const LIMITES = {
  series: [1, 8],
  reps: [1, 100],
  descanso_s: [0, 300],
  itens: [1, 12],
};

function dentro(valor, [min, max], padrao) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

/**
 * O que o modelo le sobre as ultimas duas semanas. Puro.
 *
 * Resume por DIA e por GRUPO MUSCULAR, nao por exercicio: o que importa pra
 * montar o proximo treino e "peito foi ontem" e "perna nao treina ha 9 dias",
 * nao a lista de 40 exercicios.
 */
export function resumoDosDias(sessoes, hoje = new Date()) {
  const lista = Array.isArray(sessoes) ? sessoes : [];
  if (!lista.length) {
    return `Sem treino registrado nos ultimos ${JANELA_DIAS} dias. Comece leve.`;
  }

  const diaDe = (d) => Math.floor((hoje.getTime() - new Date(d + "T12:00:00Z").getTime()) / 86400000);
  const ultimoPorGrupo = {};
  const linhas = [];

  for (const s of lista) {
    const atras = diaDe(s.data);
    const feitos = new Set((s.feitos || []).map(String));
    const itens = (s.ficha || []).filter((i) => feitos.has(String(i.id)));
    const grupos = [...new Set(itens.flatMap((i) => i.grupos || []))];

    for (const g of grupos) {
      if (ultimoPorGrupo[g] == null || atras < ultimoPorGrupo[g]) ultimoPorGrupo[g] = atras;
    }

    const quando = atras === 0 ? "hoje" : atras === 1 ? "ontem" : `ha ${atras} dias`;
    linhas.push(
      `- ${quando}: ${itens.length || (s.origem === "manual" ? 1 : 0)} exercicio(s)` +
      (s.duracao_min ? `, ${s.duracao_min} min` : "") +
      (s.esforco ? `, achou ${s.esforco}` : "") +
      (grupos.length ? `, pegou ${grupos.join(", ")}` : "") +
      (s.concluida ? "" : " (nao concluiu)")
    );
  }

  const descanso = Object.entries(ultimoPorGrupo)
    .sort((a, b) => b[1] - a[1])
    .map(([g, d]) => `${g}: ${d === 0 ? "hoje" : d === 1 ? "ontem" : `ha ${d} dias`}`);

  return `Treinos dos ultimos ${JANELA_DIAS} dias (${lista.length}):\n${linhas.join("\n")}\n\n` +
    (descanso.length ? `Ultima vez em cada grupo:\n${descanso.join("\n")}` : "");
}

/** Os equipamentos como o modelo enxerga. Puro. */
export function blocoEquipamentos(equipamentos) {
  const lista = Array.isArray(equipamentos) ? equipamentos : [];
  if (!lista.length) return "ELE NAO TEM EQUIPAMENTO NENHUM CADASTRADO.";
  return "Equipamentos disponiveis (use SO estes ids):\n" + lista.map((e) =>
    `- id ${e.id} | ${e.nome} (${e.tipo}) | grupos: ${(e.grupos || []).join(", ") || "nao informado"}` +
    (e.como_usar ? `\n  como usar: ${e.como_usar}` : "")
  ).join("\n");
}

/** O perfil como o modelo enxerga. Puro. Sem peso: ele nao prescreve carga. */
export function blocoPerfil(perfil) {
  const p = perfil || {};
  const partes = [];
  if (p.nivel) partes.push(`nivel ${p.nivel}`);
  if (p.restricoes) partes.push(`restricoes: ${p.restricoes}`);
  return partes.length ? `Sobre ele: ${partes.join("; ")}.` : "";
}

/**
 * Poe a ficha do modelo em forma. Puro.
 *
 * Item que aponta pra equipamento inexistente e DESCARTADO: o modelo inventa
 * id de vez em quando, e um exercicio com aparelho que voce nao tem e pior que
 * um exercicio a menos.
 *
 * O MET NAO vem do modelo: vem do cadastro do equipamento.
 */
export function normalizarFicha(cru, equipamentos) {
  const porId = new Map((equipamentos || []).map((e) => [String(e.id), e]));
  const itensCrus = Array.isArray(cru && cru.ficha) ? cru.ficha : Array.isArray(cru) ? cru : [];

  const itens = [];
  const descartados = [];

  for (const bruto of itensCrus) {
    const eq = porId.get(String(bruto && bruto.equipamento_id));
    if (!eq) {
      descartados.push(String((bruto && bruto.nome) || "sem nome"));
      continue;
    }
    itens.push({
      // id curto e estavel: e o que o check do treino marca
      id: "e" + (itens.length + 1),
      nome: String(bruto.nome || eq.nome).trim().slice(0, 80),
      equipamento_id: eq.id,
      equipamento_nome: eq.nome,
      grupos: Array.isArray(eq.grupos) ? eq.grupos : [],
      series: dentro(bruto.series, LIMITES.series, 3),
      reps: String(bruto.reps || "10").slice(0, 20),
      descanso_s: dentro(bruto.descanso_s, LIMITES.descanso_s, 60),
      observacao: String(bruto.observacao || "").trim().slice(0, 160),
      /* Exercicio por TEMPO (caminhada, esteira, prancha) guarda os minutos
         num campo proprio. Sem isto, a estimativa de duracao tratava tudo como
         serie e repeticao, e uma caminhada de meia hora virava 5 minutos.
         Vem do campo do modelo ou e lido do texto de repeticoes. */
      duracao_min: minutosDoItem({ duracao_min: bruto.duracao_min, reps: bruto.reps }),
      // do cadastro, nunca do modelo
      met: metValido(eq.met),
    });
    if (itens.length >= LIMITES.itens[1]) break;
  }

  return {
    ficha: itens,
    motivo: String((cru && cru.motivo) || "").trim().slice(0, 600),
    descartados,
  };
}

const SISTEMA = `Voce monta ficha de treino em casa. Responde SOMENTE JSON.

REGRAS DURAS:
- Use SOMENTE os equipamentos listados, pelo id exato. Nao invente id, nao invente aparelho.
- NAO prescreva carga em kg. Voce nao sabe quanto ele levanta. Prescreva series, repeticoes e descanso.
- NAO invente campo met: ele vem do cadastro.
- Exercicio medido em TEMPO (caminhada, esteira, bike, prancha, corda) leva
  duracao_min com os minutos de CADA serie. Exercicio de repeticao nao leva.
- Respeite as restricoes dele. Se uma restricao impede um exercicio, nao coloque.

COMO ESCOLHER:
- Olhe quantos dias faz que cada grupo muscular foi treinado. Grupo treinado ontem precisa descansar.
- Se ele nao concluiu os ultimos treinos, o volume estava alto demais: diminua.
- Se ele vem achando tudo leve, suba o volume.
- Entre 4 e 7 exercicios. Treino que nao cabe na vida nao e feito.

O campo motivo e pra ELE ler: explique em duas ou tres frases por que essa ficha
hoje, citando o que voce viu no historico. Sem enrolacao e sem elogio.

{"motivo":"...","ficha":[{"equipamento_id":"...","nome":"...","series":3,"reps":"10-12","descanso_s":60,"duracao_min":null,"observacao":""}]}`;

/**
 * Gera a ficha. Lanca quando o Gemini falha: aqui NAO da pra cair em plano B
 * silencioso, porque ficha inventada por regra fixa seria pior que erro
 * honesto, e o modulo inteiro existe pra ter ficha pensada.
 */
export async function gerarFicha({ perfil, equipamentos, sessoes, pedido = "", hoje = new Date() }) {
  const prompt = [
    `Hoje e ${hoje.toISOString().slice(0, 10)}.`,
    blocoPerfil(perfil),
    blocoEquipamentos(equipamentos),
    resumoDosDias(sessoes, hoje),
    pedido ? `O que ele pediu pra hoje: "${String(pedido).slice(0, 300)}"` : "",
  ].filter(Boolean).join("\n\n");

  /* 8192 e nao 3072: com GEMINI_THINKING=HIGH o raciocinio gasta do MESMO
     teto da resposta. Com 3072 o JSON da ficha era cortado no meio e o parse
     quebrava, e o log enchia de "devolveu JSON invalido, tentando outra
     combinacao" ate alguma tentativa caber. A ficha em si ocupa menos de mil
     tokens; a folga e toda pro pensamento. */
  const { dados, meta } = await gerarJSONDetalhado(SISTEMA, prompt, {
    temperatura: 0.7,
    maxTokens: 8192,
  });

  const limpa = normalizarFicha(dados, equipamentos);
  return { ...limpa, meta, prompt };
}

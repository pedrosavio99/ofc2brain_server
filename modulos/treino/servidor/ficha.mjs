/**
 * A ficha do dia, montada pelo Gemini.
 *
 * O modelo le: onde voce vai treinar, os equipamentos (quando e em casa), o
 * que voce fez nos ultimos 14 dias e o seu perfil. Devolve os exercicios e o
 * MOTIVO, que e o que permite voce discordar dele.
 *
 * DUAS COISAS QUE O MODELO NAO DECIDE:
 * 1. Carga em quilos. Ele nao sabe quanto voce levanta.
 * 2. O numero do MET. Em casa vem do cadastro do aparelho. Fora de casa o
 *    modelo so escolhe o TIPO do exercicio e o MET e o tipico da faixa na
 *    tabela TIPOS. Assim o mesmo exercicio vale sempre o mesmo e a caloria
 *    continua comparavel entre dias.
 *
 * A parte pura (resumo, blocos do prompt, normalizacao) e testavel sem rede.
 */
import { gerarJSONDetalhado } from "../../../src/geminiClient.js";
import { metValido, minutosDoItem } from "./calorias.mjs";
import { JANELA_DIAS, hojeLocal } from "./banco.mjs";
import { TIPOS, GRUPOS, tipoValido } from "./equipamentos.mjs";

const LIMITES = {
  series: [1, 8],
  reps: [1, 100],
  descanso_s: [0, 300],
  itens: [1, 12],
};

/* Onde voce vai treinar. "casa" e o padrao e e o comportamento de antes:
   so os aparelhos cadastrados valem. */
export const LOCAIS = {
  casa: { rotulo: "Em casa", regra:
    "Ele esta EM CASA. Use SOMENTE os equipamentos listados, pelo id exato. Nao invente aparelho." },
  academia: { rotulo: "Academia", regra:
    "Ele esta numa ACADEMIA comum: maquinas, polias, barras, halteres, bancos, esteira e bike. " +
    "equipamento_id vai null e o campo equipamento diz qual aparelho da academia usar." },
  sem_equipamento: { rotulo: "Sem equipamento", regra:
    "Ele NAO tem equipamento nenhum. So peso do corpo e o chao. equipamento_id null, " +
    "equipamento \"peso do corpo\". Nada de barra fixa, cadeira ou banco, a menos que ele cite." },
  ar_livre: { rotulo: "Ao ar livre", regra:
    "Ele esta AO AR LIVRE (praia, parque, rua). Peso do corpo, corrida, tiros, areia, degrau. " +
    "equipamento_id null. Use o que o lugar oferece so se ele citar ou se for obvio do lugar." },
};

export function localValido(l) {
  const k = String(l || "").toLowerCase().trim();
  return LOCAIS[k] ? k : "casa";
}

/* Grupos que precisam rodar. "cardio" e "corpo inteiro" nao entram na
   cobranca: sao complemento, nao musculo esquecido. */
const PRINCIPAIS = GRUPOS.filter((g) => g !== "cardio" && g !== "corpo inteiro");

function dentro(valor, [min, max], padrao) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
}

function quandoFoi(d) {
  return d === 0 ? "hoje" : d === 1 ? "ontem" : `ha ${d} dias`;
}

/* Grupos do item que servem pra cobranca de rodizio.
   Ficha antiga guardava os grupos do APARELHO: halter com 6 grupos marcava
   tudo como treinado em qualquer exercicio, e o modelo achava que voce
   malhava o corpo inteiro todo dia. Item novo traz grupos_fonte "exercicio".
   Item antigo so conta se o aparelho for especifico (ate 2 grupos); o resto
   o modelo deduz pelo NOME do exercicio, que agora vai no historico. */
function gruposConfiaveis(item) {
  const g = Array.isArray(item.grupos) ? item.grupos : [];
  if (item.grupos_fonte === "exercicio") return g;
  return g.length <= 2 ? g : [];
}

/**
 * Series feitas por grupo nos ultimos 14 dias, pro mapa do corpo. Puro.
 *
 * So treino FECHADO, igual aos numeros do painel. O grupo principal do
 * exercicio (o primeiro) leva a serie inteira; os secundarios levam metade:
 * supino pinta mais o peito que o triceps. Avulsa nao tem grupo, e cardio e
 * corpo inteiro nao tem regiao no corpo, entao ficam de fora.
 * Usa gruposConfiaveis: ficha antiga com os grupos do aparelho pintaria o
 * corpo inteiro de vermelho.
 */
export function seriesPorGrupo(sessoes) {
  const conta = {};
  PRINCIPAIS.forEach((g) => { conta[g] = 0; });
  for (const s of Array.isArray(sessoes) ? sessoes : []) {
    if (!s || !s.concluida || s.origem === "manual") continue;
    const feitos = new Set((s.feitos || []).map(String));
    for (const i of s.ficha || []) {
      if (!feitos.has(String(i.id))) continue;
      const series = Math.max(1, Math.min(Number(i.series) || 1, 10));
      gruposConfiaveis(i).forEach((g, n) => {
        if (conta[g] === undefined) return;
        conta[g] += n === 0 ? series : series / 2;
      });
    }
  }
  Object.keys(conta).forEach((g) => { conta[g] = Math.round(conta[g] * 2) / 2; });
  return conta;
}

/**
 * O que o modelo le sobre os ultimos 14 dias. Puro.
 *
 * Mudancas em relacao a versao anterior, todas com bug real por tras:
 * - A data sai do fuso local. Antes usava a hora UTC do servidor: as 05:35
 *   o treino de ontem aparecia como "hoje" e a ficha pendente como "ha -1 dias".
 * - Ficha substituida no "gerar outra" e a ficha pendente de hoje nao entram.
 *   Antes elas apareciam como "nao concluiu" e o modelo cortava volume achando
 *   que voce abandona treino.
 * - O nome de cada exercicio vai junto, pra ele conseguir nao repetir.
 */
export function resumoDosDias(sessoes, hoje = new Date()) {
  const hojeISO = hojeLocal(hoje);
  const base = new Date(hojeISO + "T12:00:00Z").getTime();
  const diaDe = (d) => Math.round((base - new Date(d + "T12:00:00Z").getTime()) / 86400000);

  const todas = Array.isArray(sessoes) ? sessoes : [];
  const substituidas = new Set(todas.map((s) => s.regerada_de).filter(Boolean));
  const lista = todas.filter((s) => {
    if (substituidas.has(s.id)) return false;
    const temFeito = (s.feitos || []).length > 0;
    if (s.data === hojeISO && !s.concluida && !temFeito) return false;
    return true;
  });

  if (!lista.length) {
    return `Sem treino registrado nos ultimos ${JANELA_DIAS} dias. Comece moderado, corpo inteiro.`;
  }

  const ultimoPorGrupo = {};
  const recentes = new Set();
  const linhas = [];

  for (const s of lista) {
    const atras = diaDe(s.data);
    const feitos = new Set((s.feitos || []).map(String));
    const itens = (s.ficha || []).filter((i) => feitos.has(String(i.id)));

    for (const i of itens) {
      for (const g of gruposConfiaveis(i)) {
        if (ultimoPorGrupo[g] == null || atras < ultimoPorGrupo[g]) ultimoPorGrupo[g] = atras;
      }
      if (atras <= 3 && s.origem !== "manual") recentes.add(String(i.nome || "").trim());
    }

    const quando = `${quandoFoi(atras)} (${s.data})` + (s.origem === "extra" ? " [ficha extra]" : "");
    if (s.origem === "manual") {
      const nome = ((s.ficha || [])[0] || {}).nome || "atividade";
      linhas.push(`- ${quando}: atividade avulsa, ${nome}` + (s.duracao_min ? `, ${s.duracao_min} min` : ""));
      continue;
    }
    if (!itens.length) {
      linhas.push(`- ${quando}: gerou ficha e nao fez nenhum exercicio`);
      continue;
    }
    linhas.push(
      `- ${quando}: ` + itens.map((i) => i.nome).join("; ") +
      (s.duracao_min ? ` | ${s.duracao_min} min` : "") +
      (s.esforco ? ` | achou ${s.esforco}` : "") +
      (s.concluida ? "" : " | nao fechou o treino")
    );
  }

  // Todo grupo principal aparece, inclusive os nunca treinados: o buraco e o
  // dado que faltava pro modelo parar de repetir.
  const cobertura = PRINCIPAIS
    .map((g) => [g, ultimoPorGrupo[g]])
    .sort((a, b) => (b[1] ?? 99) - (a[1] ?? 99))
    .map(([g, d]) => `- ${g}: ${d == null ? `NENHUMA vez nos ultimos ${JANELA_DIAS} dias` : quandoFoi(d)}`);

  return `Treinos dos ultimos ${JANELA_DIAS} dias, mais recente primeiro:\n${linhas.join("\n")}\n\n` +
    `Ultima vez de cada grupo (os do topo sao prioridade):\n${cobertura.join("\n")}` +
    (recentes.size ? `\n\nExercicios dos ultimos 3 dias (evite repetir): ${[...recentes].join("; ")}` : "");
}

/** Os equipamentos como o modelo enxerga. Puro. */
export function blocoEquipamentos(equipamentos) {
  const lista = Array.isArray(equipamentos) ? equipamentos : [];
  if (!lista.length) return "ELE NAO TEM EQUIPAMENTO NENHUM CADASTRADO.";
  return "Equipamentos disponiveis (use SO estes ids):\n" + lista.map((e) =>
    `- id ${e.id} | ${e.nome} (${e.tipo})` +
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
 * Em casa, item com aparelho inexistente e DESCARTADO, como antes.
 * Fora de casa, item sem aparelho cadastrado e aceito: o MET sai do tipo que
 * o modelo escolheu, puxado pra faixa da tabela TIPOS.
 */
export function normalizarFicha(cru, equipamentos, local = "casa") {
  const onde = localValido(local);
  const porId = new Map((equipamentos || []).map((e) => [String(e.id), e]));
  const itensCrus = Array.isArray(cru && cru.ficha) ? cru.ficha : Array.isArray(cru) ? cru : [];

  const itens = [];
  const descartados = [];

  for (const bruto of itensCrus) {
    if (!bruto || typeof bruto !== "object") continue;
    const eq = porId.get(String(bruto.equipamento_id));
    if (!eq && onde === "casa") {
      descartados.push(String(bruto.nome || "sem nome"));
      continue;
    }

    const tipo = eq ? eq.tipo : tipoValido(bruto.tipo);
    const doModelo = Array.isArray(bruto.grupos)
      ? [...new Set(bruto.grupos.map((g) => String(g).toLowerCase().trim()).filter((g) => GRUPOS.includes(g)))].slice(0, 3)
      : [];
    const medida = bruto.medida === "tempo" ? "tempo" : "reps";

    itens.push({
      // id curto e estavel: e o que o check do treino marca
      id: "e" + (itens.length + 1),
      nome: String(bruto.nome || (eq && eq.nome) || "exercicio").trim().slice(0, 80),
      equipamento_id: eq ? eq.id : null,
      equipamento_nome: eq ? eq.nome : String(bruto.equipamento || "peso do corpo").trim().slice(0, 60),
      /* Grupos do EXERCICIO. Sem eles, cai nos do aparelho como antes, mas
         marcado, pra o historico saber que e aproximado. */
      grupos: doModelo.length ? doModelo : (eq && Array.isArray(eq.grupos) ? eq.grupos : []),
      grupos_fonte: doModelo.length ? "exercicio" : "aparelho",
      series: dentro(bruto.series, LIMITES.series, 3),
      medida,
      reps: String(bruto.reps || (medida === "tempo" ? "" : "10")).slice(0, 20),
      descanso_s: dentro(bruto.descanso_s, LIMITES.descanso_s, 60),
      observacao: String(bruto.observacao || "").trim().slice(0, 160),
      duracao_min: minutosDoItem({ duracao_min: bruto.duracao_min, reps: bruto.reps, medida }),
      // em casa do cadastro; fora, o tipico do tipo. Nunca do modelo.
      met: eq ? metValido(eq.met) : TIPOS[tipo].met[1],
      tipo,
    });
    const ultimo = itens[itens.length - 1];
    // exercicio por tempo sem minuto legivel vira repeticao: melhor que 0
    if (ultimo.medida === "tempo" && ultimo.duracao_min == null) ultimo.medida = "reps";
    if (ultimo.medida === "tempo" && !ultimo.reps) ultimo.reps = `${ultimo.duracao_min} min`;
    if (itens.length >= LIMITES.itens[1]) break;
  }

  return {
    ficha: itens,
    motivo: String((cru && cru.motivo) || "").trim().slice(0, 600),
    descartados,
    local: onde,
  };
}

/** Monta o texto de sistema. Puro. Muda conforme o local. */
/* Regras da ficha EXTRA. Ele ja treinou hoje e quer mais: o pedido dele e o
   centro, e o que ele ja fez hoje e o limite. A parte de testosterona existe
   porque o pedido e comum e a resposta honesta e diferente da que ele espera:
   treino mexe pouco e por pouco tempo no hormonio. */
const REGRAS_EXTRA = `

FICHA EXTRA (vale mais que as regras de rodizio e volume acima):
- Ele JA treinou hoje e quer mais. O pedido dele e o centro da ficha.
- Veja "O que ele ja fez hoje". Nao repita esses exercicios.
- Se ele pedir um grupo que ja trabalhou hoje, use outros exercicios e angulos,
  2 a 3 series cada, pra nao sobrecarregar o que ja esta cansado.
- Pedido de gasto calorico: circuito, cardio intervalado e compostos com pouco
  descanso. Se ele disser o tempo, a ficha inteira cabe nele, contando descanso.
- Pedido de testosterona ou hormonio: monte compostos pesados (agachamento,
  levantamento terra, supino, remada, desenvolvimento), poucas repeticoes e
  descanso maior. No motivo diga a verdade: o efeito do treino no hormonio e
  pequeno e passa em minutos; o ganho real vem de forca e musculo ao longo das
  semanas, junto com sono e alimentacao. NAO prometa efeito hormonal.
- Entre 3 e 6 exercicios.
- O motivo explica como a ficha atende o pedido dele, em duas ou tres frases.`;

export function sistemaDaFicha(local, modo = "dia") {
  const onde = localValido(local);
  return `Voce e um treinador montando a ficha de HOJE. Responde SOMENTE JSON.

ONDE ELE ESTA: ${LOCAIS[onde].regra}

REGRAS DURAS:
- NAO prescreva carga em kg. Prescreva series, repeticoes e descanso.
- NAO invente campo met.
- Respeite as restricoes dele. Se uma restricao impede um exercicio, nao coloque.
- tipo de cada exercicio, um destes: ${Object.keys(TIPOS).join(", ")}.
- grupos de cada exercicio: 1 a 3, o principal primeiro, SO destes: ${GRUPOS.join(", ")}.
  Grupos do EXERCICIO, nao do aparelho: supino e peito e triceps, nao o corpo todo.

TEMPO (a conta de duracao depende disso):
- Exercicio medido em tempo (corrida, caminhada, bike, esteira, prancha, corda)
  leva medida "tempo" e duracao_min com os minutos de CADA serie, em numero.
  Exemplo: correr 3 blocos de 10 min = series 3, medida "tempo", duracao_min 10, reps "10 min".
- Exercicio de repeticao leva medida "reps" e duracao_min null.
- Se ele disser quanto tempo tem, a ficha inteira cabe nesse tempo, contando descanso.

RODIZIO (o mais importante, ele reclamou de treino repetido):
- Olhe "Ultima vez de cada grupo". Os grupos do topo, sem treino ha mais tempo
  ou NENHUMA vez, sao a prioridade de hoje.
- Grupo que foi foco ontem nao e foco hoje.
- Em uma janela de 4 dias todo grupo principal precisa ter sido trabalhado:
  peito, costas, ombro, perna, gluteo, abdomen, biceps, triceps.
- No maximo 1 exercicio igual aos dos ultimos 3 dias. Varie angulo, pegada ou aparelho.
- Treinando quase todo dia, alterne focos (empurrar, puxar, pernas e core).
  Treinando pouco, corpo inteiro.

VOLUME:
- Entre 4 e 7 exercicios.
- So corte volume se ele fez treino e nao fechou, ou achou pesado. Ficha que ele
  nao chegou a comecar nao e sinal de volume alto.
- Se ele vem achando tudo leve, suba.

O campo motivo e pra ELE ler: duas ou tres frases dizendo quais grupos entram hoje
e por que, citando o historico. Sem elogio.

{"motivo":"...","ficha":[{"equipamento_id":"id ou null","equipamento":"nome do aparelho ou peso do corpo","tipo":"peso_livre","nome":"...","grupos":["perna","gluteo"],"series":3,"medida":"reps","reps":"10-12","duracao_min":null,"descanso_s":60,"observacao":""}]}` + (modo === "extra" ? REGRAS_EXTRA : "");
}

/** O prompt do dia. Puro. */
export function promptDaFicha({ perfil, equipamentos, sessoes, pedido = "", local = "casa",
  localTexto = "", rejeitada = null, hoje = new Date(), modo = "dia", feitosHoje = [] }) {
  const extra = modo === "extra";
  const jaFez = extra
    ? "O que ele ja fez hoje: " + (feitosHoje.length
        ? feitosHoje.map((i) => i.nome + (i.grupos && i.grupos.length ? " (" + i.grupos.join(", ") + ")" : "")).join("; ")
        : "nada registrado ainda")
    : "";
  const onde = localValido(local);
  const recusada = Array.isArray(rejeitada) && rejeitada.length
    ? "Ele pediu OUTRA ficha. Esta foi recusada: " + rejeitada.map((i) => i.nome).join("; ") +
      ". Monte uma diferente: troque a maioria dos exercicios."
    : "";
  return [
    `Hoje e ${hojeLocal(hoje)}.`,
    blocoPerfil(perfil),
    onde === "casa" ? blocoEquipamentos(equipamentos) : `Local de hoje: ${LOCAIS[onde].rotulo}.`,
    localTexto ? `O que ele disse sobre onde esta e o que tem: "${String(localTexto).slice(0, 300)}"` : "",
    resumoDosDias(sessoes, hoje),
    jaFez,
    pedido
      ? (extra ? `O que ele quer AGORA, e o centro da ficha: "${String(pedido).slice(0, 400)}"`
               : `O que ele pediu pra hoje: "${String(pedido).slice(0, 300)}"`)
      : "",
    recusada,
  ].filter(Boolean).join("\n\n");
}

/**
 * Gera a ficha. Lanca quando o Gemini falha: ficha inventada por regra fixa
 * seria pior que erro honesto.
 */
export async function gerarFicha(opcoes) {
  const local = localValido(opcoes.local);
  const prompt = promptDaFicha({ ...opcoes, local });

  /* 8192 porque com GEMINI_THINKING=HIGH o raciocinio gasta do mesmo teto da
     resposta; com menos o JSON era cortado. 0.8 e nao 0.7: um pouco mais de
     variacao ajuda contra ficha repetida, e as regras seguram o resto. */
  const { dados, meta } = await gerarJSONDetalhado(sistemaDaFicha(local, opcoes.modo), prompt, {
    temperatura: 0.8,
    maxTokens: 8192,
  });

  const limpa = normalizarFicha(dados, opcoes.equipamentos, local);
  return { ...limpa, meta, prompt };
}

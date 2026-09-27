/**
 * IA FORTE: mede cada item de UMA refeicao.
 *
 * Uma chamada por refeicao, em paralelo (a rota faz o Promise.allSettled):
 * prompt menor mede melhor, e uma refeicao que falha nao derruba as outras.
 *
 * O QUE O MODELO DECIDE: quais itens tem, quantos gramas (a sua quantidade
 * quando voce disse, uma porcao tipica quando nao) e os valores POR 100 g.
 * O QUE ELE NAO DECIDE: o total. Esse sai de calcularItem() em nutricao.mjs,
 * pra porcao corrigida na tela refazer a conta sem nova chamada.
 *
 * Diferente da separacao, aqui NAO tem fallback inventado: caloria chutada por
 * regra fixa seria pior que erro honesto. Falhou, a refeicao volta com erro e
 * a tela deixa tentar de novo so ela.
 */
import { gerarJSON } from "./ia/gemini.mjs";
import { calcularItem, somar, tipoValido, tamanhoValido, TIPOS } from "./nutricao.mjs";

const SISTEMA = [
  "Voce e nutricionista e mede o que uma pessoa comeu numa refeicao, com base em",
  "tabelas brasileiras de composicao de alimentos (TACO/TBCA) e rotulos comuns no Brasil.",
  "Responda somente JSON, no formato:",
  '{"tamanho":"media","itens":[{"nome":"Arroz branco cozido","gramas":150,"medida":"4 colheres de sopa",',
  '"porcao_fonte":"assumida","kcal_100g":128,"proteina_100g":2.5,"carbo_100g":28.1,',
  '"gordura_100g":0.2,"confianca":"alta","observacao":""}]}',
  "",
  "Regras:",
  "- Um item por alimento ou bebida citado. Nao invente item que a pessoa nao citou.",
  "- gramas e a quantidade CONSUMIDA. Liquidos em ml valem como gramas.",
  "- Se a pessoa disse a quantidade (em g, ml, unidade, fatia, colher, concha, copo, prato),",
  "  converta para gramas e use porcao_fonte \"texto\". Se nao disse, use uma porcao tipica",
  "  de adulto brasileiro, porcao_fonte \"assumida\", e diga qual foi em medida.",
  "- Os valores _100g sao do alimento COMO FOI COMIDO (arroz cozido, nao cru; frango grelhado,",
  "  nao cru). Considere o preparo citado (frito, com oleo, com acucar).",
  "- Nao calcule o total do item: so gramas e valores por 100 g.",
  "- confianca: alta (alimento e quantidade claros), media (algo foi suposto), baixa",
  "  (prato vago como \"uma marmita\" ou \"um lanche\"). Em baixa, explique em observacao",
  "  o que foi suposto, em uma frase curta.",
  "- tamanho e o tamanho do prato que a pessoa descreveu: pequena, media ou grande.",
  "  \"marmita grande\", \"pratao\", \"repeti\" = grande; \"pouquinho\", \"marmitinha\" = pequena;",
  "  sem pista = media. As porcoes assumidas devem ja refletir esse tamanho.",
  "- Prato composto sem detalhe (\"uma marmita de frango\") pode virar os componentes tipicos",
  "  (arroz, feijao, frango) em itens separados, cada um com confianca media ou baixa.",
].join("\n");

/** Poe a resposta do modelo em forma e calcula os totais. Puro. */
export function normalizarMedicao(dados) {
  const lista = dados && Array.isArray(dados.itens) ? dados.itens : [];
  return lista.slice(0, 30).map((it) => calcularItem({
    nome: it && it.nome,
    gramas: it && it.gramas,
    medida: it && it.medida,
    porcao_fonte: it && it.porcao_fonte,
    confianca: it && it.confianca,
    observacao: it && it.observacao,
    por100: {
      kcal: it && it.kcal_100g,
      proteina: it && it.proteina_100g,
      carbo: it && it.carbo_100g,
      gordura: it && it.gordura_100g,
    },
  })).filter((it) => it.nome && it.gramas > 0);
}

export async function medirRefeicao({ tipo, texto }, hora) {
  const t = tipoValido(tipo, hora);
  const limpo = String(texto || "").trim().slice(0, 600);
  const { dados, meta } = await gerarJSON(SISTEMA,
    `Refeicao: ${TIPOS[t].rotulo}\nO que a pessoa escreveu: """${limpo}"""`, {
      temperatura: 0.2,
      maxTokens: 8192,
      // 2 tentativas de 18 s cabem, com o Groq antes, nos 60 s da Vercel
      prazoMs: 18000,
    });
  const itens = normalizarMedicao(dados);
  if (!itens.length) throw new Error("o modelo nao devolveu nenhum item valido");
  return { tipo: t, rotulo: TIPOS[t].rotulo, tamanho: tamanhoValido(dados && dados.tamanho),
    texto: limpo, itens, totais: somar(itens), meta };
}

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
 * Degraus, na ordem: Gemini (TODAS as chaves e modelos do .env) e, se nenhum
 * responder, Groq. Nao existe terceiro degrau: caloria chutada por regra fixa
 * seria pior que erro honesto. Falhou nos dois, a refeicao volta com o MOTIVO
 * de cada tentativa e a tela deixa tentar de novo so ela.
 *
 * Por que percorrer chave e modelo: usar so o primeiro de cada faz uma chave
 * sem cota derrubar a medicao inteira em milissegundos.
 */
import {
  gemini, groq, porQue, chavesGemini, modelosGemini, chavesGroq, modelosGroq,
} from "../../../src/ia-rapida.js";
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

/* Orcamento: as refeicoes sao medidas em PARALELO, entao o teto aqui e por
   refeicao e ja conta com os 60 s da funcao na Vercel. */
const PRAZO_GEMINI = Number(process.env.REFEICAO_PRAZO_GEMINI_MS || 15000);
const TETO_GEMINI = Number(process.env.REFEICAO_TETO_GEMINI_MS || 24000);
const PRAZO_GROQ = Number(process.env.REFEICAO_PRAZO_GROQ_MS || 12000);
const TETO_GROQ = Number(process.env.REFEICAO_TETO_GROQ_MS || 15000);

/** Percorre modelo x chave ate alguem responder ou o teto acabar. */
async function percorrer(chaves, modelos, teto, prazo, chamar, motivos) {
  const fim = Date.now() + teto;
  if (!chaves.length) { motivos.push("sem chave no .env"); return null; }
  for (const modelo of modelos) {
    for (let i = 0; i < chaves.length; i++) {
      if (Date.now() >= fim) { motivos.push(`${modelo}: tempo esgotado`); return null; }
      const rotulo = modelo + (chaves.length > 1 ? ` (chave ${i + 1})` : "");
      try {
        const dados = await chamar(chaves[i], modelo,
          Math.min(prazo, Math.max(2000, fim - Date.now())));
        return { dados, modelo: rotulo };
      } catch (e) {
        motivos.push(porQue(e, rotulo));
      }
    }
  }
  return null;
}

export async function medirRefeicao({ tipo, texto }, hora) {
  const t = tipoValido(tipo, hora);
  const limpo = String(texto || "").trim().slice(0, 600);
  const prompt = `Refeicao: ${TIPOS[t].rotulo}\nO que a pessoa escreveu: """${limpo}"""`;
  const motivos = [];

  let fonte = "gemini";
  let r = await percorrer(chavesGemini(), modelosGemini(), TETO_GEMINI, PRAZO_GEMINI,
    (chave, modelo, prazoMs) => gemini(SISTEMA, prompt, { chave, modelo, prazoMs, temperatura: 0.2 }),
    motivos);

  if (!r) {
    fonte = "groq";
    r = await percorrer(chavesGroq(), modelosGroq(), TETO_GROQ, PRAZO_GROQ,
      (chave, modelo, prazoMs) => groq(SISTEMA, prompt, { chave, modelo, prazoMs, temperatura: 0.2 }),
      motivos);
  }

  if (!r) {
    const erro = new Error("nenhum modelo mediu esta refeicao");
    erro.motivos = motivos;
    throw erro;
  }

  const itens = normalizarMedicao(r.dados);
  if (!itens.length) {
    const erro = new Error(`${r.modelo} respondeu sem item valido`);
    erro.motivos = motivos.concat(`${r.modelo}: sem item valido`);
    throw erro;
  }

  return {
    tipo: t, rotulo: TIPOS[t].rotulo, tamanho: tamanhoValido(r.dados && r.dados.tamanho),
    texto: limpo, itens, totais: somar(itens),
    meta: { fonte, modelo: r.modelo },
    // o que falhou antes de dar certo; a tela avisa quando veio do reserva
    avisos: motivos,
  };
}

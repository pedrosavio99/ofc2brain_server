/**
 * Separa o que voce escreveu em refeicoes.
 *
 * Dois caminhos, nesta ordem:
 *   1. REGRA, sem IA: se o texto nomeia duas ou mais refeicoes ("lanchei",
 *      "almocei", "jantei", "de manha", "a noite"...), separa por elas. E o
 *      jeito normal de escrever, e palavra explicita nao se adivinha.
 *   2. IA fraca (Groq): so pra texto que nao diz as refeicoes. Se ela falhar,
 *      a regra segura (no pior caso, uma refeicao com o tipo pela hora).
 *
 * So separa. Nao mede, nao mexe em quantidade, copia o trecho como voce escreveu.
 * Nunca falha pra fora: o pior caso e o texto inteiro virar uma refeicao.
 */
import { groq, porQue, chavesGroq, modelosGroq } from "../../../src/ia-rapida.js";
import { TIPOS, tipoValido, tipoPelaHora } from "./nutricao.mjs";

export const MAX_TEXTO = 2000;
const MAX_REFEICOES = 8;

function sistema(hora) {
  const tipos = Object.keys(TIPOS).join(", ");
  return [
    "Voce separa um relato de alimentacao em REFEICOES. Responda somente JSON, no formato:",
    '{"refeicoes":[{"tipo":"almoco","texto":"arroz, feijao e um bife"}]}',
    "",
    "Regras:",
    `- tipo e um destes: ${tipos}.`,
    "- texto e o trecho do relato com os alimentos daquela refeicao, com as quantidades como a pessoa escreveu.",
    "- Nao invente, nao remova e nao troque nenhum alimento. Nao calcule nada.",
    "- Se o relato for uma refeicao so, devolva uma so.",
    "- Bebida junto da comida pertence a mesma refeicao.",
    "- Sem horario ou nome de refeicao no texto, use a hora atual como pista: " +
      `agora sao ${hora}h, o que normalmente seria ${TIPOS[tipoPelaHora(hora)].rotulo}.`,
    "- Maximo de 8 refeicoes.",
  ].join("\n");
}

/** Poe a resposta do modelo em forma. Puro, testavel sem rede. */
export function normalizarSeparacao(dados, textoOriginal, hora) {
  const lista = dados && Array.isArray(dados.refeicoes) ? dados.refeicoes : [];
  const limpas = lista
    .map((r) => ({
      tipo: tipoValido(r && r.tipo, hora),
      texto: String((r && r.texto) || "").trim().slice(0, 600),
    }))
    .filter((r) => r.texto)
    .slice(0, MAX_REFEICOES);

  // nada aproveitavel: a regra tenta
  if (!limpas.length) return separarPorRegra(textoOriginal, hora);
  return limpas;
}

/* Marcadores de refeicao. A ordem importa: o mais especifico antes
   ("lanche da manha" antes de "lanche", "cafe da manha" antes de "manha"). */
const MARCADORES = [
  [/caf[eé] da manh[aã]/, "cafe_da_manha"],
  [/lanche da manh[aã]/, "lanche_manha"],
  [/lanche da tarde|lanchei|lanchinho|lanche|merendei|merenda/, "lanche_tarde"],
  [/almocei|almo[cç]o|almo[cç]ando/, "almoco"],
  [/jantei|jantar|janta|jantando|[aà] noite|de noite|noite/, "jantar"],
  [/ceia|madrugada/, "ceia"],
  [/tomei caf[eé]|de manh[aã]|pela manh[aã]|manh[aã]zinha|no caf[eé]/, "cafe_da_manha"],
];

/**
 * Separacao por regra, sem IA. Puro.
 *
 * Acha os marcadores no texto, corta de um marcador ate o proximo e usa o tipo
 * do marcador. Texto antes do primeiro marcador vai junto da primeira refeicao.
 * Sem marcador nenhum: uma refeicao so, tipo pela hora.
 */
export function separarPorRegra(texto, hora) {
  const original = String(texto || "").trim().slice(0, MAX_TEXTO);
  const baixo = original.toLowerCase();

  const achados = [];
  for (const [re, tipo] of MARCADORES) {
    const global = new RegExp(re.source, "g");
    let m;
    while ((m = global.exec(baixo))) {
      // o mesmo trecho ja foi reconhecido por um marcador mais especifico
      const sobrepoe = achados.some((a) => m.index < a.fim && m.index + m[0].length > a.inicio);
      if (!sobrepoe) achados.push({ inicio: m.index, fim: m.index + m[0].length, tipo });
    }
  }
  achados.sort((a, b) => a.inicio - b.inicio);

  // marcador repetido do mesmo tipo ("jantei a noite") nao abre refeicao nova
  const cortes = [];
  for (const a of achados) {
    const ultimo = cortes[cortes.length - 1];
    if (ultimo && ultimo.tipo === a.tipo) continue;
    cortes.push(a);
  }

  if (cortes.length <= 1) {
    return [{ tipo: cortes[0] ? cortes[0].tipo : tipoPelaHora(hora), texto: original.slice(0, 600) }];
  }

  const partes = cortes.map((c, i) => {
    const inicio = i === 0 ? 0 : c.inicio;
    const fim = i + 1 < cortes.length ? cortes[i + 1].inicio : original.length;
    // tira o "e" ou a virgula que ficou pendurada no fim do trecho
    const trecho = original.slice(inicio, fim).trim().replace(/[\s,;.]*(\be\b)?[\s,;.]*$/i, "").trim();
    return { tipo: c.tipo, texto: trecho.slice(0, 600) };
  }).filter((p) => p.texto);

  // dois trechos do mesmo tipo seguidos viram um so
  const juntas = [];
  for (const p of partes) {
    const anterior = juntas[juntas.length - 1];
    if (anterior && anterior.tipo === p.tipo) anterior.texto += ", " + p.texto;
    else juntas.push({ ...p });
  }
  return juntas.slice(0, MAX_REFEICOES);
}

export async function separarRefeicoes(texto, hora) {
  const limpo = String(texto || "").trim().slice(0, MAX_TEXTO);

  /* Palavras primeiro. "lanchei ... almocei ... jantei" e explicito: nao ha o
     que adivinhar, e o modelo rapido as vezes junta tudo numa refeicao so. A IA
     so entra quando o texto nao diz as refeicoes com todas as letras. */
  const pelaRegra = separarPorRegra(limpo, hora);
  if (pelaRegra.length >= 2) return { refeicoes: pelaRegra, fonte: "regra", erro: "" };

  /* Percorre modelo x chave: usar so o primeiro de cada fazia uma chave sem
     cota derrubar a separacao inteira. Prazo curto e teto: a regra separa
     bem, entao nao vale segurar a tela esperando modelo. */
  const chaves = chavesGroq();
  const modelos = modelosGroq();
  const fim = Date.now() + Number(process.env.REFEICAO_TETO_SEPARAR_MS || 12000);
  const motivos = [];

  for (const modelo of modelos) {
    for (let i = 0; i < chaves.length; i++) {
      if (Date.now() >= fim) { motivos.push(`${modelo}: tempo esgotado`); break; }
      const rotulo = modelo + (chaves.length > 1 ? ` (chave ${i + 1})` : "");
      try {
        const dados = await groq(sistema(hora), `Relato: """${limpo}"""`, {
          chave: chaves[i], modelo, temperatura: 0.1, maxTokens: 1024,
          prazoMs: Math.min(8000, Math.max(2000, fim - Date.now())),
        });
        return { refeicoes: normalizarSeparacao(dados, limpo, hora), fonte: "ia", erro: "",
          meta: { modelo: rotulo }, avisos: motivos };
      } catch (e) {
        motivos.push(porQue(e, rotulo));
      }
    }
  }

  return {
    refeicoes: separarPorRegra(limpo, hora),
    fonte: "regra",
    erro: motivos.slice(0, 3).join("; ") || "sem chave da Groq no .env",
  };
}

/**
 * Series por grupo muscular. Puro, sem rede e sem banco.
 *
 * Morava no ficha.mjs. Saiu pra ca porque agora tres lugares precisam dessa
 * conta: o mapa do corpo, o fechamento de ciclo (que grava o volume de cada
 * quinzena) e o progresso das metas. O banco.mjs nao podia importar do
 * ficha.mjs sem criar um ciclo de importacao.
 */
import { GRUPOS } from "./equipamentos.mjs";

/* Grupos que precisam rodar. "cardio" e "corpo inteiro" nao entram na
   cobranca: sao complemento, nao musculo esquecido. */
export const PRINCIPAIS = GRUPOS.filter((g) => g !== "cardio" && g !== "corpo inteiro");

/* Grupos do item que servem pra cobranca de rodizio.
   Ficha antiga guardava os grupos do APARELHO: halter com 6 grupos marcava
   tudo como treinado em qualquer exercicio, e o modelo achava que voce
   malhava o corpo inteiro todo dia. Item novo traz grupos_fonte "exercicio".
   Item antigo so conta se o aparelho for especifico (ate 2 grupos); o resto
   o modelo deduz pelo NOME do exercicio, que agora vai no historico. */
export function gruposConfiaveis(item) {
  const g = Array.isArray(item.grupos) ? item.grupos : [];
  if (item.grupos_fonte === "exercicio") return g;
  return g.length <= 2 ? g : [];
}

/**
 * Series feitas por grupo, pro mapa do corpo. Puro.
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

/** Soma dois mapas de series por grupo (ciclo ja gravado + sessoes novas). Puro. */
export function somarGrupos(a, b) {
  const saida = {};
  for (const mapa of [a, b]) {
    if (!mapa || typeof mapa !== "object") continue;
    for (const [g, v] of Object.entries(mapa)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) saida[g] = Math.round(((saida[g] || 0) + n) * 2) / 2;
    }
  }
  return saida;
}

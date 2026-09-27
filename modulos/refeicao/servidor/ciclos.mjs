/**
 * Agrupa refeicoes VELHAS em ciclos de N dias. Tudo PURO.
 *
 * Mesmo desenho do agruparEmCiclos do treino: refeicao vive 14 dias e depois
 * e podada; o que sobra e uma linha por ciclo em refeicao_ciclos.
 *
 * A ancora e a refeicao mais antiga: o primeiro ciclo comeca no dia dela e
 * vai por N dias, o proximo comeca no dia seguinte, e assim por diante. Sem
 * ancora fixa, o mesmo periodo cairia em ciclos diferentes a cada execucao.
 *
 * Recebe as LINHAS CRUAS do banco (kcal, proteina... em colunas), nao o
 * formato da API: quem chama e o fechamento, que le direto da tabela.
 */

const umDecimal = (n) => Math.round(n * 10) / 10;

function maisDias(dataISO, n) {
  return new Date(new Date(dataISO + "T12:00:00Z").getTime() + n * 86400000)
    .toISOString().slice(0, 10);
}

/**
 * @param {Array} refeicoes so as que JA sairam da janela
 * @param {number} dias tamanho do ciclo
 * @returns {Array} linhas prontas pra tabela refeicao_ciclos
 */
export function agruparEmCiclos(refeicoes, dias = 14) {
  const lista = (refeicoes || []).filter((r) => r && r.data).slice()
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  if (!lista.length) return [];

  const ciclos = [];
  let inicio = lista[0].data;

  while (true) {
    const fim = maisDias(inicio, dias - 1);
    const doCiclo = lista.filter((r) => r.data >= inicio && r.data <= fim);
    if (!doCiclo.length) break;

    // dias com registro: 20 refeicoes em 5 dias e historia diferente de 20 em 14
    const diasComRegistro = new Set(doCiclo.map((r) => r.data)).size;
    const kcal = doCiclo.reduce((t, r) => t + (Number(r.kcal) || 0), 0);

    ciclos.push({
      inicio,
      fim,
      refeicoes: doCiclo.length,
      dias: diasComRegistro,
      kcal,
      proteina: umDecimal(doCiclo.reduce((t, r) => t + (Number(r.proteina) || 0), 0)),
      carbo: umDecimal(doCiclo.reduce((t, r) => t + (Number(r.carbo) || 0), 0)),
      gordura: umDecimal(doCiclo.reduce((t, r) => t + (Number(r.gordura) || 0), 0)),
      // media por DIA REGISTRADO: dia sem registro nao derruba a media
      media_kcal_dia: diasComRegistro ? Math.round(kcal / diasComRegistro) : 0,
    });

    const proximo = maisDias(fim, 1);
    if (!lista.some((r) => r.data >= proximo)) break;
    inicio = proximo;
  }

  return ciclos;
}

/**
 * Meta diaria do TREINO, lida pelo modulo metas.
 *
 * Fica aqui, e nao no modulo metas, porque quem sabe o que e "treinei hoje" e
 * o treino. O metas so pergunta. Se a regra mudar, muda neste arquivo.
 *
 * Criterio combinado: conta so a FICHA DO DIA concluida. Ficha extra e
 * atividade manual somam caloria no treino, mas nao fecham esta meta.
 */
import { sessoesDeHoje } from "./banco.mjs";

/** Estado da meta a partir das sessoes do dia. Puro, pra testar sem banco. */
export function estadoDoTreino(doDia) {
  const fichas = (doDia || []).filter((s) => s.origem === "ficha");
  // concluida e smallint no banco (0/1)
  const feita = fichas.find((s) => Number(s.concluida) === 1);

  if (feita) {
    const kcal = Number(feita.calorias) || 0;
    const min = Number(feita.duracao_min) || 0;
    return {
      estado: "feita",
      titulo: "Ficha do dia",
      detalhe: `${kcal} kcal em ${min} min`,
      destaque: { tipo: "kcal", valor: kcal, ativo: true },
      link: "/treino",
    };
  }

  const aberta = fichas[0];
  if (aberta) {
    const total = (aberta.ficha || []).length;
    const marcados = (aberta.feitos || []).length;
    return {
      estado: "andamento",
      titulo: "Ficha do dia",
      detalhe: `${marcados} de ${total} exercícios marcados`,
      link: "/treino",
    };
  }

  return {
    estado: "pendente",
    titulo: "Ficha do dia",
    detalhe: "Ainda não gerada hoje",
    link: "/treino",
  };
}

async function verificar() {
  // sessoesDeHoje ja usa o mesmo fuso e ja descarta fichas regeradas
  return estadoDoTreino(await sessoesDeHoje());
}

export default { id: "treino", rotulo: "Treino", verificar };

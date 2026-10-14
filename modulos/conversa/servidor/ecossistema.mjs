/**
 * Conector do Ecossistema para o Módulo CONVERSA.
 *
 * Traz para o assistente IA a visão unificada dos outros módulos do Segundo Cérebro:
 *  - Refeições: o que a pessoa comeu hoje, calorias, macros, meta calórica diária.
 *  - Treinos: treino do dia (exercícios reais, séries, status concluído, calorias, duração),
 *             progresso do ciclo de 14 dias (ex: dia 12 de 14, reta final do ciclo) e perfil.
 *  - Música: capacidade de sugerir e reproduzir faixas via Sua Música.
 */
import * as bancoRefeicao from "../../refeicao/servidor/banco.mjs";
import * as metasRefeicao from "../../refeicao/servidor/metas.mjs";
import * as bancoTreino from "../../treino/servidor/banco.mjs";

/**
 * Obtém o panorama de refeições do usuário para contextualizar a IA.
 */
export async function obterContextoRefeicoes(dataIso) {
  try {
    const data = dataIso || (bancoRefeicao.hojeLocal ? bancoRefeicao.hojeLocal() : new Date().toISOString().slice(0, 10));
    const refeicoes = await bancoRefeicao.listarDoDia(data).catch(() => []);

    let totalKcal = 0;
    let totalProt = 0;
    let totalCarbo = 0;
    let totalGord = 0;

    const detalhes = (refeicoes || []).map((r) => {
      const tot = r.totais || {};
      totalKcal += Number(tot.kcal) || 0;
      totalProt += Number(tot.proteina) || 0;
      totalCarbo += Number(tot.carbo) || 0;
      totalGord += Number(tot.gordura) || 0;

      const itensStr = (r.itens || []).map((it) => it.nome || it.item || it).join(", ");
      return `- ${r.rotulo || r.tipo} (~${Math.round(tot.kcal || 0)} kcal): ${itensStr || r.texto || "registrado"}`;
    });

    let metaKcal = null;
    try {
      const obj = await metasRefeicao.lerObjetivo().catch(() => null);
      if (obj && metasRefeicao.calcularMeta) {
        const perfil = await bancoTreino.lerPerfil().catch(() => null);
        const calc = await metasRefeicao.calcularMeta(obj, perfil).catch(() => null);
        if (calc && calc.teto) metaKcal = calc.teto;
      }
    } catch {
      // meta opcional
    }

    return {
      temDados: refeicoes.length > 0,
      data,
      totalKcal: Math.round(totalKcal),
      macros: {
        proteina: Math.round(totalProt),
        carbo: Math.round(totalCarbo),
        gordura: Math.round(totalGord),
      },
      metaKcal,
      refeicoesQtd: refeicoes.length,
      detalhes,
    };
  } catch (e) {
    return { temDados: false, erro: e.message };
  }
}

/**
 * Obtém o panorama de treinos e atividade física do usuário.
 */
export async function obterContextoTreinos() {
  try {
    const perfil = await bancoTreino.lerPerfil().catch(() => null);
    const sessoesHoje = await bancoTreino.sessoesDeHoje().catch(() => []);
    const sessoesRecentes = await bancoTreino.listarSessoes(14).catch(() => []);
    const cicloAtual = await bancoTreino.obterCicloAtual().catch(() => null);

    const treinosHojeDetalhes = (sessoesHoje || []).map((s) => {
      // No Supabase, concluida e 1 quando o treino foi finalizado
      const concluida = s.concluida === 1 || Boolean(s.concluida_em);
      const listaExercicios = Array.isArray(s.ficha) ? s.ficha : Array.isArray(s.exercicios) ? s.exercicios : [];
      const feitosSet = new Set(Array.isArray(s.feitos) ? s.feitos : []);

      const exStr = listaExercicios
        .map((e) => {
          const foiFeito = feitosSet.has(e.id);
          const sets = e.series ? `${e.series} séries` : "";
          const reps = e.reps ? `${e.reps} reps` : "";
          const equipamento = e.equipamento_nome ? `[${e.equipamento_nome}]` : "";
          const statusEx = foiFeito ? "✓ feito" : "pendente";
          return `${e.nome || e.exercicio} (${[sets, reps, equipamento, statusEx].filter(Boolean).join(", ")})`;
        })
        .join("; ");

      const statsSessao = [];
      if (s.duracao_min) statsSessao.push(`${s.duracao_min} min de duração`);
      if (s.calorias) statsSessao.push(`${s.calorias} kcal gastas`);
      if (s.esforco) statsSessao.push(`esforço ${s.esforco}`);

      return (
        `- Treino de hoje: ${concluida ? "CONCLUÍDO COM SUCESSO" : "em andamento"}. ` +
        (statsSessao.length ? `(${statsSessao.join(", ")}). ` : "") +
        (exStr ? `Exercícios da ficha: ${exStr}.` : "")
      );
    });

    const sessoesConcluidasRecentes = (sessoesRecentes || []).filter((s) => s.concluida === 1);

    return {
      temPerfil: Boolean(perfil && (perfil.peso_kg || perfil.altura_cm)),
      perfil: perfil
        ? {
            peso: perfil.peso_kg ? `${perfil.peso_kg} kg` : null,
            altura: perfil.altura_cm ? `${perfil.altura_cm} cm` : null,
            nivel: perfil.nivel || null,
            restricoes: perfil.restricoes || null,
          }
        : null,
      treinouHoje: (sessoesHoje || []).some((s) => s.concluida === 1 || Boolean(s.concluida_em)),
      temTreinoHoje: (sessoesHoje || []).length > 0,
      sessoesHoje: treinosHojeDetalhes,
      treinosUltimos14Dias: sessoesConcluidasRecentes.length,
      ciclo: cicloAtual
        ? {
            numero: cicloAtual.numero,
            diaAtual: cicloAtual.dia_atual,
            diasTotais: cicloAtual.dias_totais,
            diasRestantes: cicloAtual.dias_restantes,
            treinosFeitos: cicloAtual.treinos,
            caloriasGastas: cicloAtual.calorias,
            minutosTreinados: cicloAtual.minutos,
          }
        : null,
    };
  } catch (e) {
    return { temPerfil: false, temTreinoHoje: false, erro: e.message };
  }
}

/**
 * Monta o bloco textual que contextualiza a IA com os dados em tempo real do ecossistema.
 */
export async function obterContextoEcossistema() {
  const [ref, tr] = await Promise.all([
    obterContextoRefeicoes(),
    obterContextoTreinos(),
  ]);

  const linhas = [];

  // Seção Treinos
  linhas.push("--- DADOS DE TREINO E ATIVIDADE FÍSICA (Módulo Treino) ---");
  if (tr && tr.temTreinoHoje) {
    linhas.push(`Status de hoje: ${tr.treinouHoje ? "TREINO JÁ CONCLUÍDO HOJE" : "treino em andamento/planejado"}.`);
    if (tr.sessoesHoje && tr.sessoesHoje.length) {
      linhas.push(...tr.sessoesHoje);
    }
  } else {
    linhas.push("Nenhum treino registrado hoje até agora.");
  }

  if (tr && tr.ciclo) {
    const c = tr.ciclo;
    const finalDeCiclo = c.diasRestantes <= 3;
    linhas.push(
      `Progresso do Ciclo: Ciclo ${c.numero}, dia ${c.diaAtual} de ${c.diasTotais} ` +
      `(${c.diasRestantes === 0 ? "último dia do ciclo!" : `faltam ${c.diasRestantes} dia(s) para fechar o ciclo`}). ` +
      `No ciclo atual ele acumulou ${c.treinosFeitos} treino(s), ${c.caloriasGastas} kcal e ${c.minutosTreinados} minutos.` +
      (finalDeCiclo ? " [ATENÇÃO: Ele está na reta final do ciclo de treinos, incentive a manter o ritmo!]" : "")
    );
  }

  if (tr && tr.temPerfil && tr.perfil) {
    const p = tr.perfil;
    const partesP = [];
    if (p.peso) partesP.push(`Peso: ${p.peso}`);
    if (p.altura) partesP.push(`Altura: ${p.altura}`);
    if (p.nivel) partesP.push(`Nível: ${p.nivel}`);
    if (p.restricoes) partesP.push(`Restrições: ${p.restricoes}`);
    if (partesP.length) {
      linhas.push(`Contexto corporal (NÃO cite esses números roboticamente a menos que ele pergunte): ${partesP.join(", ")}.`);
    }
  }

  // Seção Refeições
  linhas.push("\n--- DADOS DE NUTRIÇÃO E REFEIÇÕES (Módulo Refeição) ---");
  if (ref && ref.temDados) {
    linhas.push(
      `Hoje (${ref.data}) ele consumiu ${ref.totalKcal} kcal` +
        (ref.metaKcal ? ` (meta diária: ~${ref.metaKcal} kcal)` : "") +
        `. Macros: ${ref.macros.proteina}g proteína, ${ref.macros.carbo}g carbo, ${ref.macros.gordura}g gordura.`
    );
    if (ref.detalhes && ref.detalhes.length) {
      linhas.push("Refeições registradas hoje:");
      linhas.push(...ref.detalhes);
    }
  } else {
    linhas.push("Nenhuma refeição registrada hoje até o momento no módulo Refeições.");
  }

  // Seção Música
  linhas.push("\n--- MÚSICA E REPRODUÇÃO (Módulo Música) ---");
  linhas.push(
    "Você possui integração com o player do Sua Música do ecossistema. " +
    "Quando a pessoa pedir para você tocar uma música, colocar um som, pedir algo para treinar, relaxar ou focar, você deve sugerir a música ou artista e incluir OBRIGATORIAMENTE no final da mensagem a tag: [TOCAR_MUSICA: artista ou termo de busca]. " +
    "Exemplo: 'Coloquei um som pra você dar o gás! [TOCAR_MUSICA: João Gomes]'. " +
    "A interface do chat vai capturar essa tag e tocar o som na hora com um reprodutor integrado."
  );

  return {
    refeicoes: ref,
    treino: tr,
    blocoTexto: linhas.join("\n"),
  };
}

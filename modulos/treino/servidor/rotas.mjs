/**
 * Rotas do modulo TREINO, sob /treino/api.
 *
 * Neste bloco so o que nao depende de IA: saude, perfil e pesagem. Ficha,
 * equipamento e caloria entram nos proximos.
 *
 * Mesmo formato do modulo conversa: uma funcao rotear() que o index.js pluga,
 * devolvendo objeto (vira 200) ou lancando ErroHttp.
 */
import { ErroHttp, checarBanco, lerPerfil, salvarPerfil, listarPesagens,
  diasAtePesagem, perfilPronto, JANELA_DIAS,
  listarEquipamentos, buscarEquipamento, salvarEquipamento,
  desativarEquipamento, reativarEquipamento } from "./banco.mjs";
import { analisarEquipamento, normalizarRascunho, TIPOS } from "./equipamentos.mjs";
import { listarSessoes, buscarSessao, sessaoDeHoje, criarSessao, hojeLocal } from "./banco.mjs";
import { gerarFicha } from "./ficha.mjs";
import { atualizarSessao } from "./banco.mjs";
import { caloriasDaSessao, basalDiario, idadeDe, percentualDoDia,
  comparativoDoCiclo, sequenciaDeDias } from "./calorias.mjs";
import { analisarAtividade } from "./atividade.mjs";
import { listarCiclos, fecharCiclosVencidos } from "./banco.mjs";
import { agruparEmCiclos, resumoDoCiclo } from "./calorias.mjs";
import { caloriasDoBloco, metValido } from "./calorias.mjs";

function exigir(condicao, status, mensagem, dica = "") {
  if (!condicao) throw new ErroHttp(status, mensagem, dica);
}

/* Validacao dos numeros do corpo. Nao e frescura: altura em metros (1.78) em
   vez de centimetros quebra o calculo basal em silencio, e o usuario nunca
   descobre por que o numero ficou estranho. */
function numeroEntre(valor, min, max, nome) {
  if (valor === undefined || valor === null || valor === "") return null;
  const n = Number(valor);
  exigir(Number.isFinite(n), 400, `${nome} precisa ser um numero.`);
  exigir(n >= min && n <= max, 400, `${nome} fora da faixa (${min} a ${max}).`);
  return n;
}

export async function rotear(req, res, rota, url) {
  if (req.method === "GET" && rota === "/health") {
    const banco = await checarBanco();
    return { status: banco.ok ? "ok" : "degradado", modulo: "treino", banco };
  }

  /* GET /perfil
     Devolve o perfil mais o que a tela precisa decidir sozinha: se da pra
     calcular caloria e se esta na hora de pedir o peso. Calcular isso aqui
     evita a tela reimplementar a regra dos 14 dias. */
  if (req.method === "GET" && rota === "/perfil") {
    const perfil = await lerPerfil();
    const faltam = diasAtePesagem(perfil);
    return {
      perfil,
      pronto: perfilPronto(perfil),
      janela_dias: JANELA_DIAS,
      pesagem: {
        faltam_dias: faltam,
        pedir: faltam === null || faltam <= 0,
        // nunca pesou e diferente de pesou ha 20 dias: a tela fala diferente
        primeira_vez: faltam === null,
      },
    };
  }

  if (req.method === "PUT" && rota === "/perfil") {
    const c = req.body || {};
    const campos = {
      nascimento: c.nascimento || null,
      altura_cm: numeroEntre(c.altura_cm, 100, 250, "Altura em cm"),
      sexo: c.sexo === "M" || c.sexo === "F" ? c.sexo : null,
      peso_kg: numeroEntre(c.peso_kg, 30, 400, "Peso em kg"),
      restricoes: typeof c.restricoes === "string" ? c.restricoes.slice(0, 600) : undefined,
      nivel: ["iniciante", "intermediario", "avancado"].includes(c.nivel) ? c.nivel : undefined,
    };
    // undefined = nao mandou, mantem o que estava. null = mandou vazio, limpa.
    Object.keys(campos).forEach((k) => campos[k] === undefined && delete campos[k]);
    const perfil = await salvarPerfil(campos);
    return { ok: true, perfil, pronto: perfilPronto(perfil) };
  }

  /* POST /pesagem { peso_kg }
     Atalho do lembrete: so o peso, sem mexer no resto do perfil. Passa pelo
     salvarPerfil de proposito, que e quem grava a pesagem e reinicia o relogio. */
  if (req.method === "POST" && rota === "/pesagem") {
    const peso = numeroEntre((req.body || {}).peso_kg, 30, 400, "Peso em kg");
    exigir(peso, 400, "Informe o peso em kg.");
    const perfil = await salvarPerfil({ peso_kg: peso });
    return { ok: true, perfil, faltam_dias: diasAtePesagem(perfil) };
  }

  if (req.method === "GET" && rota === "/pesagens") {
    return { pesagens: await listarPesagens(Number(url.searchParams.get("n")) || 30) };
  }

  /* ------------------------------------------------------ equipamentos */

  if (req.method === "GET" && rota === "/equipamentos") {
    const incluirInativos = url.searchParams.get("todos") === "1";
    return { equipamentos: await listarEquipamentos({ incluirInativos }), tipos: TIPOS };
  }

  /* POST /equipamentos/analisar { nome, observacao }
     NAO SALVA. Devolve o rascunho pra tela mostrar e voce conferir. E o passo
     que impede o chute do modelo rapido de entrar no banco caladinho. */
  if (req.method === "POST" && rota === "/equipamentos/analisar") {
    const { nome, observacao } = req.body || {};
    exigir(String(nome || "").trim(), 400, "Informe o nome do equipamento.");
    return await analisarEquipamento(nome, observacao);
  }

  /* POST /equipamentos - salva o que voce confirmou.
     Passa pelo normalizarRascunho de novo de proposito: voce pode ter editado
     o MET na tela, e a faixa por tipo vale igual pra voce e pra IA. */
  if (req.method === "POST" && rota === "/equipamentos") {
    const c = req.body || {};
    exigir(String(c.nome || "").trim(), 400, "Informe o nome do equipamento.");
    const limpo = normalizarRascunho(c, c.nome);
    const salvo = await salvarEquipamento({ ...limpo, gerado_por_ia: c.gerado_por_ia ? 1 : 0 });
    return { ok: true, equipamento: salvo, met_corrigido: limpo.met_corrigido, met_motivo: limpo.met_motivo };
  }

  const idEquip = /^\/equipamentos\/([0-9a-f-]{36})$/i.exec(rota);
  if (idEquip) {
    const id = idEquip[1];
    const atual = await buscarEquipamento(id);
    exigir(atual, 404, "Equipamento nao encontrado.");

    if (req.method === "GET") return { equipamento: atual };

    if (req.method === "PUT") {
      const c = req.body || {};
      // reativar e um PUT com ativo: 1, pra nao inventar rota so pra isso
      if (c.ativo === 1 && !atual.ativo) return { ok: true, equipamento: await reativarEquipamento(id) };
      const limpo = normalizarRascunho({ ...atual, ...c }, c.nome || atual.nome);
      const salvo = await salvarEquipamento({ ...limpo, id, gerado_por_ia: c.gerado_por_ia ?? atual.gerado_por_ia });
      return { ok: true, equipamento: salvo, met_corrigido: limpo.met_corrigido, met_motivo: limpo.met_motivo };
    }

    if (req.method === "DELETE") {
      // ?forcar=1 apaga de verdade; sem isso e so inativar
      const forcar = url.searchParams.get("forcar") === "1";
      return { ok: true, ...(await desativarEquipamento(id, forcar)) };
    }
  }

  /* ----------------------------------------------------- treino do dia */

  /* GET /hoje - tudo que a tela precisa pra abrir, numa chamada.
     Junta perfil, pendencia de pesagem, equipamentos e a sessao de hoje. Sem
     isso a tela faria quatro chamadas e ainda teria que costurar as regras. */
  if (req.method === "GET" && rota === "/hoje") {
    /* Poda oportunista: na Vercel nao existe processo de fundo, entao o
       fechamento de ciclo acontece quando voce abre o dia.

       O catch e obrigatorio: limpeza que derruba a tela e pior que lixo
       acumulado, e o proximo acesso tenta de novo. */
    const podou = await fecharCiclosVencidos(agruparEmCiclos).catch((e) => {
      console.error("[treino] fechamento de ciclo falhou: " + e.message);
      return null;
    });

    const [perfil, equipamentos, sessao, sessoes] = await Promise.all([
      lerPerfil(), listarEquipamentos(), sessaoDeHoje(), listarSessoes(),
    ]);
    const faltam = diasAtePesagem(perfil);
    return {
      data: hojeLocal(),
      perfil,
      pronto: perfilPronto(perfil),
      pesagem: { faltam_dias: faltam, pedir: faltam === null || faltam <= 0, primeira_vez: faltam === null },
      equipamentos: equipamentos.length,
      // sem equipamento nao da pra montar ficha: a tela manda cadastrar antes
      pode_gerar: equipamentos.length > 0,
      sessao,
      /* O panorama vem junto, com zeros quando nao ha nada. Painel que so
         aparece depois do primeiro treino esconde justamente de quem mais
         precisa de referencia: quem esta comecando. */
      resumo: resumoDoCiclo(sessoes, hojeLocal(), JANELA_DIAS),
      // null quando nao houve poda; a tela pode avisar que um ciclo fechou
      ciclo_fechado: podou && podou.ciclos ? podou : null,
    };
  }

  if (req.method === "GET" && rota === "/sessoes") {
    const dias = Math.min(Math.max(Number(url.searchParams.get("dias")) || JANELA_DIAS, 1), 60);
    return { dias, sessoes: await listarSessoes(dias) };
  }

  /* POST /ficha { pedido }
     Gera e JA GRAVA como sessao do dia, ainda nao concluida. Gravar na hora e
     de proposito: ficha que so existe na tela some quando o celular trava no
     meio do treino.

     Se ja houver sessao hoje, a nova aponta pra antiga em regerada_de, e as
     duas ficam. Foi o que combinamos pra o historico nao mentir. */
  if (req.method === "POST" && rota === "/ficha") {
    const perfil = await lerPerfil();
    const equipamentos = await listarEquipamentos();
    exigir(equipamentos.length, 400, "Cadastre pelo menos um equipamento antes de gerar ficha.",
      "Use POST /treino/api/equipamentos/analisar pra comecar.");

    const anterior = await sessaoDeHoje();
    exigir(!(anterior && anterior.concluida), 409, "O treino de hoje ja foi concluido.",
      "Lance uma atividade manual se quiser registrar outro.");

    const sessoes = await listarSessoes();
    const gerada = await gerarFicha({
      perfil, equipamentos, sessoes,
      pedido: (req.body || {}).pedido || "",
    });
    exigir(gerada.ficha.length, 502, "O modelo nao devolveu exercicio nenhum valido.",
      "Tente de novo; se repetir, revise os equipamentos cadastrados.");

    const sessao = await criarSessao({
      ficha: gerada.ficha,
      motivo: gerada.motivo,
      regerada_de: anterior ? anterior.id : null,
    });

    return {
      ok: true,
      sessao,
      // a tela avisa quando o modelo tentou usar aparelho que voce nao tem
      descartados: gerada.descartados,
      regerou: !!anterior,
      fonte: gerada.meta,
    };
  }

  const idSessao = /^\/sessoes\/([0-9a-f-]{36})$/i.exec(rota);
  if (idSessao && req.method === "GET") {
    const sessao = await buscarSessao(idSessao[1]);
    exigir(sessao, 404, "Sessao nao encontrada.");
    return { sessao };
  }

  /* PUT /sessoes/:id/feitos { feitos: ["e1","e3"] }
     Salva o check no meio do treino, sem fechar nada. Existe porque treino
     dura 40 minutos e o celular trava: o que voce ja marcou nao pode sumir. */
  const idFeitos = /^\/sessoes\/([0-9a-f-]{36})\/feitos$/i.exec(rota);
  if (idFeitos && req.method === "PUT") {
    const sessao = await buscarSessao(idFeitos[1]);
    exigir(sessao, 404, "Sessao nao encontrada.");
    exigir(!sessao.concluida, 409, "Essa sessao ja foi concluida.");
    const validos = new Set((sessao.ficha || []).map((i) => String(i.id)));
    const feitos = [...new Set(((req.body || {}).feitos || []).map(String).filter((f) => validos.has(f)))];
    return { ok: true, sessao: await atualizarSessao(sessao.id, { feitos }) };
  }

  /* POST /sessoes/:id/concluir { feitos, duracao_min, esforco, observacao }
     O fechamento. Calcula a caloria SO do que foi marcado, grava, e devolve o
     comparativo pra tela parabenizar com numero, nao com frase pronta. */
  const idConcluir = /^\/sessoes\/([0-9a-f-]{36})\/concluir$/i.exec(rota);
  if (idConcluir && req.method === "POST") {
    /* Valida ANTES de ir ao banco: recusar por campo faltando depois de uma
       consulta e desperdicio, e deixa a validacao sem como ser testada sem
       banco de pe. */
    const c = req.body || {};
    const duracao = numeroEntre(c.duracao_min, 1, 600, "Duracao em minutos");
    exigir(duracao, 400, "Informe quanto tempo durou o treino.");
    exigir(["leve", "moderado", "pesado"].includes(c.esforco), 400,
      "Diga como foi o treino: leve, moderado ou pesado.");

    const sessao = await buscarSessao(idConcluir[1]);
    exigir(sessao, 404, "Sessao nao encontrada.");
    exigir(!sessao.concluida, 409, "Essa sessao ja foi concluida.",
      "Conclusao e definitiva: o numero dela ja entrou no ciclo.");

    const validos = new Set((sessao.ficha || []).map((i) => String(i.id)));
    const feitos = Array.isArray(c.feitos)
      ? [...new Set(c.feitos.map(String).filter((f) => validos.has(f)))]
      : (sessao.feitos || []);

    const perfil = await lerPerfil();
    const calc = caloriasDaSessao({
      ficha: sessao.ficha, feitos, duracaoMin: duracao, esforco: c.esforco, perfil,
    });

    const salva = await atualizarSessao(sessao.id, {
      feitos,
      duracao_min: duracao,
      esforco: c.esforco,
      observacao: String(c.observacao || "").slice(0, 400),
      calorias: calc.total,
      concluida: 1,
    });

    /* O comparativo olha o ciclo SEM a de hoje, pra media nao se comparar
       consigo mesma. */
    const doCiclo = (await listarSessoes()).filter((s) => s.id !== sessao.id);
    const idade = idadeDe(perfil.nascimento);
    const basal = basalDiario({
      sexo: perfil.sexo, pesoKg: perfil.peso_kg, alturaCm: perfil.altura_cm, idade,
    });

    return {
      ok: true,
      sessao: salva,
      calorias: {
        total: calc.total,
        por_item: calc.porItem,
        aviso: calc.aviso,
        // contexto: sozinho, 391 kcal nao diz nada pra quem nao conta caloria
        percentual_do_dia: percentualDoDia(calc.total, basal),
        basal,
      },
      progresso: {
        ...comparativoDoCiclo(doCiclo, calc.total),
        sequencia: sequenciaDeDias([...doCiclo, salva], salva.data),
        // itens da ficha que voce nao marcou: informacao, nao falha
        pulados: (sessao.ficha || []).length - feitos.length,
      },
    };
  }

  /* ------------------------------------------------ atividade manual */

  /* POST /manual/analisar { texto }  - NAO SALVA.
     Tabela local primeiro, Groq so no que ela nao souber. */
  if (req.method === "POST" && rota === "/manual/analisar") {
    const { texto } = req.body || {};
    exigir(String(texto || "").trim(), 400, "Escreva o que voce fez.");
    return await analisarAtividade(texto);
  }

  /* POST /manual { nome, met, duracao_min, esforco, observacao }
     Entra como sessao de origem 'manual': sem ficha, um bloco so. Ja nasce
     concluida, porque atividade manual se lanca depois de acontecer. */
  if (req.method === "POST" && rota === "/manual") {
    const c = req.body || {};
    const nome = String(c.nome || "").trim().slice(0, 80);
    exigir(nome, 400, "Informe o nome da atividade.");
    const duracao = numeroEntre(c.duracao_min, 1, 600, "Duracao em minutos");
    exigir(duracao, 400, "Informe quanto tempo durou.");
    exigir(["leve", "moderado", "pesado"].includes(c.esforco), 400,
      "Diga como foi: leve, moderado ou pesado.");

    const perfil = await lerPerfil();
    exigir(perfilPronto(perfil), 400, "Cadastre seu peso antes de lancar atividade.",
      "Sem peso nao da pra calcular caloria.");

    // teto de 14 igual ao da analise: acima disso e atleta de elite
    const met = Math.min(metValido(c.met), 14);
    const calorias = Math.round(caloriasDoBloco({
      met, minutos: duracao, pesoKg: perfil.peso_kg, esforco: c.esforco,
    }));

    /* A ficha guarda UM item so, com o mesmo formato dos outros. Assim o
       resumo dos 14 dias e a conta do ciclo tratam manual e ficha igual, sem
       caso especial espalhado pelo codigo. */
    const sessao = await criarSessao({
      origem: "manual",
      ficha: [{ id: "m1", nome, met, series: 1, reps: "-", descanso_s: 0, grupos: [] }],
      motivo: "",
    });
    const salva = await atualizarSessao(sessao.id, {
      feitos: ["m1"],
      duracao_min: duracao,
      esforco: c.esforco,
      observacao: String(c.observacao || "").slice(0, 400),
      calorias,
      concluida: 1,
    });

    const doCiclo = (await listarSessoes()).filter((s) => s.id !== sessao.id);
    const idade = idadeDe(perfil.nascimento);
    const basal = basalDiario({
      sexo: perfil.sexo, pesoKg: perfil.peso_kg, alturaCm: perfil.altura_cm, idade,
    });

    return {
      ok: true,
      sessao: salva,
      calorias: { total: calorias, percentual_do_dia: percentualDoDia(calorias, basal), basal },
      progresso: {
        ...comparativoDoCiclo(doCiclo, calorias),
        sequencia: sequenciaDeDias([...doCiclo, salva], salva.data),
        pulados: 0,
      },
    };
  }

  /* ---------------------------------------------------------- ciclos */

  if (req.method === "GET" && rota === "/ciclos") {
    return { ciclos: await listarCiclos(Number(url.searchParams.get("n")) || 26) };
  }

  /* Fechamento manual, pra quando voce quiser forcar sem abrir o dia. */
  if (req.method === "POST" && rota === "/ciclos/fechar") {
    return { ok: true, ...(await fecharCiclosVencidos(agruparEmCiclos)) };
  }

  throw new ErroHttp(404, "Rota nao encontrada no modulo treino.");
}

/**
 * Testes das partes PURAS do modulo CONVERSA (sem rede, sem banco).
 * Rodar: npm test
 *
 * Testam o que decide comportamento: risco de vida, escolha de modo, validacao
 * do que vem de um LLM, fusao de busca, corte de evidencia, regras de memoria.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { detectarCrise, transicao, instrucaoDoModo, resolverModo, ehSensivel, tokensDoTurno, MODOS } from "../servidor/modos.mjs";
import { planoPorHeuristica, sanearPlano, aplicarRegrasFixas, ultimoModo, resumirHistorico } from "../servidor/planejador.mjs";
import { sanearArgs, descreverParaPlanejador, NOMES_FERRAMENTAS } from "../servidor/ferramentas-spec.mjs";
import { montarTsQuery, fundirConsultas, separarSemRerank, separarComRerank, lerRerank, decidirSeparacao } from "../servidor/busca.mjs";
import { cortarEmLinhas, montarEvidencia, fraseDoPlano } from "../servidor/evidencia.mjs";
import { sanearCandidatos, sanearDecisoes } from "../servidor/memoria.mjs";
import { limparResposta, historicoParaMensagens, montarPromptTurno, blocoDeMemorias } from "../servidor/resposta.mjs";

/* ------------------------------------------------------------------ crise */

test("crise: frases de risco real disparam", () => {
  for (const t of [
    "eu quero me matar", "queria morrer", "não aguento mais viver", "tô pensando em suicídio",
    "vontade de me machucar", "acho que o mundo seria melhor sem mim", "queria dormir e não acordar",
    "PENSEI EM ACABAR COM TUDO", "ninguém sentiria minha falta",
    "não aguento mais, queria sumir", "queria sumir, não aguento mais nada",
  ]) assert.equal(detectarCrise(t), true, t);
});

test("crise: expressões comuns NÃO disparam", () => {
  for (const t of [
    "tô morrendo de rir", "morri de vergonha", "vou matar a saudade", "to morto de cansaço",
    "esse bug me mata", "quero morrer de fome, cadê o almoço", "matei o treino hoje", "mataram o projeto",
    "como faço pra matar um processo no linux", "queria sumir da internet por uns dias", "não aguento mais esse trânsito", "",
  ]) assert.equal(detectarCrise(t), false, t);
});

/* ------------------------------------------------------------------ modos */

test("modos: todos têm instrução, tamanho e pensamento válidos", () => {
  for (const m of Object.values(MODOS)) {
    assert.ok(m.instrucao.length > 30, m.id);
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(m.pensamento), m.id);
    assert.ok(tokensDoTurno(m.id, null) >= 2048, m.id);
  }
});

test("modos: desabafo, reflexão e crise são sensíveis; técnico e papo não", () => {
  assert.equal(ehSensivel("escuta"), true);
  assert.equal(ehSensivel("reflexao"), true);
  assert.equal(ehSensivel("crise"), true);
  assert.equal(ehSensivel("tecnico"), false);
  assert.equal(ehSensivel("parceiro"), false);
});

test("modos: o modo de escuta proíbe aconselhar e o de crise cita CVV", () => {
  assert.match(MODOS.escuta.instrucao, /NÃO aconselhe/);
  assert.match(MODOS.crise.instrucao, /188/);
  assert.match(MODOS.crise.instrucao, /SAMU 192/);
});

test("transição: depois de desabafo, pergunta técnica ganha ponte; sem troca, nada", () => {
  assert.match(transicao({ anterior: "escuta", atual: "tecnico", cargaAnterior: 2 }), /pesada/);
  assert.match(transicao({ anterior: "tecnico", atual: "escuta" }), /Largue o tom técnico/);
  assert.match(transicao({ anterior: "crise", atual: "parceiro" }), /risco/);
  assert.equal(transicao({ anterior: "tecnico", atual: "tecnico" }), "");
  assert.equal(transicao({ anterior: null, atual: "tecnico" }), "");
  assert.equal(transicao({ anterior: "inexistente", atual: "tecnico" }), "");
});

test("instrucaoDoModo: inclui papel, toque secundário, ponte e tamanho; crise nunca é secundário", () => {
  const t = instrucaoDoModo({ modo: "escuta", secundario: "parceiro", tamanho: "curta", ponte: "ponte x" });
  assert.match(t, /modo: escuta/);
  assert.match(t, /toque de "parceiro"/);
  assert.match(t, /Transição: ponte x/);
  assert.match(t, /Tamanho:/);
  assert.doesNotMatch(instrucaoDoModo({ modo: "escuta", secundario: "crise" }), /toque de "crise"/);
  assert.equal(resolverModo("lixo").id, "pensar_junto");
});

/* ------------------------------------------------------------- planejador */

test("heurística: escolhe modo pelo tipo de mensagem", () => {
  assert.equal(planoPorHeuristica("tô muito cansado e sem forças").modo, "escuta");
  assert.equal(planoPorHeuristica("por que eu sempre me sabotei nos relacionamentos").modo, "reflexao");
  assert.equal(planoPorHeuristica("como faço pra corrigir esse erro de sql no supabase").modo, "tecnico");
  assert.equal(planoPorHeuristica("escreva um email pro cliente").modo, "execucao");
  assert.equal(planoPorHeuristica("e aí mano, blz?").modo, "parceiro");
  assert.equal(planoPorHeuristica("como estou indo na evolução dos treinos").modo, "analise");
});

test("heurística: só liga as fontes que a mensagem toca", () => {
  const nomes = (t) => planoPorHeuristica(t).ferramentas.map((f) => f.nome);
  assert.ok(nomes("treinei hoje na academia").includes("ver_treinos"));
  assert.ok(nomes("quantas calorias eu comi").includes("ver_refeicoes"));
  assert.ok(!nomes("me ajuda com uma ideia de app").includes("ver_treinos"));
  assert.ok(!nomes("me ajuda com uma ideia de app").includes("ver_refeicoes"));
});

test("sanearPlano: o modelo NÃO decide crise; regra fixa decide", () => {
  const p = sanearPlano({ modo: "crise", tamanho: "longa" }, { texto: "me ajuda com um código em python" });
  assert.notEqual(p.modo, "crise");
  const c = sanearPlano({ modo: "tecnico", ferramentas: [{ nome: "ver_treinos" }] }, { texto: "quero me matar" });
  assert.equal(c.modo, "crise");
  assert.equal(c.tamanho, "curta");
  assert.deepEqual(c.ferramentas.map((f) => f.nome), ["buscar_memoria"]); // só memória
  assert.equal(c.crise, true);
});

test("sanearPlano: descarta ferramenta inexistente, repetida e limita a 5 + memória", () => {
  const p = sanearPlano({
    modo: "analise",
    ferramentas: [
      { nome: "ver_treinos" }, { nome: "ver_treinos" }, { nome: "apagar_tudo" }, "ver_refeicoes",
      { nome: "ver_peso" }, { nome: "ver_metas" }, { nome: "ver_tarefas" }, { nome: "ver_radar" },
    ],
  }, { texto: "como estou indo?" });
  const nomes = p.ferramentas.map((f) => f.nome);
  assert.ok(!nomes.includes("apagar_tudo"));
  assert.equal(nomes.filter((n) => n === "ver_treinos").length, 1);
  assert.ok(nomes.includes("buscar_memoria"));
  assert.ok(nomes.length <= 6);
});

test("sanearPlano: lixo do modelo vira plano válido (nunca lança)", () => {
  for (const bruto of [null, undefined, "texto", 42, [], {}, { modo: 7, ferramentas: "x", consultas: 5 }]) {
    const p = sanearPlano(bruto, { texto: "oi" });
    assert.ok(MODOS[p.modo]);
    assert.ok(Array.isArray(p.ferramentas) && p.ferramentas.length >= 1);
    assert.ok(Array.isArray(p.consultas));
  }
});

test("sanearPlano: data na mensagem vira filtro calculado em código", () => {
  const agora = new Date("2026-11-09T15:00:00Z");
  const p = sanearPlano({ modo: "resgate", ferramentas: [{ nome: "buscar_notas" }] }, { texto: "o que eu anotei ontem?", agora });
  assert.ok(p.janela && p.janela.rotulo === "ontem");
  assert.equal(p.ferramentas[0].nome, "notas_por_periodo");
});

test("sanearPlano: logo após crise, mensagem curta não vira técnica de repente", () => {
  const p = sanearPlano({ modo: "tecnico" }, { texto: "não sei", modoAnterior: "crise" });
  assert.equal(p.modo, "escuta");
});

test("sanearPlano: memória roda sempre e 'memoravel' só com true explícito", () => {
  assert.ok(sanearPlano({ modo: "parceiro" }, { texto: "oi" }).ferramentas.some((f) => f.nome === "buscar_memoria"));
  assert.equal(sanearPlano({ memoravel: "true" }, { texto: "oi" }).memoravel, false);
  assert.equal(sanearPlano({ memoravel: true }, { texto: "oi" }).memoravel, true);
});

test("ultimoModo e resumirHistorico leem o meta dos turnos", () => {
  const turnos = [
    { papel: "pessoa", texto: "oi" },
    { papel: "cerebro", texto: "fala", meta: { modo: "escuta", carga_emocional: 2 } },
    { papel: "pessoa", texto: "tô mal" },
  ];
  assert.deepEqual(ultimoModo(turnos), { modo: "escuta", carga: 2 });
  assert.deepEqual(ultimoModo([]), { modo: null, carga: 0 });
  assert.match(resumirHistorico(turnos), /CÉREBRO · modo escuta/);
  assert.match(resumirHistorico([]), /primeira mensagem/);
});

/* --------------------------------------------------------------- ferramentas */

test("sanearArgs: força tipos, limites e padrões", () => {
  assert.deepEqual(sanearArgs("ver_treinos", { dias: 9999 }), { dias: 60 });
  assert.deepEqual(sanearArgs("ver_treinos", { dias: "abc" }), { dias: 14 });
  assert.deepEqual(sanearArgs("ver_tarefas", { foco: "inventado" }), { foco: "todas" });
  assert.deepEqual(sanearArgs("ver_tarefas", { foco: "VENCIDAS" }), { foco: "vencidas" });
  assert.deepEqual(sanearArgs("buscar_notas", { consultas: ["a", "b", "c", "d", "e"] }).consultas, ["a", "b", "c"]);
  assert.deepEqual(sanearArgs("buscar_notas", { consultas: "uma só" }).consultas, ["uma só"]);
  assert.deepEqual(sanearArgs("ferramenta_que_nao_existe", { x: 1 }), {});
  assert.deepEqual(sanearArgs("ver_metas", null), {});
});

test("catálogo: o prompt do planejador lista todas as ferramentas", () => {
  const d = descreverParaPlanejador();
  for (const n of NOMES_FERRAMENTAS) assert.ok(d.includes(n), n);
});

/* --------------------------------------------------------------------- busca */

test("tsquery: OR, sem acento, sem stopword e sem sintaxe perigosa", () => {
  assert.equal(montarTsQuery(["Reunião com a Fernanda sobre o projeto Atlântico"]), "reuniao | fernanda | projeto | atlantico");
  assert.equal(montarTsQuery(["a o de"]), null);
  assert.equal(montarTsQuery([""]), null);
  const q = montarTsQuery(["foo'; drop table ideias; -- & | ! (x)"]);
  assert.match(q, /^[a-z0-9 |]+$/); // so letras, numeros, espaco e OR
});

test("tsquery: dedupe e teto de termos", () => {
  assert.equal(montarTsQuery(["treino treino treino"]), "treino");
  const muitos = montarTsQuery([Array.from({ length: 30 }, (_, i) => "palavra" + i).join(" ")]);
  assert.equal(muitos.split(" | ").length, 12);
});

test("fusão: nota que aparece bem em várias consultas sobe", () => {
  const a = [{ id: "1", sim: 0.6 }, { id: "2", sim: 0.58 }, { id: "3", sim: 0.5 }];
  const b = [{ id: "3", sim: 0.7 }, { id: "1", sim: 0.55 }];
  const f = fundirConsultas([a, b]);
  assert.deepEqual(f.map((n) => n.id).slice(0, 2).sort(), ["1", "3"]);
  assert.equal(f.find((n) => n.id === "3").sim, 0.7); // guarda o melhor cosseno
});

test("corte relativo: acompanha o melhor score, não um número fixo", () => {
  // mesma 'forma' de ranking em duas escalas de embedding diferentes
  const escalaA = [0.9, 0.88, 0.6, 0.55].map((sim, i) => ({ id: "a" + i, sim, lex_rank: null }));
  const escalaB = [0.62, 0.6, 0.45, 0.42].map((sim, i) => ({ id: "b" + i, sim, lex_rank: null }));
  assert.equal(separarSemRerank(escalaA, { piso: 0.4 }).fortes.length, 2);
  assert.equal(separarSemRerank(escalaB, { piso: 0.4 }).fortes.length, 2);
});

test("corte relativo: achado por palavra com ranking alto entra como forte", () => {
  const c = [{ id: "1", sim: 0.8, lex_rank: null }, { id: "2", sim: 0.45, lex_rank: 1 }, { id: "3", sim: 0.2, lex_rank: null }];
  const { fortes, fracas } = separarSemRerank(c, { piso: 0.5, folga: 0.1 });
  assert.deepEqual(fortes.map((n) => n.id), ["1", "2"]);
  assert.equal(fracas.length, 0);
});

test("rerank: 2-3 forte, 1 tangente, 0 descartada; saída pouco confiável vira null", () => {
  const cands = [1, 2, 3, 4].map((i) => ({ id: String(i), pontos: 1 / i }));
  const nota = new Map([[1, 3], [2, 1], [3, 0], [4, 2]]);
  const { fortes, fracas } = separarComRerank(cands, nota);
  assert.deepEqual(fortes.map((n) => n.id), ["1", "4"]);
  assert.deepEqual(fracas.map((n) => n.id), ["2"]);
  assert.equal(lerRerank({ r: [{ i: 1, n: 3 }] }, 6), null); // cobriu 1 de 6
  assert.equal(lerRerank({ r: [{ i: 1, n: 9 }, { i: 2, n: -4 }] }, 2).get(1), 3); // clampa 0..3
  assert.equal(lerRerank(null, 3), null);
  assert.equal(lerRerank({ r: [{ i: 99, n: 3 }] }, 1), null); // indice fora do intervalo
});

/* ------------------------------------------------------------------ evidência */

test("cortarEmLinhas: corta no fim de linha e avisa", () => {
  const t = "linha um\nlinha dois\nlinha três muito longa aqui";
  const { texto, cortou } = cortarEmLinhas(t, 25);
  assert.equal(cortou, true);
  assert.ok(texto.length <= 25);
  assert.ok(!texto.endsWith("\n"));
  assert.equal(cortarEmLinhas("curto", 100).cortou, false);
});

const res = (nome, extra = {}) => ({ nome, fonte: nome, texto: "x", itens: 1, vazio: false, ...extra });

test("evidência: memória fica fora, vazio vai pra 'consultado sem resultado'", () => {
  const p = montarEvidencia([
    res("buscar_memoria", { texto: "m" }),
    res("ver_treinos", { texto: "treinou 3x" }),
    res("ver_refeicoes", { vazio: true, itens: 0, texto: "Nenhuma refeição registrada hoje." }),
  ]);
  assert.match(p.texto, /### TREINOS/);
  assert.doesNotMatch(p.texto, /### MEM/);
  assert.match(p.texto, /CONSULTADO SEM RESULTADO/);
  assert.match(p.texto, /Nenhuma refeição registrada hoje/);
  assert.match(p.texto, /Não invente/);
});

test("evidência: respeita o orçamento e avisa que cortou", () => {
  const grande = "linha de texto bem comprida\n".repeat(200);
  const p = montarEvidencia([res("ver_treinos", { texto: grande }), res("ver_refeicoes", { texto: grande })], { orcamento: 1000 });
  assert.ok(p.texto.length < 1700);
  assert.match(p.texto, /cortado por tamanho/);
  assert.ok(p.fontes.some((f) => f.cortou || f.omitida));
});

test("evidência: números de tela vêm só das ferramentas de nota", () => {
  const p = montarEvidencia([
    res("buscar_notas", { meta: { fortes: 3, total: 9, areas: ["trabalho"], resumos: [{ resumo: "a" }] }, ids: ["1", "2"] }),
    res("ver_treinos"),
  ]);
  assert.deepEqual(p.achado, { total: 9, fortes: 3, areas: ["trabalho"] });
  assert.deepEqual(p.ids, ["1", "2"]);
});

test("frase da camada 1: sensível não fala de nota; sem fonte não finge que achou", () => {
  const vazio = { fontes: [], achado: { fortes: 0 }, semResultado: [] };
  assert.equal(fraseDoPlano({ modo: "crise" }, vazio), "Tô aqui com você.");
  assert.equal(fraseDoPlano({ modo: "escuta" }, { fontes: [{ ferramenta: "buscar_notas", itens: 3 }], achado: { fortes: 3 } }), "Tô te ouvindo.");
  assert.equal(fraseDoPlano({ modo: "pensar_junto" }, vazio), "Já te respondo.");
  assert.equal(fraseDoPlano({ modo: "parceiro", ferramentas: [{ nome: "buscar_notas" }] }, { fontes: [{ ferramenta: "buscar_notas", itens: 0 }], achado: { fortes: 0 } }), "Já te respondo.");
  assert.match(fraseDoPlano({ modo: "resgate", ferramentas: [{ nome: "buscar_notas" }] }, { fontes: [{ ferramenta: "buscar_notas", itens: 0 }], achado: { fortes: 0 } }), /não achei/);
  assert.equal(fraseDoPlano({ modo: "tecnico" }, vazio), "Já te respondo.");
  const f = fraseDoPlano({ modo: "analise" }, { fontes: [{ ferramenta: "buscar_notas", itens: 2 }, { ferramenta: "ver_treinos", itens: 5 }], achado: { fortes: 2 } });
  assert.equal(f, "Peguei 2 notas suas sobre isso e seus treinos. Deixa eu ler.");
});

/* -------------------------------------------------------------------- memória */

test("memória: candidatos descartam segredo, duplicata, curto demais e limitam a 4", () => {
  const c = sanearCandidatos({ fatos: [
    { fato: "Mora em Recife", categoria: "pessoa", importancia: 4 },
    { fato: "mora em recife", categoria: "pessoa" },                 // duplicata
    { fato: "A senha do banco é 1234", categoria: "outro" },          // segredo
    { fato: "ok", categoria: "outro" },                               // curto
    { fato: "Prepara entrevista pra sexta", categoria: "inventada", importancia: 99, validade: "2099-01-01" },
    { fato: "Evita glúten" }, { fato: "Tem um cachorro chamado Rex" }, { fato: "Treina de manhã" },
  ] }, "2026-11-09");
  assert.equal(c.length, 4);
  assert.equal(c[1].categoria, "outro");     // categoria inválida
  assert.equal(c[1].importancia, 5);         // clampada
  assert.equal(c[1].validade, "2099-01-01");
  assert.deepEqual(sanearCandidatos(null), []);
});

test("memória: validade no passado é descartada", () => {
  assert.equal(sanearCandidatos({ fatos: [{ fato: "Viaja dia 3", validade: "2020-01-01" }] }, "2026-11-09")[0].validade, null);
});

const grupos = [
  { cand: { fato: "Mora em Olinda" }, vizinhas: [{ id: "A", fato: "Mora em Recife", fixado: false }, { id: "F", fato: "Casado", fixado: true }] },
  { cand: { fato: "Tem um cachorro" }, vizinhas: [] },
];

test("memória: UPDATE e DELETE nunca tocam em memória fixada", () => {
  const ops = sanearDecisoes({ ops: [
    { i: 1, op: "UPDATE", id: "F", fato: "Casado e mora em Olinda" },
    { i: 1, op: "DELETE", id: "F" },
  ] }, grupos);
  assert.ok(!ops.some((o) => o.id === "F"));
  assert.ok(ops.some((o) => o.op === "ADD" && o.i === 1)); // o fato não se perde
});

test("memória: contradição vira DELETE + ADD; id inventado é ignorado", () => {
  const ops = sanearDecisoes({ ops: [
    { i: 1, op: "DELETE", id: "A" }, { i: 1, op: "ADD" },
    { i: 2, op: "UPDATE", id: "ID_INVENTADO", fato: "qualquer coisa longa" },
  ] }, grupos);
  assert.ok(ops.some((o) => o.op === "DELETE" && o.id === "A"));
  assert.ok(ops.some((o) => o.op === "ADD" && o.i === 1));
  assert.ok(!ops.some((o) => o.op === "UPDATE")); // id nao esta nas vizinhas do candidato 2
  assert.ok(ops.some((o) => o.op === "ADD" && o.i === 2)); // sem decisao valida -> ADD, nao se perde
});

test("memória: saída torta do decisor vira ADD de tudo (perder fato real é pior)", () => {
  const ops = sanearDecisoes("lixo", grupos);
  assert.equal(ops.filter((o) => o.op === "ADD").length, 2);
});

test("memória: NOOP explícito respeita a decisão do modelo", () => {
  const ops = sanearDecisoes({ ops: [{ i: 1, op: "NOOP" }, { i: 2, op: "NOOP" }] }, grupos);
  assert.equal(ops.length, 0);
});

/* ------------------------------------------------------------------- resposta */

test("limparResposta: desembrulha JSON, tira travessão fora de código, preserva código", () => {
  assert.equal(limparResposta('{"mensagem":"oi tudo bem"}'), "oi tudo bem");
  assert.equal(limparResposta('{"mensagens":["a","b"]}'), "a\n\nb");
  assert.equal(limparResposta("fez isso — e aquilo"), "fez isso, e aquilo");
  const cod = "veja:\n```js\nconst a = 1 — 2;\n```\nfim — ok";
  const r = limparResposta(cod);
  assert.ok(r.includes("const a = 1 — 2;")); // dentro do codigo nao mexe
  assert.ok(r.includes("fim, ok"));
  assert.equal(limparResposta("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(limparResposta("{ isso nao e json }"), "{ isso nao e json }");
});

test("histórico: turnos velhos do cérebro encurtam, a fala da pessoa nunca", () => {
  const longo = "x".repeat(2000);
  const turnos = Array.from({ length: 10 }, (_, i) => ({ papel: i % 2 ? "cerebro" : "pessoa", texto: longo, ordem: i }));
  const h = historicoParaMensagens(turnos, { max: 16, recentes: 4 });
  assert.equal(h.length, 10);
  assert.equal(h[0].content.length, 2000);          // pessoa velha: intacta
  assert.ok(h[1].content.length < 1000);            // cerebro velho: encurtado
  assert.equal(h[9].content.length, 2000);          // recente: intacto
  assert.equal(h[0].role, "user");
  assert.deepEqual(historicoParaMensagens(null), []);
});

test("prompt do turno: papel e mensagem nas pontas; memória sem duplicata; crise sem panorama", () => {
  const plano = { modo: "escuta", pergunta: "tô mal", tamanho: "curta", modo_anterior: "tecnico", carga_anterior: 0 };
  const p = montarPromptTurno({
    agora: new Date("2026-11-09T02:40:00Z"),
    memoriasBase: [{ id: "1", fato: "Trabalha com dados" }],
    memoriasRelacionadas: [{ id: "1", fato: "Trabalha com dados" }, { id: "2", fato: "Prepara entrevista" }],
    panorama: { total: 100 }, evidencia: "=== EVIDENCIA ===", plano, texto: "tô mal",
  });
  assert.equal((p.match(/Trabalha com dados/g) || []).length, 1);
  assert.ok(p.indexOf("EVIDENCIA") < p.indexOf("COMO RESPONDER"));
  assert.ok(p.indexOf("COMO RESPONDER") < p.indexOf("MENSAGEM DA PESSOA"));
  assert.ok(p.trim().endsWith('"""'));
  assert.match(p, /Transição:/);                    // tecnico -> escuta
  assert.match(p, /23:40 \(noite\)/);              // 02:40Z = 23:40 no fuso -3
  const crise = montarPromptTurno({ plano: { modo: "crise" }, panorama: { total: 100 }, texto: "x" });
  assert.doesNotMatch(crise, /base de notas tem/);
  assert.equal(blocoDeMemorias([], []), "");
});

test("prompt do turno: pergunta reescrita aparece só quando difere da mensagem", () => {
  const igual = montarPromptTurno({ plano: { modo: "direto", pergunta: "oi" }, texto: "oi" });
  assert.doesNotMatch(igual, /autossuficientes/);
  const dif = montarPromptTurno({ plano: { modo: "direto", pergunta: "como foi meu treino ontem?" }, texto: "e ontem?" });
  assert.match(dif, /autossuficientes.*como foi meu treino ontem/);
});

/* --------------------------------------------------------------------- mcp */

test("mcp: token compara em tempo constante e rejeita vazio/diferente", async () => {
  const { tokenConfere } = await import("../servidor/mcp.mjs");
  assert.equal(tokenConfere("abc123", "abc123"), true);
  assert.equal(tokenConfere("abc124", "abc123"), false);
  assert.equal(tokenConfere("abc", "abc123"), false);
  assert.equal(tokenConfere("", "abc123"), false);
  assert.equal(tokenConfere("qualquer", ""), false, "sem token configurado nunca confere");
});

test("acesso: /mcp passa do PIN (tem token proprio), mas dados continuam protegidos", async () => {
  const { ehPublico } = await import("../../../src/acesso.js");
  assert.equal(ehPublico("/mcp"), true);
  assert.equal(ehPublico("/conversa/api/memorias"), false);
  assert.equal(ehPublico("/ideias"), false);
});

/* ------------------------------------------------------- naturalidade da fala */

test("perguntasSeguidas: conta falas do cérebro que terminam em pergunta, só as últimas em sequência", async () => {
  const { perguntasSeguidas, terminouEmPergunta, montarPromptTurno } = await import("../servidor/resposta.mjs");
  assert.equal(terminouEmPergunta("faz sentido pra você?"), true);
  assert.equal(terminouEmPergunta("faz sentido pra você? Tô aqui."), false);
  const c = (texto) => ({ papel: "cerebro", texto });
  const p = (texto) => ({ papel: "pessoa", texto });
  assert.equal(perguntasSeguidas([c("oi."), p("x"), c("e aí?"), p("y"), c("e agora?")]), 2);
  assert.equal(perguntasSeguidas([c("e aí?"), p("y"), c("fechado.")]), 0);
  assert.equal(perguntasSeguidas([]), 0);
  const plano = { modo: "parceiro", tamanho: "media", pergunta: "", modo_anterior: null };
  assert.match(montarPromptTurno({ plano, texto: "oi", perguntasSeguidas: 1 }), /NÃO termina com pergunta/);
  assert.doesNotMatch(montarPromptTurno({ plano, texto: "oi", perguntasSeguidas: 0 }), /NÃO termina com pergunta/);
  assert.doesNotMatch(montarPromptTurno({ plano: { ...plano, modo: "crise" }, texto: "x", perguntasSeguidas: 3 }), /NÃO termina com pergunta/);
});

test("alma: o bloco manda acompanhar o tom, mas escrever com ortografia correta", async () => {
  const { blocoDaAlma } = await import("../servidor/alma.mjs");
  const b = blocoDaAlma([{ traco: "escreve tudo minúsculo e sem acento", categoria: "ritmo", ativo: true }]);
  assert.match(b, /ortografia correta/);
  assert.match(b, /escreve tudo minúsculo/);
});

test("modos: papo não é mais 'curta' por padrão", async () => {
  const { MODOS, ORCAMENTO } = await import("../servidor/modos.mjs");
  assert.equal(MODOS.parceiro.tamanho, "media");
  assert.equal(MODOS.escuta.tamanho, "curta", "escuta fica perto do que a pessoa disse, sem ensaio");
  assert.match(ORCAMENTO.media.instrucao, /Três a cinco parágrafos/);
});

/* ----------------------------------------------------- feed e atalhos (seguir) */

test("extrairSeguir: tira as linhas [SEGUIR] do texto, limita a 3, deduplica e respeita o modo sensível", async () => {
  const { extrairSeguir } = await import("../servidor/resposta.mjs");
  const bruto = "Resposta com substância.\n\nMais um parágrafo.\n\n[SEGUIR: Me mostra o que anotei em outubro]\n[SEGUIR: me mostra o que anotei em outubro]\n[SEGUIR: Vira um plano de ação]\n[SEGUIR: Liga isso com o treino]\n[SEGUIR: Quarto atalho extra]";
  const r = extrairSeguir(bruto);
  assert.equal(r.seguir.length, 3);
  assert.equal(r.seguir[1], "Vira um plano de ação");
  assert.doesNotMatch(r.texto, /SEGUIR/);
  assert.match(r.texto, /Mais um parágrafo\.$/);
  const sens = extrairSeguir(bruto, { manter: false });
  assert.deepEqual(sens.seguir, []);
  assert.doesNotMatch(sens.texto, /SEGUIR/, "em modo sensível a tag some mesmo assim");
  assert.equal(extrairSeguir("sem atalhos").seguir.length, 0);
  assert.equal(extrairSeguir("no meio [SEGUIR: x y z w] da frase").texto, "no meio [SEGUIR: x y z w] da frase", "só vale em linha própria");
});

test("prompt do turno: pede atalhos só fora dos modos sensíveis", async () => {
  const { montarPromptTurno } = await import("../servidor/resposta.mjs");
  const base = { texto: "oi", perguntasSeguidas: 0 };
  assert.match(montarPromptTurno({ ...base, plano: { modo: "tecnico", tamanho: "longa" } }), /\[SEGUIR:/);
  assert.doesNotMatch(montarPromptTurno({ ...base, plano: { modo: "escuta", tamanho: "curta" } }), /\[SEGUIR:/);
  assert.doesNotMatch(montarPromptTurno({ ...base, plano: { modo: "crise", tamanho: "curta" } }), /\[SEGUIR:/);
});

test("sugestões: amostra do dia é estável por semente e muda no dia seguinte", async () => {
  const { amostraDoDia } = await import("../servidor/sugestoes.mjs");
  const l = Array.from({ length: 40 }, (_, i) => i);
  assert.deepEqual(amostraDoDia(l, 8, "2026-11-09"), amostraDoDia(l, 8, "2026-11-09"));
  assert.notDeepEqual(amostraDoDia(l, 8, "2026-11-09"), amostraDoDia(l, 8, "2026-11-10"));
  assert.equal(amostraDoDia(l, 8, "x").length, 8);
  assert.equal(new Set(amostraDoDia(l, 40, "x")).size, 40, "sem repetir item");
});

test("sugestões: sanearCartoes valida tipo, tamanho, duplicata e limita 2 por tipo", async () => {
  const { sanearCartoes } = await import("../servidor/sugestoes.mjs");
  const c = (tipo, titulo) => ({ tipo, titulo, gancho: "Há 3 semanas você anotou isso e parou.", abrir: "Quero retomar isso agora." });
  const r = sanearCartoes({ cartoes: [
    c("retomar", "Projeto A"), c("retomar", "Projeto B"), c("retomar", "Projeto C"),
    c("retomar", "Projeto A"), c("invalido", "Outro"), c("agora", "x"),
    { tipo: "lembrar", titulo: "Sem gancho", gancho: "", abrir: "abrir isso aqui" },
    c("conexao", "Duas notas — ligadas"),
  ] });
  assert.deepEqual(r.map((x) => x.titulo), ["Projeto A", "Projeto B", "Duas notas, ligadas"]);
  assert.deepEqual(sanearCartoes(null), []);
  assert.deepEqual(sanearCartoes({ cartoes: "x" }), []);
});

test("sugestões: digest etiqueta as notas e cartoesPorHeuristica nunca inventa", async () => {
  const { montarDigest, cartoesPorHeuristica } = await import("../servidor/sugestoes.mjs");
  const agora = new Date("2026-11-09T12:00:00Z");
  const nota = (id, resumo, criado) => ({ id, resumo, area: "trabalho", texto_original: resumo, criado_em: criado });
  const d = montarDigest({ agora, recentes: [nota("a", "Detalhei o MVP de telefonia", "2026-11-06T12:00:00Z")], antigas: [nota("b", "Ideia do jogo cooperativo", "2026-03-01T12:00:00Z")], eventos: [{ resumo: "Reunião com cliente", quando: "amanhã" }], tarefas: [{ prazo: "vencida", name: "Fundação NR01" }], memorias: [{ fato: "Treina em casa" }], conversas: ["Papo sobre archi2"] });
  assert.match(d.texto, /N1 · há 3 dias/);
  assert.match(d.texto, /N2 ·/);
  assert.equal(d.notas.get("N1").id, "a");
  assert.match(d.texto, /Fundação NR01/);
  const h = cartoesPorHeuristica({ eventos: [{ resumo: "Reunião com cliente", quando: "amanhã" }], tarefas: [{ prazo: "vencida", name: "Fundação NR01" }], recentes: [nota("a", "Detalhei o MVP de telefonia", "2026-11-06T12:00:00Z")] });
  assert.equal(h.length, 3);
  assert.ok(h.every((x) => x.titulo && x.gancho && x.abrir));
  assert.deepEqual(cartoesPorHeuristica({}), []);
});

test("decidirSeparacao: reranker que zera tudo cai no corte relativo em vez de devolver nada", () => {
  const cands = [
    { id: "1", sim: 0.82, pontos: 0.03, lex_rank: 1 },
    { id: "2", sim: 0.78, pontos: 0.025, lex_rank: 2 },
    { id: "3", sim: 0.2, pontos: 0.001 },
  ];
  const zerou = decidirSeparacao(cands, new Map([[1, 0], [2, 0], [3, 0]]));
  assert.equal(zerou.usouRerank, false);
  assert.ok(zerou.sep.fortes.length >= 1, "a nota forte da busca não pode sumir");
  const normal = decidirSeparacao(cands, new Map([[1, 3], [2, 1], [3, 0]]));
  assert.equal(normal.usouRerank, true);
  assert.deepEqual(normal.sep.fortes.map((n) => n.id), ["1"]);
});

test("cartaoDoRadar: prefere a descoberta que combina com uma nota e nao vaza o conteudo dela", async () => {
  const { cartaoDoRadar, comCartaoDoRadar } = await import("../servidor/sugestoes.mjs");
  const a = { titulo: "Gestor de ofícios digitais", porque_agora: "Cartórios passam a exigir assinatura digital em ofícios.", afinidade: null };
  const b = { titulo: "Compliance CBS em notas", porque_agora: "Prazo da CBS apertou para as contabilidades.", afinidade: { nota_id: "n1", data: "2026-10-12", resumo: "SEGREDO DA NOTA" } };
  const c = cartaoDoRadar([a, b]);
  assert.equal(c.tipo, "radar");
  assert.match(c.titulo, /CBS/);
  assert.match(c.gancho, /nota sua de 12\/10/);
  assert.ok(!JSON.stringify(c).includes("SEGREDO"));
  assert.equal(cartaoDoRadar([]), null);
  assert.equal(cartaoDoRadar([{ titulo: "x", porque_agora: "curto" }]), null);
  // nao estoura o maximo: o radar toma o lugar do ultimo
  const cinco = Array.from({ length: 5 }, (_, i) => ({ tipo: "retomar", titulo: "Cartao " + i, gancho: "gancho longo o bastante", abrir: "abrir aqui" }));
  const r = comCartaoDoRadar(cinco, [b]);
  assert.equal(r.length, 5);
  assert.equal(r[4].tipo, "radar");
  assert.deepEqual(comCartaoDoRadar(cinco, []), cinco);
});

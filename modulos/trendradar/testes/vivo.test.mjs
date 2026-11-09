/**
 * Testes do radar vivo. So o que e puro: nada aqui toca rede ou banco.
 * Rodar: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodificar, parseRss, dedupePorTitulo, contarJanelas, estadoDoPulso, momentumScore,
  pulsoDeLinhas, filtrarRelevantes, sanearDescobertas, assuntoParecido, radicaisDe, termosDoItem, pulsoDoItem,
} from "../servidor/vivo.mjs";
import { cronAutorizado } from "../servidor/coleta.mjs";
import { lerCsvTrends } from "../servidor/nucleo.mjs";
import { sanearHipoteses } from "../servidor/ia.mjs";
import { cartaoDoAlvo, montarCartoes, resumoDosCartoes, visivel, idPulso } from "../servidor/cartoes.mjs";

const AGORA = new Date("2026-11-09T12:00:00Z");
const dias = (n) => new Date(AGORA.getTime() - n * 86400000).toISOString();
const n = (titulo, d, fonte = "Portal A") => ({ titulo, fonte, url: "https://x/" + titulo.length, data: dias(d) });

test("RSS: lê título, fonte, data; tira o ' - Fonte' do título e decodifica entidades", () => {
  const xml = `<rss><channel><item><title>Reforma &amp; caixa: o que muda - Folha</title><link>https://n/1</link>
    <pubDate>Mon, 09 Nov 2026 07:35:51 GMT</pubDate><source url="https://folha">Folha</source></item>
    <item><title><![CDATA[Outra "matéria" - Valor]]></title><link>https://n/2</link><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate><source url="x">Valor</source></item>
    <item><title>Sem data</title><link>x</link></item></channel></rss>`;
  const r = parseRss(xml);
  assert.equal(r.length, 2, "item sem data é descartado");
  assert.equal(r[0].titulo, "Reforma & caixa: o que muda");
  assert.equal(r[0].fonte, "Folha");
  assert.equal(r[1].titulo, 'Outra "matéria"');
  assert.equal(decodificar("a&nbsp;&#233;<b>b</b>"), "a é b");
  assert.deepEqual(parseRss(""), []);
});

test("janelas: mesma matéria em vários portais conta uma vez; 7d x 7d anteriores; fora de 14d ignora", () => {
  const itens = [
    n("Pix Automático muda regra", 1, "A"), n("Pix automático muda regra", 2, "B"), n("Outra sobre Pix", 3),
    n("Pix antigo 1", 9), n("Pix antigo 2", 10), n("Pix antigo 3", 12), n("Pix velhíssimo", 30),
  ];
  const j = contarJanelas(itens, AGORA);
  assert.equal(j.sete, 2);
  assert.equal(j.anteriores, 3);
  assert.equal(j.manchetes.length, 2);
  assert.equal(dedupePorTitulo(itens).length, 6);
});

test("manchetes de exemplo: as mais pertinentes ao produto vêm antes das mais novas", () => {
  const itens = [n("Clínica-Escola abre vagas", 1), n("WhatsApp na clínica: IA agenda consultas", 4)];
  const j = contarJanelas(itens, AGORA, "automacao whatsapp clinica agendamento");
  assert.match(j.manchetes[0].titulo, /WhatsApp/);
});

test("estado do pulso: pouco dado nunca vira tendência", () => {
  assert.equal(estadoDoPulso({ sete: 2, anteriores: 1 }).estado, "sem_dado");
  assert.equal(estadoDoPulso({ sete: 2, anteriores: 1 }).variacaoPct, null);
  assert.equal(estadoDoPulso({ sete: 15, anteriores: 3 }).estado, "subindo");
  assert.equal(estadoDoPulso({ sete: 3, anteriores: 8 }).estado, "esfriando");
  assert.equal(estadoDoPulso({ sete: 10, anteriores: 9 }).estado, "estavel");
  assert.equal(estadoDoPulso({ sete: 6, anteriores: 0 }).variacaoPct, 100, "do zero não divide por zero");
  assert.equal(estadoDoPulso({ sete: 3, anteriores: 2 }).estado, "sem_dado", "de 2 para 3 matérias não é +50%, é ruído");
  assert.equal(estadoDoPulso({ sete: 4, anteriores: 0 }).estado, "sem_dado");
  const pequeno = estadoDoPulso({ sete: 5, anteriores: 3 });
  assert.deepEqual([pequeno.estado, pequeno.amostraPequena], ["subindo", true], "sobe, mas avisa que a amostra é pequena");
  assert.equal(estadoDoPulso({ sete: 15, anteriores: 3 }).amostraPequena, false);
});

test("momentum: sem dado é null, com dado fica sempre entre 0 e 100", () => {
  assert.equal(momentumScore({ variacaoPct: null, sete: 5 }), null);
  assert.ok(momentumScore({ variacaoPct: 900, sete: 99 }) <= 100);
  assert.ok(momentumScore({ variacaoPct: -900, sete: 0 }) >= 0);
  assert.ok(momentumScore({ variacaoPct: 300, sete: 20 }) > 50 && momentumScore({ variacaoPct: -90, sete: 1 }) < 50);
});

test("pulsoDeLinhas: usa a coleta mais recente, monta a série dia a dia e sem coleta devolve vazio honesto", () => {
  const linhas = [
    { dia: "2026-11-09", mencoes_7d: 12, mencoes_prev_7d: 4, manchetes: [{ titulo: "x" }] },
    { dia: "2026-11-08", mencoes_7d: 4, mencoes_prev_7d: 4, manchetes: [] },
  ];
  const r = pulsoDeLinhas(linhas);
  assert.equal(r.pulso.estado, "subindo");
  assert.equal(r.pulso.dia, "2026-11-09");
  assert.deepEqual(r.serie.map((h) => h.valor), [4, 12], "ordena por dia mesmo vindo desordenado");
  assert.ok(r.calor > 50);
  const vazio = pulsoDeLinhas([]);
  assert.deepEqual(vazio, { pulso: null, serie: [], calor: null });
});

test("relevância: 'gestão de eventos' não passa novela; plural e flexão casam pelo radical", () => {
  const itens = [n("Resumo da novela: dor, prazer e amor", 1), n("Gestão de eventos corporativos cresce", 1), n("Eventos corporativos voltam", 1)];
  const f = filtrarRelevantes(itens, "gestão de eventos corporativos");
  assert.deepEqual(f.map((x) => x.titulo), ["Gestão de eventos corporativos cresce", "Eventos corporativos voltam"]);
  assert.equal(filtrarRelevantes(itens, "de da do").length, 3, "sem termo significativo não filtra");
});

test("termos de imprensa: o alvo pesquisa pelo próprio termo, curto", () => {
  assert.deepEqual(termosDoItem({ termo: "NR-1 riscos psicossociais" }), ["NR-1 riscos psicossociais"]);
  assert.deepEqual(termosDoItem({ nome: "Algo" }), ["Algo"]);
});

test("pulsoDoItem: junta as buscas, filtra o ruído de cada uma e falha só se TODAS falharem", async () => {
  const item = { termo: "licitações PNCP" };
  const buscar = async () => [n("Licitações no PNCP crescem", 1), n("Futebol: rodada final", 1), n("Nova lei de licitações e fornecedores", 2)];
  const j = await pulsoDoItem(item, AGORA, buscar);
  assert.equal(j.sete, 2, "só o futebol é descartado pelo filtro (a outra casa pelo radical licit)");
  await assert.rejects(() => pulsoDoItem(item, AGORA, async () => { throw new Error("fora"); }), /não respondeu/);
});

test("descobertas: ancora em manchetes reais, exige 2 fontes, B2B, sem índice no texto e sem duplicata", () => {
  const m = [
    n("NR-1 muda e empresas correm", 1, "Valor"), n("AGU abre consulta sobre riscos psicossociais", 1, "Folha"),
    n("Instagram post sobre NR-1", 1, "Instagram"), n("INSS muda identidade", 1, "GMC"), n("INSS novo prazo RG", 2, "Serasa"),
    n("Pix automático vale em 2027", 1, "Mix"),
  ];
  const ok = { titulo: "Monitor de riscos psicossociais NR-1", frente: "regtech", termo: "NR-1 riscos psicossociais", quem_paga: "empresas com 50 a 500 funcionários",
    dor: "Não têm política de saúde mental.", porque_agora: "A AGU abriu consulta (manchete 2) e o prazo aperta — e as empresas correm.", indices: [1, 2, 3] };
  const bruto = { descobertas: [
    ok,
    { ...ok, termo: "inss identidade", titulo: "Plataforma de identidade do INSS", quem_paga: "beneficiários do INSS", indices: [4, 5], frente: "govtech" },
    { ...ok, termo: "pix automatico", titulo: "Integração de Pix automático", indices: [6], quem_paga: "lojas e SaaS com cobrança recorrente" },
    { ...ok, termo: "NR 1 riscos psicossociais" },
    { ...ok, termo: "algo com frente ruim", frente: "esportes" },
    { ...ok, termo: "nr1 indice fora", titulo: "Índice fora da lista aqui", indices: [99, 2] },
  ] };
  const r = sanearDescobertas(bruto, m, new Set());
  assert.equal(r.length, 1);
  const d = r[0];
  assert.equal(d.frente, "regtech");
  assert.equal(d.sinais.length, 2, "a fonte Instagram é descartada");
  assert.ok(d.sinais.every((s) => /^https:\/\/x\//.test(s.url) && s.data.length === 10), "link vem das manchetes, não do modelo");
  assert.doesNotMatch(d.porque_agora, /manchete 2|—/);
  assert.match(d.dor, /^Quem paga: empresas com 50 a 500/);
  assert.equal(sanearDescobertas(bruto, m, new Set(["nr 1 riscos psicossociais"])).length, 0, "assunto já conhecido não volta");
  assert.deepEqual(sanearDescobertas(null, m), []);
});

test("cron: só passa com o segredo exato; sem segredo configurado nunca passa", () => {
  assert.equal(cronAutorizado("Bearer abc123", "abc123"), true);
  assert.equal(cronAutorizado("Bearer abc124", "abc123"), false);
  assert.equal(cronAutorizado("Bearer abc", "abc123"), false);
  assert.equal(cronAutorizado("abc123", "abc123"), false, "sem 'Bearer' não vale");
  assert.equal(cronAutorizado("", "abc123"), false);
  assert.equal(cronAutorizado("Bearer qualquer", ""), false);
  assert.equal(cronAutorizado("Bearer qualquer", undefined), false);
});

test("CSV do Google Trends: lê nome e série, ignora cabeçalho e lixo, limita 0..100", () => {
  const { nome, serie } = lerCsvTrends("Semana,automação clínica: (Brasil)\n2026-05-01,31\n2026-06-01,<1\n2026-07-01,140\nlixo,abc\n", "");
  assert.equal(nome, "automação clínica");
  assert.deepEqual(serie.map((p) => p.valor), [31, 1, 100]);
  assert.equal(lerCsvTrends("2026-05,10\n2026-06,20", "Meu termo").nome, "Meu termo");
  assert.equal(lerCsvTrends("", "").serie.length, 0);
});

test("hipóteses da IA: só aproveita resposta completa, limpa travessão e frente inválida vira null", () => {
  assert.equal(sanearHipoteses(null), null);
  assert.equal(sanearHipoteses({ nome: "curto" }), null);
  const h = sanearHipoteses({
    nome: "Painel de conformidade NR-1 para indústrias", frente: "esportes", quemPaga: "indústrias com mais de 100 funcionários",
    dores: ["Não sabem mapear risco psicossocial — e temem multa", "x"], concorrentesProvaveis: ["Planilhas"], testeRapido: "Ligar para 5 gestores de RH.", validar: ["Disposição a pagar"],
  });
  assert.equal(h.frente, null, "frente fora da lista não é aceita");
  assert.equal(h.dores.length, 1, "dor curtinha demais é descartada");
  assert.doesNotMatch(h.dores[0], /—/);
});

test("cartão: só carrega o que foi medido ou citado, e sem coleta o pulso é null", () => {
  const row = { id: "u1", chave: "nr 1 riscos", status: "nova", origem: "radar", titulo: "NR-1", frente: "regtech", termo: "NR-1 riscos",
    porque_agora: "AGU abriu consulta.", sinais: [{ titulo: "t", fonte: "f", url: "https://x", data: "2026-11-08" }],
    criado_em: new Date(AGORA.getTime() - 3600000).toISOString(), serie: null, regioes: null, dossie: null };
  const sem = cartaoDoAlvo(row, [], AGORA.getTime());
  assert.equal(sem.pulso, null);
  assert.equal(sem.novo, true);
  assert.equal(sem.trends, null);
  assert.equal(sem.curva, null, "sem série real não existe curva");
  assert.equal(sem.regioes, null);
  const com = cartaoDoAlvo(row, [{ dia: "2026-11-09", mencoes_7d: 9, mencoes_prev_7d: 3, manchetes: [] }], AGORA.getTime());
  assert.equal(com.pulso.estado, "subindo");
  const csv = cartaoDoAlvo({ ...row, origem: "csv", status: "investigada", serie: [{ data: "1", valor: 10 }, { data: "2", valor: 20 }, { data: "3", valor: 30 }, { data: "4", valor: 40 }] }, [], AGORA.getTime());
  assert.ok(csv.curva && csv.curva.classificacaoCurva, "a curva só nasce de série real (CSV/SerpApi)");
});

test("visibilidade: descartada some; nova parada há 3 semanas sai da frente; salva e pesquisa ficam", () => {
  const velho = new Date(AGORA.getTime() - 30 * 86400000).toISOString();
  const novo = new Date(AGORA.getTime() - 86400000).toISOString();
  assert.equal(visivel({ status: "descartada", criado_em: novo }, AGORA.getTime()), false);
  assert.equal(visivel({ status: "nova", origem: "radar", criado_em: velho }, AGORA.getTime()), false);
  assert.equal(visivel({ status: "nova", origem: "radar", criado_em: novo }, AGORA.getTime()), true);
  assert.equal(visivel({ status: "salva", origem: "radar", criado_em: velho }, AGORA.getTime()), true);
  assert.equal(visivel({ status: "investigada", origem: "pesquisa", criado_em: velho }, AGORA.getTime()), true);
});

test("montarCartoes: pega o pulso pela chave, ordena do mais novo e resume sem inventar", () => {
  const mk = (id, chave, criado, extra = {}) => ({ id, chave, status: "nova", origem: "radar", titulo: id, frente: "fintech", termo: chave, criado_em: criado, sinais: [], ...extra });
  const rows = [mk("a", "aa", dias(5)), mk("b", "bb", dias(1)), mk("c", "cc", dias(2), { status: "descartada" })];
  const pulsos = new Map([[idPulso("aa"), [{ dia: "2026-11-09", mencoes_7d: 10, mencoes_prev_7d: 2, manchetes: [] }]]]);
  const cards = montarCartoes(rows, pulsos, AGORA.getTime());
  assert.deepEqual(cards.map((c) => c.id), ["b", "a"]);
  assert.equal(cards[1].pulso.estado, "subindo");
  assert.equal(cards[0].pulso, null);
  const r = resumoDosCartoes(cards);
  assert.deepEqual([r.total, r.subindo, r.comMedicao, r.novos], [2, 1, 1, 1]);
});

test("acesso: o cron do radar passa do PIN (tem segredo próprio), o resto do radar não", async () => {
  const { ehPublico } = await import("../../../src/acesso.js");
  assert.equal(ehPublico("/trendradar/api/cron/coletar"), true);
  assert.equal(ehPublico("/trendradar/api/hoje"), false);
  assert.equal(ehPublico("/trendradar/api/oportunidades"), false);
});

test("assuntoParecido: mesmo assunto com outras palavras repete, assunto vizinho nao", () => {
  const velho = radicaisDe("compliance CBS notas fiscais");
  assert.ok(assuntoParecido(radicaisDe("Solução de compliance para CBS em notas fiscais eletrônicas"), velho));
  assert.ok(!assuntoParecido(radicaisDe("Monitor de riscos psicossociais NR-1"), velho));
  assert.ok(!assuntoParecido(radicaisDe("compliance trabalhista"), velho), "so 1 palavra em comum nao basta");
  assert.ok(!assuntoParecido([], velho));
});

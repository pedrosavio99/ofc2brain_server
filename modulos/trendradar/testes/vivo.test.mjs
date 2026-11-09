/**
 * Testes do radar vivo. So o que e puro: nada aqui toca rede ou banco.
 * Rodar: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodificar, parseRss, dedupePorTitulo, contarJanelas, estadoDoPulso, momentumScore,
  pontuacaoViva, enriquecerComPulso, filtrarRelevantes, sanearDescobertas, assuntoParecido, radicaisDe, termosDoItem, pulsoDoItem,
} from "../servidor/vivo.mjs";
import { cronAutorizado } from "../servidor/coleta.mjs";
import { evidenciasDaImprensa } from "../servidor/nucleo.mjs";

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
  assert.equal(estadoDoPulso({ sete: 4, anteriores: 0 }).variacaoPct, 100, "do zero não divide por zero");
});

test("pontuação viva: sem pulso fica a tese; com pulso sobe ou desce, sempre 0..100", () => {
  assert.equal(pontuacaoViva(80, null), 80);
  assert.equal(pontuacaoViva(80, { variacaoPct: null, sete: 1 }), 80, "sem dado, sem ajuste");
  const sobe = pontuacaoViva(60, { variacaoPct: 300, sete: 20 });
  const desce = pontuacaoViva(60, { variacaoPct: -90, sete: 1 });
  assert.ok(sobe > 60 && desce < 60, `sobe=${sobe} desce=${desce}`);
  assert.ok(pontuacaoViva(100, { variacaoPct: 900, sete: 99 }) <= 100);
  assert.ok(pontuacaoViva(0, { variacaoPct: -900, sete: 0 }) >= 0);
  assert.equal(momentumScore({ variacaoPct: null, sete: 5 }), null);
});

test("enriquecer: usa a coleta mais recente, monta histórico real e não muta o item", () => {
  const item = { id: "a", pontuacao: 70 };
  const porItem = new Map([["a", [
    { item_id: "a", dia: "2026-11-08", mencoes_7d: 4, mencoes_prev_7d: 4, manchetes: [] },
    { item_id: "a", dia: "2026-11-09", mencoes_7d: 12, mencoes_prev_7d: 4, manchetes: [{ titulo: "x" }] },
  ]]]);
  const [r, sem] = enriquecerComPulso([item, { id: "b", pontuacao: 50 }], porItem);
  assert.equal(r.pulso.estado, "subindo");
  assert.equal(r.pulso.dia, "2026-11-09");
  assert.deepEqual(r.historicoPulso.map((h) => h.valor), [4, 12]);
  assert.ok(r.pontuacaoViva > 70);
  assert.equal(sem.pulso, null);
  assert.equal(sem.pontuacaoViva, 50);
  assert.equal(item.pulso, undefined);
});

test("relevância: 'gestão de eventos' não passa novela; plural e flexão casam pelo radical", () => {
  const itens = [n("Resumo da novela: dor, prazer e amor", 1), n("Gestão de eventos corporativos cresce", 1), n("Eventos corporativos voltam", 1)];
  const f = filtrarRelevantes(itens, "gestão de eventos corporativos");
  assert.deepEqual(f.map((x) => x.titulo), ["Gestão de eventos corporativos cresce", "Eventos corporativos voltam"]);
  assert.equal(filtrarRelevantes(itens, "de da do").length, 3, "sem termo significativo não filtra");
});

test("termos de imprensa: a semente usa buscas curtas, o item pesquisado usa o próprio termo", () => {
  assert.equal(termosDoItem({ id: "tr-copiloto-licitacoes-pncp" }).length, 2);
  assert.deepEqual(termosDoItem({ id: "tr-pesq-x", termoBusca: "prospeccao de clientes" }), ["prospeccao de clientes"]);
});

test("pulsoDoItem: junta as buscas, filtra o ruído de cada uma e falha só se TODAS falharem", async () => {
  const item = { id: "tr-copiloto-licitacoes-pncp", termoBusca: "x", nome: "Licitações" };
  const buscar = async (t) => (t === "licitações PNCP"
    ? [n("Licitações no PNCP crescem", 1), n("Futebol: rodada final", 1)]
    : [n("Nova lei de licitações e fornecedores", 2)]);
  const j = await pulsoDoItem(item, AGORA, buscar);
  assert.equal(j.sete, 2, "o item de futebol é descartado pelo filtro");
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

test("evidências de investigação: só o que tem fonte, e dizem quando não há nada", () => {
  assert.match(evidenciasDaImprensa(null)[0], /não respondeu/);
  assert.match(evidenciasDaImprensa({ sete: 0, anteriores: 0, manchetes: [] })[0], /Nenhuma matéria/);
  const e = evidenciasDaImprensa({ sete: 5, anteriores: 2, manchetes: [{ titulo: "Algo", fonte: "Valor", data: "2026-11-08" }] });
  assert.match(e[0], /5 matéria\(s\).*2/);
  assert.match(e[1], /"Algo" \(Valor, 2026-11-08\)/);
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

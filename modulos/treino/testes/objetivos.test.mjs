/* Metas do treino: validacao, progresso, prompt e ficha sem IA.
   So funcoes puras: nada aqui toca banco nem rede. */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizarObjetivo, progressoDoObjetivo, montarObjetivos, blocoObjetivos,
  blocoObjetivoFoco, pedidoDaMeta, MAX_ATIVOS, SERIES_ALVO_POR_GRUPO } from "../servidor/objetivos.mjs";
import { somarGrupos, seriesPorGrupo } from "../servidor/grupos.mjs";
import { promptDaFicha, sistemaDaFicha, normalizarFicha } from "../servidor/ficha.mjs";
import { fichaPorRegras } from "../servidor/ficha-regras.mjs";

/* ------------------------------------------------------------ validacao */

test("corrida: titulo padrao, unidade km e partida opcional", () => {
  const r = normalizarObjetivo({ tipo: "corrida", meta_valor: "10", valor_inicial: "3,5" });
  assert.equal(r.ok, true);
  assert.equal(r.valor.titulo, "Correr 10 km");
  assert.equal(r.valor.unidade, "km");
  assert.equal(r.valor.meta_valor, 10);
  assert.equal(r.valor.valor_inicial, 3.5);
});

test("corrida: sem distancia ou com partida acima da meta e recusada", () => {
  assert.equal(normalizarObjetivo({ tipo: "corrida" }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5, valor_inicial: 5 }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5, valor_inicial: 8 }).ok, false);
  // altura em metros no lugar de km nao e o caso, mas 5000 km tambem nao
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5000 }).ok, false);
});

test("musculo: filtra grupo invalido, limita a 3 e exige pelo menos 1", () => {
  const r = normalizarObjetivo({ tipo: "musculo", grupos: ["ombro", "peito", "peito", "cardio", "voador", "biceps", "costas"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor.grupos, ["ombro", "peito", "biceps"]);
  assert.equal(r.valor.titulo, "Ganhar ombro, peito e biceps");
  assert.equal(r.valor.meta_valor, null);
  assert.equal(normalizarObjetivo({ tipo: "musculo", grupos: ["cardio"] }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "musculo" }).ok, false);
});

test("outra meta: precisa de nome; alvo precisa de unidade", () => {
  assert.equal(normalizarObjetivo({ tipo: "outro" }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "outro", titulo: "Ombro de 120 cm", meta_valor: 120 }).ok, false);
  const ok = normalizarObjetivo({ tipo: "outro", titulo: "Ombro de 120 cm", meta_valor: 120, unidade: "cm", valor_inicial: 112 });
  assert.equal(ok.ok, true);
  assert.equal(ok.valor.unidade, "cm");
  // sem alvo, a unidade e a partida sao descartadas
  const livre = normalizarObjetivo({ tipo: "outro", titulo: "Mais disposicao", unidade: "x", valor_inicial: 4 });
  assert.equal(livre.valor.meta_valor, null);
  assert.equal(livre.valor.unidade, "");
  assert.equal(livre.valor.valor_inicial, null);
});

test("tipo invalido e prazo invalido sao recusados; prazo valido passa", () => {
  assert.equal(normalizarObjetivo({ tipo: "x" }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5, prazo: "amanha" }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5, prazo: "2026-13-45" }).ok, false);
  assert.equal(normalizarObjetivo({ tipo: "corrida", meta_valor: 5, prazo: "2027-03-01" }).valor.prazo, "2027-03-01");
});

test("edicao mantem o que nao veio", () => {
  const atual = { tipo: "corrida", titulo: "Correr 10 km", meta_valor: 10, valor_inicial: 3, unidade: "km", prazo: null };
  const r = normalizarObjetivo({ meta_valor: 12 }, atual);
  assert.equal(r.ok, true);
  assert.equal(r.valor.meta_valor, 12);
  assert.equal(r.valor.valor_inicial, 3);
  assert.equal(r.valor.titulo, "Correr 10 km");
});

/* ------------------------------------------------------------- progresso */

const marco = (valor, dia) => ({ valor, criado_em: `2026-11-${dia}T10:00:00Z` });

test("corrida: progresso vem so dos marcos digitados", () => {
  const o = { tipo: "corrida", meta_valor: 10, valor_inicial: 2, unidade: "km" };
  const p = progressoDoObjetivo(o, [marco(4, "10"), marco(6, "17")]);
  assert.equal(p.tipo, "medida");
  assert.equal(p.atual, 6);
  assert.equal(p.pct, 50); // (6-2)/(10-2)
  assert.equal(p.atingido, false);
  assert.equal(p.marcos.length, 2);
});

test("corrida: sem nenhum marco nao inventa numero", () => {
  const p = progressoDoObjetivo({ tipo: "corrida", meta_valor: 10, valor_inicial: null, unidade: "km" }, []);
  assert.equal(p.sem_marco, true);
  assert.equal(p.atual, null);
  assert.equal(p.pct, 0);
});

test("corrida: partida declarada serve de ponto atual ate o primeiro marco", () => {
  const p = progressoDoObjetivo({ tipo: "corrida", meta_valor: 10, valor_inicial: 3, unidade: "km" }, []);
  assert.equal(p.atual, 3);
  assert.equal(p.sem_marco, false);
});

test("meta batida fecha em 100% e ordem dos marcos nao importa", () => {
  const o = { tipo: "corrida", meta_valor: 10, valor_inicial: 2, unidade: "km" };
  const p = progressoDoObjetivo(o, [marco(10.5, "20"), marco(4, "10")]);
  assert.equal(p.atual, 10.5);
  assert.equal(p.atingido, true);
  assert.equal(p.pct, 100);
});

test("alvo que desce (pressao, tempo de prova) mede na direcao certa", () => {
  const o = { tipo: "outro", meta_valor: 50, valor_inicial: 60, unidade: "min" };
  const p = progressoDoObjetivo(o, [marco(55, "10")]);
  assert.equal(p.pct, 50);
  assert.equal(p.atingido, false);
  assert.equal(progressoDoObjetivo(o, [marco(49, "11")]).atingido, true);
});

test("musculo: soma so os grupos da meta e compara com o ciclo anterior", () => {
  const o = { tipo: "musculo", grupos: ["ombro", "peito"] };
  const p = progressoDoObjetivo(o, [], {
    seriesCiclo: { ombro: 12, peito: 8, perna: 30 },
    cicloAnterior: { grupos: { ombro: 6, peito: 4, costas: 20 } },
  });
  assert.equal(p.tipo, "volume");
  assert.equal(p.series, 20);
  assert.equal(p.alvo, SERIES_ALVO_POR_GRUPO * 2);
  assert.equal(p.anterior, 10);
  assert.equal(p.pct, 50);
  assert.deepEqual(p.por_grupo, { ombro: 12, peito: 8 });
});

test("musculo: ciclo antigo sem o dado gravado fica null, nao zero", () => {
  const o = { tipo: "musculo", grupos: ["ombro"] };
  assert.equal(progressoDoObjetivo(o, [], { seriesCiclo: { ombro: 3 }, cicloAnterior: { grupos: {} } }).anterior, null);
  assert.equal(progressoDoObjetivo(o, [], { seriesCiclo: { ombro: 3 }, cicloAnterior: null }).anterior, null);
});

test("meta livre nao tem barra", () => {
  assert.equal(progressoDoObjetivo({ tipo: "outro", meta_valor: null }, []).tipo, "livre");
});

test("prazo conta os dias", () => {
  const p = progressoDoObjetivo({ tipo: "outro", meta_valor: null, prazo: "2026-12-01" }, [], { hoje: "2026-11-23" });
  assert.equal(p.prazo_dias, 8);
});

test("montarObjetivos entrega a cada meta so os marcos dela", () => {
  const lista = montarObjetivos({
    objetivos: [
      { id: "a", tipo: "corrida", meta_valor: 10, valor_inicial: 1, unidade: "km" },
      { id: "b", tipo: "corrida", meta_valor: 5, valor_inicial: 1, unidade: "km" },
    ],
    marcos: [{ objetivo_id: "a", valor: 5, criado_em: "2026-11-01T00:00:00Z" }, { objetivo_id: "b", valor: 2, criado_em: "2026-11-01T00:00:00Z" }],
  });
  assert.equal(lista[0].progresso.atual, 5);
  assert.equal(lista[1].progresso.atual, 2);
});

/* ---------------------------------------------------------------- grupos */

test("somarGrupos junta ciclo gravado com sessoes novas e ignora lixo", () => {
  assert.deepEqual(somarGrupos({ ombro: 4, peito: 2.5 }, { ombro: 3, perna: 0, costas: "x" }), { ombro: 7, peito: 2.5 });
  assert.deepEqual(somarGrupos(null, undefined), {});
});

test("seriesPorGrupo continua igual: principal inteira, secundario metade", () => {
  const conta = seriesPorGrupo([{
    concluida: 1, origem: "ficha", feitos: ["e1"],
    ficha: [{ id: "e1", series: 4, grupos: ["peito", "triceps"], grupos_fonte: "exercicio" }],
  }]);
  assert.equal(conta.peito, 4);
  assert.equal(conta.triceps, 2);
});

/* ------------------------------------------------------------ prompt IA */

const meta10k = { titulo: "Correr 10 km", tipo: "corrida", meta_valor: 10, grupos: [],
  progresso: { tipo: "medida", atual: 4, meta: 10, unidade: "km", prazo_dias: null } };
const metaOmbro = { titulo: "Ganhar ombro", tipo: "musculo", grupos: ["ombro"],
  progresso: { tipo: "volume", series: 6, alvo: 20, anterior: 3, prazo_dias: null } };

test("texto das metas cita os numeros reais e a referencia", () => {
  const t = blocoObjetivos([meta10k, metaOmbro]);
  assert.match(t, /Correr 10 km/);
  assert.match(t, /hoje 4 km, alvo 10 km/);
  assert.match(t, /6 series nesses grupos neste ciclo \(referencia 20\)/);
  assert.match(t, /no ciclo anterior foram 3/);
  assert.equal(blocoObjetivos([]), "");
  assert.match(blocoObjetivoFoco(meta10k), /^META EM FOCO/);
  assert.equal(blocoObjetivoFoco(null), "");
});

test("meta sem medida registrada diz que nao ha medida", () => {
  const t = blocoObjetivos([{ ...meta10k, progresso: { tipo: "medida", atual: null, meta: 10, unidade: "km" } }]);
  assert.match(t, /sem medida registrada ainda/);
});

test("ficha do dia ve as metas; ficha da meta ve so a meta em foco", () => {
  const base = { perfil: {}, equipamentos: [], sessoes: [], local: "ar_livre" };
  const dia = promptDaFicha({ ...base, objetivos: [meta10k, metaOmbro] });
  assert.match(dia, /Metas dele/);
  assert.match(dia, /Correr 10 km/);
  assert.match(dia, /Ganhar ombro/);

  const foco = promptDaFicha({ ...base, modo: "extra", objetivos: [meta10k, metaOmbro], objetivo: metaOmbro, pedido: "x" });
  assert.match(foco, /META EM FOCO/);
  assert.match(foco, /Ganhar ombro/);
  assert.doesNotMatch(foco, /Correr 10 km/);

  assert.doesNotMatch(promptDaFicha(base), /Metas dele/);
});

test("regras da meta so entram na ficha extra de meta; nunca prometem prazo", () => {
  assert.doesNotMatch(sistemaDaFicha("casa", "dia", true), /FICHA PARA A META/);
  assert.doesNotMatch(sistemaDaFicha("casa", "extra", false), /FICHA PARA A META/);
  const com = sistemaDaFicha("casa", "extra", true);
  assert.match(com, /FICHA PARA A META/);
  assert.match(com, /NAO prometa prazo/);
  // a ficha extra deixou de dizer que ele ja treinou: ele pode nem ter comecado
  assert.doesNotMatch(sistemaDaFicha("casa", "extra"), /JA treinou hoje e quer mais/);
});

test("bloco de corrida do modelo passa pela normalizacao como tempo", () => {
  const r = normalizarFicha({ ficha: [{ nome: "Trote leve", tipo: "esteira", grupos: ["cardio"],
    series: 4, medida: "tempo", duracao_min: 5, reps: "5 min", equipamento: "rua" }] }, [], "ar_livre");
  assert.equal(r.ficha.length, 1);
  assert.equal(r.ficha[0].medida, "tempo");
  assert.equal(r.ficha[0].duracao_min, 5);
});

/* ----------------------------------------------------- ficha sem IA (regras) */

const HOJE = new Date("2026-11-23T15:00:00Z");

test("sem IA, meta de corrida ao ar livre abre com o bloco de corrida", () => {
  const f = fichaPorRegras({ local: "ar_livre", modo: "extra", objetivo: meta10k, hoje: HOJE });
  assert.equal(f.ficha[0].nome, "Trote e caminhada intervalados");
  assert.match(f.motivo, /Correr 10 km/);
  assert.ok(f.ficha.length >= 2, "completa com apoio de perna ou core");
});

test("sem IA, corrida em casa sem esteira nao inventa aparelho e avisa", () => {
  const halter = { id: "h1", nome: "Halteres", tipo: "peso_livre", grupos: ["biceps"] };
  const f = fichaPorRegras({ local: "casa", equipamentos: [halter], modo: "extra", objetivo: meta10k, hoje: HOJE });
  assert.ok(!f.ficha.some((i) => i.nome === "Trote e caminhada intervalados"));
  assert.match(f.motivo, /sem esteira/);
  assert.match(f.motivo, /Ao ar livre/);
});

test("sem IA, corrida em casa com esteira usa o aparelho cadastrado", () => {
  const esteira = { id: "e1", nome: "Esteira", tipo: "esteira", grupos: ["cardio"] };
  const f = fichaPorRegras({ local: "casa", equipamentos: [esteira], modo: "extra", objetivo: meta10k, hoje: HOJE });
  assert.equal(f.ficha[0].equipamento_id, "e1");
});

test("sem IA, meta de musculo poe os grupos da meta na frente e fecha com 5 itens", () => {
  const f = fichaPorRegras({ local: "academia", modo: "extra", objetivo: metaOmbro, hoje: HOJE });
  assert.equal(f.ficha.length, 5);
  assert.equal(f.ficha[0].grupos[0], "ombro");
  assert.match(f.motivo, /Ganhar ombro/);
});

test("sem meta nada muda: extra continua com 3 itens", () => {
  const f = fichaPorRegras({ local: "academia", modo: "extra", hoje: HOJE });
  assert.equal(f.ficha.length, 3);
});

test("pedido gerado a partir da meta", () => {
  assert.match(pedidoDaMeta(metaOmbro), /ombro/);
  assert.match(pedidoDaMeta(meta10k), /10 km/);
  assert.equal(pedidoDaMeta(null), "");
});

test("limite de metas abertas", () => {
  assert.equal(MAX_ATIVOS, 3);
});

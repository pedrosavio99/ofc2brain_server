/**
 * Rotas do modulo REFEICAO, sob /refeicao/api.
 *
 * Mesmo formato do modulo treino: uma funcao rotear() que o index.js pluga,
 * devolvendo objeto (vira 200) ou lancando ErroHttp.
 *
 * O caminho da tela tem dois passos, e so o ultimo grava:
 *   POST /analisar    texto livre -> refeicoes separadas (IA fraca, ou regra se
 *                     ela cair) e medidas (IA forte), numa chamada so.
 *   POST /refeicoes   grava. O servidor RECALCULA tudo aqui: nunca confia no
 *                     total que veio da tela, so em gramas e valores por 100 g.
 * /separar e /medir continuam separados: o /medir serve o "tentar de novo".
 */
import { ErroHttp, checarBanco, hojeLocal, horaLocal, dataValida, diasAtras,
  salvarRefeicoes, listarDoDia, listarPeriodo, buscarRefeicao,
  atualizarRefeicao, removerRefeicao,
  JANELA_DIAS, listarCiclos, fecharCiclosVencidos } from "./banco.mjs";
import { agruparEmCiclos } from "./ciclos.mjs";
import { TIPOS, montarRefeicao, somar } from "./nutricao.mjs";
import { separarRefeicoes, MAX_TEXTO } from "./separar.mjs";
import { medirRefeicao } from "./medir.mjs";
import { groqConfigurado } from "./ia/groq.mjs";
import { geminiConfigurado } from "./ia/gemini.mjs";
import { explicarFalha } from "./ia/json.mjs";

const MAX_REFEICOES = 8;

/* Mede em paralelo. Cada refeicao volta com itens OU com o motivo da falha:
   "nao consegui" sem motivo nao deixa ninguem consertar nada. */
async function medirTodas(lista, hora) {
  const resultados = await Promise.allSettled(lista.map((r) => medirRefeicao(r, hora)));
  return resultados.map((res, i) => {
    if (res.status === "fulfilled") {
      const { meta, ...refeicao } = res.value;
      return { ...refeicao, erro: "" };
    }
    const motivo = explicarFalha(res.reason, "Gemini", "GEMINI_MODEL", "GEMINI_API_KEY");
    console.error("[refeicao] medir falhou: " + ((res.reason && res.reason.message) || res.reason));
    return {
      tipo: lista[i].tipo, texto: String(lista[i].texto).trim(), itens: [], totais: somar([]),
      erro: motivo,
    };
  });
}

function exigir(condicao, status, mensagem, dica = "") {
  if (!condicao) throw new ErroHttp(status, mensagem, dica);
}

function corpo(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

/* Data opcional: sem ela, hoje. Futuro nao entra: refeicao de amanha e
   digitacao errada, e estragaria o total do dia seguinte sem ninguem ver. */
function dataDoPedido(valor) {
  if (valor === undefined || valor === null || valor === "") return hojeLocal();
  const d = dataValida(valor);
  exigir(d, 400, "Data invalida.", "Use o formato AAAA-MM-DD.");
  exigir(d <= hojeLocal(), 400, "Nao da pra registrar refeicao no futuro.");
  /* Janela de 14 dias: dia mais velho que ela ja foi (ou vai ser) podado e
     virou resumo em refeicao_ciclos. Gravar la seria gravar no vazio. */
  exigir(d >= diasAtras(JANELA_DIAS - 1), 400,
    `Fora da janela de ${JANELA_DIAS} dias: esse dia ja virou resumo de ciclo.`,
    "Veja os ciclos em /refeicao/api/ciclos.");
  return d;
}

function diaMenos(data, n) {
  const t = new Date(data + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

function totaisDoDia(lista) {
  return somar(lista.map((r) => r.totais || {}));
}

export async function rotear(req, res, rota, url) {
  const metodo = req.method;

  /* GET /health
     Diz o estado de cada peca separada: sem Gemini a medicao nao roda, mas a
     separacao e o historico continuam. A tela usa isso pra avisar a peca certa. */
  if (metodo === "GET" && rota === "/health") {
    const banco = await checarBanco();
    const ia = { fraca: groqConfigurado(), forte: geminiConfigurado() };
    return {
      status: banco.ok && ia.forte ? "ok" : "degradado",
      modulo: "refeicao",
      hoje: hojeLocal(),
      banco,
      ia,
    };
  }

  /* GET /tipos: a lista de tipos vem daqui, nao duplicada no front. */
  if (metodo === "GET" && rota === "/tipos") {
    return {
      tipos: Object.entries(TIPOS)
        .sort((a, b) => a[1].ordem - b[1].ordem)
        .map(([id, t]) => ({ id, rotulo: t.rotulo })),
    };
  }

  /* POST /separar { texto } -> { refeicoes:[{tipo, texto}], fonte, erro }
     fonte "regra" = a IA fraca nao respondeu e a separacao foi pelas palavras. */
  if (metodo === "POST" && rota === "/separar") {
    const texto = String(corpo(req).texto || "").trim();
    exigir(texto, 400, "Escreva o que voce comeu.");
    exigir(texto.length <= MAX_TEXTO, 400, `Texto longo demais (maximo ${MAX_TEXTO} caracteres).`,
      "Separe em mais de um envio.");
    const r = await separarRefeicoes(texto, horaLocal());
    return { refeicoes: r.refeicoes, fonte: r.fonte, erro: r.erro };
  }

  /* POST /medir { refeicoes:[{tipo, texto}] }
     Uma chamada forte por refeicao, em paralelo. Resposta sempre 200 com o
     resultado de CADA uma: as que falharam voltam com erro e sem itens, e a
     tela oferece tentar de novo so elas. */
  if (metodo === "POST" && rota === "/medir") {
    exigir(geminiConfigurado(), 503, "A IA de medicao nao esta configurada.",
      "Coloque GEMINI_API_KEY no .env e reinicie o servidor.");
    const lista = Array.isArray(corpo(req).refeicoes) ? corpo(req).refeicoes : [];
    const validas = lista.filter((r) => r && String(r.texto || "").trim());
    exigir(validas.length, 400, "Nenhuma refeicao com texto pra medir.");
    exigir(validas.length <= MAX_REFEICOES, 400, `No maximo ${MAX_REFEICOES} refeicoes por vez.`);

    return { refeicoes: await medirTodas(validas, horaLocal()) };
  }

  /* POST /analisar { texto } -> separa E mede numa chamada so.
     E o caminho da tela: voce escreve, clica uma vez e ja ve as calorias pra
     aceitar ou editar. A IA fraca que falha nao para nada: a regra separa. */
  if (metodo === "POST" && rota === "/analisar") {
    exigir(geminiConfigurado(), 503, "A IA de medicao nao esta configurada.",
      "Coloque GEMINI_API_KEY no .env e reinicie o servidor.");
    const texto = String(corpo(req).texto || "").trim();
    exigir(texto, 400, "Escreva o que voce comeu.");
    exigir(texto.length <= MAX_TEXTO, 400, `Texto longo demais (maximo ${MAX_TEXTO} caracteres).`,
      "Separe em mais de um envio.");
    const hora = horaLocal();
    const sep = await separarRefeicoes(texto, hora);
    return {
      refeicoes: await medirTodas(sep.refeicoes, hora),
      separacao: { fonte: sep.fonte, erro: sep.erro },
    };
  }

  /* POST /refeicoes { data?, refeicoes:[{tipo, texto, itens}] } -> grava.
     Recalcula tudo a partir de gramas e por100: o total que a tela mostrou
     nao e confiavel (pode ter sido editado a mao). */
  if (metodo === "POST" && rota === "/refeicoes") {
    const b = corpo(req);
    const data = dataDoPedido(b.data);
    const lista = Array.isArray(b.refeicoes) ? b.refeicoes : [];
    const hora = horaLocal();
    const prontas = lista.map((r) => montarRefeicao(r || {}, hora)).filter((r) => r.itens.length);
    exigir(prontas.length, 400, "Nada pra salvar: nenhuma refeicao tem item.",
      "Meca as refeicoes antes de salvar.");
    exigir(prontas.length <= MAX_REFEICOES, 400, `No maximo ${MAX_REFEICOES} refeicoes por vez.`);
    const salvas = await salvarRefeicoes(data, prontas);
    return { data, salvas };
  }

  /* GET /dia?data=AAAA-MM-DD -> refeicoes do dia e o total */
  if (metodo === "GET" && rota === "/dia") {
    /* Poda oportunista, como o /hoje do treino: na Vercel nao existe processo
       de fundo, entao o fechamento de ciclo acontece quando voce abre o dia.
       O catch e obrigatorio: limpeza que derruba a tela e pior que lixo
       acumulado, e o proximo acesso tenta de novo. */
    const podou = await fecharCiclosVencidos(agruparEmCiclos).catch((e) => {
      console.error("[refeicao] fechamento de ciclo falhou: " + e.message);
      return null;
    });
    const data = dataDoPedido(url.searchParams.get("data"));
    const refeicoes = await listarDoDia(data);
    return { data, hoje: hojeLocal(), refeicoes, totais: totaisDoDia(refeicoes),
      // null quando nao houve poda; campo novo, a tela de hoje ignora
      ciclo_fechado: podou && podou.ciclos ? podou : null };
  }

  /* GET /ciclos?n=26 -> os resumos quinzenais que sobraram da poda */
  if (metodo === "GET" && rota === "/ciclos") {
    return { janela_dias: JANELA_DIAS, ciclos: await listarCiclos(Number(url.searchParams.get("n")) || 26) };
  }

  /* POST /ciclos/fechar -> forca o fechamento agora (idempotente) */
  if (metodo === "POST" && rota === "/ciclos/fechar") {
    return { ok: true, ...(await fecharCiclosVencidos(agruparEmCiclos)) };
  }

  /* GET /dias?ate=AAAA-MM-DD&quantos=7 -> total por dia, pro grafico */
  if (metodo === "GET" && rota === "/dias") {
    const ate = dataDoPedido(url.searchParams.get("ate"));
    const quantos = Math.min(Math.max(Number(url.searchParams.get("quantos")) || 7, 1), JANELA_DIAS);
    const de = diaMenos(ate, quantos - 1);
    const todas = await listarPeriodo(de, ate);
    const dias = [];
    for (let i = quantos - 1; i >= 0; i--) {
      const d = diaMenos(ate, i);
      const doDia = todas.filter((r) => r.data === d);
      dias.push({ data: d, refeicoes: doDia.length, totais: totaisDoDia(doDia) });
    }
    return { de, ate, dias };
  }

  /* PUT /refeicoes/:id { tipo?, itens? } -> corrige uma refeicao salva */
  const casaId = rota.match(/^\/refeicoes\/([\w-]{1,64})$/);
  if (casaId && metodo === "PUT") {
    const atual = await buscarRefeicao(casaId[1]);
    exigir(atual, 404, "Refeicao nao encontrada.");
    const b = corpo(req);
    const nova = montarRefeicao({
      tipo: b.tipo ?? atual.tipo,
      texto: b.texto ?? atual.texto,
      itens: Array.isArray(b.itens) ? b.itens : atual.itens,
    }, horaLocal());
    exigir(nova.itens.length, 400, "A refeicao ficou sem item.", "Para apagar, use excluir.");
    return { refeicao: await atualizarRefeicao(atual.id, nova) };
  }

  /* DELETE /refeicoes/:id */
  if (casaId && metodo === "DELETE") {
    const ok = await removerRefeicao(casaId[1]);
    exigir(ok, 404, "Refeicao nao encontrada.");
    return { removida: casaId[1] };
  }

  throw new ErroHttp(404, `Rota nao existe: ${metodo} ${rota}`);
}

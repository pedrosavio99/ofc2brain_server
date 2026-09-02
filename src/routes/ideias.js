import { Router } from "express";
import crypto from "crypto";
import * as ideasService from "../ideasService.js";
import * as extracaoService from "../extracaoService.js";
import { estadoChaves } from "../geminiClient.js";
import { estadoChavesGroq } from "../groqClient.js";
import { listaAngulos, listaTamanhos, listaAtalhos } from "../insightFormatos.js";

const router = Router();

// Cria uma ideia de forma 100% automatica: so o texto e obrigatorio
router.post("/ideias", async (req, res) => {
  try {
    const { texto } = req.body;
    const ideia = await ideasService.criarIdeiaAutomaticamente(texto);
    res.status(201).json(ideia);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

/**
 * Garimpo: quebra um texto bruto em candidatas a nota. NAO salva nada.
 * O front mostra a lista, a pessoa escolhe, e o que for escolhido volta pelo
 * POST /ideias normal (uma requisicao por nota), que e quem cria de verdade.
 *
 * POST /extrair { texto: string, maximo?: number }
 */
router.post("/extrair", async (req, res) => {
  try {
    const { texto, maximo } = req.body || {};
    const dados = await extracaoService.extrairIdeias(texto, {
      maximo: maximo != null ? Number(maximo) : 12,
    });
    res.json(dados);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

router.get("/ideias", async (req, res) => {
  try {
    // desde/ate: ISO ou AAAA-MM-DD. Ex: /ideias?desde=2026-07-01&ate=2026-07-31
    const { area, tipo, desde, ate } = req.query;
    const ideias = await ideasService.listarIdeias({ area, tipo, desde, ate });
    res.json(ideias);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get("/ideias/:id", async (req, res) => {
  try {
    const ideia = await ideasService.buscarIdeiaPorId(req.params.id);
    if (!ideia) return res.status(404).json({ erro: "Ideia nao encontrada." });
    res.json(ideia);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.delete("/ideias/:id", async (req, res) => {
  try {
    const removida = await ideasService.removerIdeia(req.params.id);
    if (!removida) return res.status(404).json({ erro: "Ideia nao encontrada." });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Modo pesquisa: busca semantica entre as ideias, com insight opcional gerado pelo LLM
router.get("/pesquisa", async (req, res) => {
  try {
    const { q, insight, limite } = req.query;
    if (!q) return res.status(400).json({ erro: "Parametro 'q' e obrigatorio." });

    const resultado = await ideasService.pesquisar(q, {
      comInsight: insight === "true",
      limite: limite ? Number(limite) : 5,
      angulo: req.query.angulo || null,
      tamanho: req.query.tamanho || null,
    });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/**
 * Insight avancado sobre um RECORTE da base (nao e busca semantica pura).
 * Serve pros tres modos que a UI oferece:
 *   - por area e/ou por periodo             (ex: ?area=negocios&periodo=30d)
 *   - com uma frase/pergunta de base        (ex: ?q=o que priorizar&periodo=7d)
 *   - sem nada, so o recorte                 (ex: ?periodo=tudo)
 *
 * Aceita GET (parametros na query) e POST (mesmos campos no corpo JSON, melhor
 * pra frases longas). Campos: q, area, periodo, desde, ate, limite.
 */
async function handlerInsight(req, res) {
  try {
    const src = req.method === "POST" ? (req.body || {}) : req.query;
    const dados = await ideasService.insightAvancado({
      q: src.q || null,
      area: src.area || null,
      periodo: src.periodo || null,
      desde: src.desde || null,
      ate: src.ate || null,
      limite: src.limite != null ? Number(src.limite) : 20,
      angulo: src.angulo || null,
      tamanho: src.tamanho || null,
    });
    res.json(dados);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}
router.get("/insight", handlerInsight);
router.post("/insight", handlerInsight);

/**
 * Catalogo de formatos: angulos, tamanhos e atalhos de continuidade.
 * A UI monta os chips a partir daqui, entao adicionar um angulo novo no
 * insightFormatos.js ja aparece na tela sem mexer no front.
 */
router.get("/insight/formatos", (_req, res) => {
  res.json({ angulos: listaAngulos(), tamanhos: listaTamanhos(), atalhos: listaAtalhos() });
});

/**
 * Continuidade: um pedido em cima de um insight ja gerado ("explique melhor",
 * "mais exemplos", "discorde disso" ou texto livre).
 * POST /insight/continuar { anterior, pedido?|atalho?, ids?, historico?, foco?, tamanho? }
 */
router.post("/insight/continuar", async (req, res) => {
  try {
    const b = req.body || {};
    const dados = await ideasService.continuarInsight({
      pedido: b.pedido || null,
      atalho: b.atalho || null,
      anterior: b.anterior || null,
      historico: Array.isArray(b.historico) ? b.historico : [],
      ids: Array.isArray(b.ids) ? b.ids : [],
      foco: b.foco || null,
      tamanho: b.tamanho || null,
    });
    res.json(dados);
  } catch (err) {
    res.status(400).json({ erro: err.message });
  }
});

/**
 * Preview do recorte: devolve as MESMAS notas que o insight usaria, sem gerar o
 * insight (sem LLM). Com frase custa 1 embedding + busca vetorial; sem frase, nada.
 * A UI chama isso ao vivo (com debounce) enquanto a pessoa mexe nos filtros.
 * GET /insight/preview?q=...&area=...&periodo=7d&limite=20  (POST tambem serve)
 */
async function handlerPreview(req, res) {
  try {
    const src = req.method === "POST" ? (req.body || {}) : req.query;
    const dados = await ideasService.previewRecorte({
      q: src.q || null,
      area: src.area || null,
      periodo: src.periodo || null,
      desde: src.desde || null,
      ate: src.ate || null,
      limite: src.limite != null ? Number(src.limite) : 20,
    });
    res.json(dados);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}
router.get("/insight/preview", handlerPreview);
router.post("/insight/preview", handlerPreview);

// Proximos eventos/lembretes
router.get("/eventos/proximos", async (req, res) => {
  try {
    const { dias } = req.query;
    const eventos = await ideasService.proximosEventos({ dias: dias ? Number(dias) : 30 });
    res.json(eventos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Manutencao: re-embeda tudo com o modelo atual e reconstroi TODAS as relacoes.
// Roda depois de importar dados antigos ou de trocar o modelo de embedding.
/**
 * Sugestoes de perguntas de insight, ancoradas nas ultimas notas.
 * GET /insight/sugestoes?ultimas=20&forcar=true
 * O resultado fica em cache ate voce guardar uma nota nova (ou usar forcar=true),
 * porque cada geracao custa uma chamada de LLM.
 */
router.get("/insight/sugestoes", async (req, res) => {
  try {
    const ultimas = Number(req.query.ultimas) || 20;
    const forcar = String(req.query.forcar || "") === "true";
    // ids: recorte especifico (ex: resultado de uma pesquisa). Tem prioridade
    // sobre "ultimas". Ex: /insight/sugestoes?ids=abc,def,ghi
    const ids = req.query.ids
      ? String(req.query.ids).split(",").map((i) => i.trim()).filter(Boolean)
      : null;
    const dados = await ideasService.sugerirPerguntas({ ultimas, ids, forcar });
    res.json(dados);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/** Diagnostico: quais chaves do Gemini estao disponiveis ou em descanso. */
router.get("/insight/chaves", (_req, res) => {
  try {
    const chaves = estadoChaves();
    const groq = estadoChavesGroq();
    res.json({ total: chaves.length, chaves, groq: { total: groq.length, chaves: groq } });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

/* O relink faz uma chamada de LLM por nota, entao numa base grande ele leva
   minutos. Segurar a conexao ate o fim daria timeout no navegador, entao ele
   roda em background e o front acompanha por /relink/status. */
const trabalhosRelink = new Map();
let relinkEmAndamento = false;

router.post("/relink", (_req, res) => {
  if (process.env.VERCEL) {
    return res.status(501).json({
      erro: "relink e um job longo e nao roda em serverless. Rode local apontando pro mesmo Supabase: npm run relink",
    });
  }
  if (relinkEmAndamento) {
    return res.status(409).json({ erro: "ja existe uma reconstrucao em andamento" });
  }
  const id = crypto.randomUUID();
  const trabalho = {
    id,
    estado: "rodando",
    fase: "preparando",
    etapa: 0,
    feito: 0,
    total: 0,
    falhas: 0,
    comecouEm: new Date().toISOString(),
  };
  trabalhosRelink.set(id, trabalho);
  relinkEmAndamento = true;

  res.status(202).json({ jobId: id, estado: trabalho.estado });

  ideasService
    .reindexarTudo((p) => {
      Object.assign(trabalho, p);
      // estimativa de tempo restante: so a fase 2 depende de rede
      if (p.fase === "relacoes" && p.feito > 0) {
        const gasto = Date.now() - new Date(trabalho.comecouEm).getTime();
        const porItem = gasto / p.feito;
        trabalho.restanteSegundos = Math.max(0, Math.round((porItem * (p.total - p.feito)) / 1000));
      }
    })
    .then((resumo) => {
      Object.assign(trabalho, { estado: "concluido", fase: "concluido", resumo, restanteSegundos: 0 });
    })
    .catch((err) => {
      Object.assign(trabalho, { estado: "erro", erro: err.message });
    })
    .finally(() => {
      relinkEmAndamento = false;
      trabalho.terminouEm = new Date().toISOString();
    });
});

/** Progresso da reconstrucao. */
router.get("/relink/status/:jobId", (req, res) => {
  const t = trabalhosRelink.get(req.params.jobId);
  if (!t) return res.status(404).json({ erro: "trabalho nao encontrado" });
  res.json(t);
});

export default router;
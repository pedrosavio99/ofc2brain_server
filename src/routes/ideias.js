import { Router } from "express";
import crypto from "crypto";
import * as ideasService from "../ideasService.js";
import { estadoChaves } from "../geminiClient.js";
import { estadoChavesGroq } from "../groqClient.js";

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
    });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

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
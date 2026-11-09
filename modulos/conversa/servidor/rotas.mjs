/**
 * Rotas do modulo CONVERSA. Tres camadas, duas requisicoes (o contrato com a
 * tela nao mudou):
 *
 *   camada 0  no front, instantanea, zero rede
 *   camada 1  POST /api/contexto    PLANEJA (modo, perguntas, fontes), CONSULTA as
 *                                   fontes em paralelo e grava a evidencia no turno.
 *   camada 1b POST /api/rapida      o modelo leve segura a conversa na espera
 *   camada 2  POST /api/responder   o modelo forte, com a evidencia ja pronta
 *   depois    POST /api/memorizar   extrai fatos duraveis (a tela chama depois)
 *
 * A camada 1 grava o turno da pessoa COM a evidencia (meta.evidencia). A camada
 * 2 le dali: o cliente nao carrega contexto entre as chamadas, entao nao tem
 * como mandar outra coisa na segunda, e a resposta sai do que a camada 1 achou.
 */
import { salvarAlma, lerAlma, destilar, precisaDestilar, TURNOS_ENTRE_DESTILACOES } from "./alma.mjs";
import * as banco from "./banco.mjs";
import { checarBanco as banco_checar, ErroHttp } from "./banco.mjs";
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { gerarEmbeddings } from "../../../src/embeddings.js";
import { prepararTurno, planoCompacto } from "./turno.mjs";
import { ehSensivel } from "./modos.mjs";
import { memorizar, invalidarCache, memoriaDisponivel } from "./memoria.mjs";
import { gerarSugestoes } from "./sugestoes.mjs";
import { montarPromptTurno, historicoParaMensagens, gerarResposta, perguntasSeguidas } from "./resposta.mjs";
import { ESPEC } from "./ferramentas-spec.mjs";

const SISTEMA_RAPIDA = `Você é o segundo cérebro da pessoa e acabou de receber uma mensagem dela. A resposta de verdade ainda está sendo pensada e chega daqui a alguns segundos. Seu trabalho é segurar a conversa nesse meio tempo, como gente faz.

Você PODE:
- reagir ao que a pessoa disse AGORA
- dizer o que encontrou nas notas, pelo conteúdo ("tem uma sua de junho falando de X")
- pensar em voz alta ("deixa eu juntar isso com aquilo")
- fazer uma pergunta curta sobre o assunto de agora

REGRA MAIS IMPORTANTE: fique NO ASSUNTO desta mensagem e do que veio antes na conversa. Nota que não tem a ver com o que a pessoa está falando agora, você IGNORA. Puxar outro assunto porque apareceu na lista é pior do que ficar calado.

Você NÃO PODE, de jeito nenhum:
- concluir, opinar, aconselhar ou responder a pergunta
- dizer o que aquilo significa ou o que a pessoa deveria fazer
Quem responde é a mensagem que vem depois. Se você concluir agora, vai se contradizer daqui a pouco.

Tom: português do Brasil falado, informal, sem travessão. Nada de "posso ajudar" nem de repetir o que a pessoa disse.
Formato: 2 ou 3 mensagens BEM curtas, de uma linha cada, como quem manda no chat enquanto pensa.

Responda SOMENTE com JSON:
{"mensagens": ["...", "..."]}`;

function exigir(cond, status, msg, dica = "") {
  if (!cond) throw new ErroHttp(status, msg, dica);
}

/* O roteador so compara caminho fixo. Isto cobre /conversas/:id e /tracos/:id
   sem trazer um roteador inteiro pra dentro do modulo. */
function pegarId(rota, prefixo) {
  if (!rota.startsWith(prefixo + "/")) return null;
  const resto = rota.slice(prefixo.length + 1);
  return resto && !resto.includes("/") ? decodeURIComponent(resto) : null;
}

/** A tabela de memorias pode nao existir ainda: vira 503 com a instrucao. */
async function comMemorias(fn) {
  try { return await fn(); } catch (e) {
    if (e.faltaTabela) throw new ErroHttp(503, "A tabela de memórias não existe.", "Rode supabase/conversa-v2.sql no Supabase.");
    throw e;
  }
}

async function vetorDe(texto) {
  try { const [v] = await gerarEmbeddings([texto]); return v; } catch { return null; }
}

export async function rotear(req, url) {
  const rota = url.pathname.replace(/^\/api/, "") || "/";
  const corpo = req.body && typeof req.body === "object" ? req.body : {};

  /* Health que ENCOSTA no banco. Responde 200 mesmo com o banco fora: o corpo
     e o diagnostico, e 500 aqui faria a tela mostrar "erro interno" em vez do
     motivo real. */
  if (req.method === "GET" && rota === "/health") {
    const b = await banco_checar();
    return { status: b.ok ? "ok" : "degradado", modulo: "conversa", banco: b, memorias: memoriaDisponivel() };
  }

  // ---- as ferramentas que o cerebro pode consultar (mesma lista do MCP) ----
  if (req.method === "GET" && rota === "/ferramentas") {
    return { ferramentas: Object.entries(ESPEC).map(([nome, e]) => ({ nome, fonte: e.fonte, descricao: e.descricao, args: e.args })) };
  }

  // ---- busca musical para o player integrado da conversa ----
  if (req.method === "GET" && rota === "/musica/busca") {
    const q = url.searchParams.get("q") || "";
    const workerUrl = "https://teste-sm.pedro-sarmento-455.workers.dev/api/busca?q=" + encodeURIComponent(q);
    try {
      const resp = await fetch(workerUrl);
      return await resp.json().catch(() => ({}));
    } catch (e) {
      return { ok: false, erro: e.message, musicas: [], artistas: [], cds: [] };
    }
  }

  // ---- sessao ----
  if (req.method === "POST" && rota === "/sessao") {
    return await banco.criarConversa(corpo.titulo);
  }

  if (req.method === "GET" && rota === "/historico") {
    const id = url.searchParams.get("conversa_id");
    exigir(id, 400, "Informe conversa_id.");
    /* 404 em historico de conversa que nao existe: sem isto a tela adotava o id
       de uma conversa morta e so descobria na primeira mensagem. */
    exigir(await banco.conversaExiste(id), 404, "Conversa nao encontrada.", "Abra uma conversa nova.");
    return { turnos: await banco.ultimosTurnos(id, Number(url.searchParams.get("n")) || 20) };
  }

  // ---- camada 1: planeja, consulta e grava o turno da pessoa COM a evidencia ----
  if (req.method === "POST" && rota === "/contexto") {
    const { conversa_id: conversaId, texto } = corpo;
    exigir(conversaId, 400, "Informe conversa_id.", "Chame POST /conversa/api/sessao primeiro.");
    exigir(texto && String(texto).trim(), 400, "Texto vazio.");
    exigir(await banco.conversaExiste(conversaId), 404, "Conversa nao encontrada.");

    const anteriores = await banco.ultimosTurnos(conversaId, 8);
    const t = await prepararTurno({ texto, historico: anteriores, conversaId });
    const ordem = await banco.proximaOrdem(conversaId);
    const { turno } = await banco.inserirTurno({
      conversaId, ordem, papel: "pessoa", texto,
      notasUsadas: t.pacote.ids,
      meta: {
        modo: t.plano.modo,
        plano: planoCompacto(t.plano),
        memoravel: t.plano.memoravel,
        evidencia: t.pacote.texto,
        memorias: t.memorias,
        fontes: t.pacote.fontes,
        sem_resultado: t.pacote.semResultado.map((s) => s.ferramenta),
        achado: t.pacote.achado,
        rapida: t.pacote.resumosRapida,
        ms: t.ms,
      },
    });

    // primeira mensagem nomeia a conversa. Sem LLM: e so a frase da pessoa.
    const tituloNovo = turno.ordem === 1 ? await banco.nomearSeVazia(conversaId, texto) : null;
    const sensivel = ehSensivel(t.plano.modo);

    return {
      ordem: turno.ordem,
      titulo: tituloNovo,
      frase: t.frase,
      modo: t.plano.modo,
      sensivel,
      achado: sensivel ? { total: 0, fortes: 0, areas: [] } : t.pacote.achado,
      // criado_em vai junto: e o que deixa a tela dizer "aquela de junho" na espera
      notas: sensivel ? [] : t.pacote.resumosRapida,
      fontes: t.pacote.fontes.map((f) => f.ferramenta),
    };
  }

  // ---- camada 1b: o modelo rapido segura a conversa ----
  /* NAO grava turno. E enchimento de espera: se virasse turno entraria no
     historico e um dia seria destilado na alma, e voce teria uma alma
     aprendida em cima de "deixa eu ver aqui". */
  if (req.method === "POST" && rota === "/rapida") {
    const { conversa_id: conversaId, ordem } = corpo;
    exigir(conversaId, 400, "Informe conversa_id.");
    exigir(Number.isFinite(Number(ordem)), 400, "Informe a ordem devolvida por /contexto.");

    const turnoPessoa = await banco.buscarTurno(conversaId, Number(ordem));
    exigir(turnoPessoa, 404, "Turno nao encontrado.");
    const meta = turnoPessoa.meta || {};

    /* Em desabafo e em crise enchimento de espera soa errado: "tem uma nota
       sua de junho" em cima de uma dor e relatorio, nao presenca. */
    if (ehSensivel(meta.modo)) return { mensagens: [], meta: { pulada: true, motivo: "modo sensivel" } };

    const resumos = (Array.isArray(meta.rapida) ? meta.rapida : [])
      .map((n, i) => `${i + 1}. [${n.area || "sem area"}] ${n.resumo || "(sem resumo)"} (de ${n.criado_em})`).join("\n");

    const antes = await banco.ultimosTurnos(conversaId, 6);
    const historicoRapida = historicoParaMensagens(antes.filter((t) => t.ordem < Number(ordem)), { max: 6 });

    const prompt = `A pessoa acabou de dizer:\n"""\n${String(turnoPessoa.texto).slice(0, 800)}\n"""\n\n` +
      (resumos
        ? `Notas dela que se ligam a ISSO:\n${resumos}`
        : "Você não achou nota nenhuma sobre isso. Diga que não achou, não invente outro assunto.");

    const r = await chatJSONDetalhado(SISTEMA_RAPIDA, prompt, {
      modelo: process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b",
      temperatura: 0.85, mensagens: historicoRapida, tentativas: 1,
    });
    const mensagens = (Array.isArray(r.dados && r.dados.mensagens) ? r.dados.mensagens : [])
      .map((m) => String(m || "").trim()).filter(Boolean).slice(0, 3)
      .map((m) => (m.length > 200 ? m.slice(0, 197) + "..." : m));

    return { mensagens, meta: { provedor: "groq", modelo: r.meta.modelo, rapida: true } };
  }

  // ---- camada 2: o modelo responde ----
  if (req.method === "POST" && rota === "/responder") {
    const { conversa_id: conversaId, ordem } = corpo;
    exigir(conversaId, 400, "Informe conversa_id.");
    exigir(Number.isFinite(Number(ordem)), 400, "Informe a ordem devolvida por /contexto.");

    const turnoPessoa = await banco.buscarTurno(conversaId, Number(ordem));
    exigir(turnoPessoa, 404, "Turno nao encontrado.", "Chame /contexto antes.");
    exigir(turnoPessoa.papel === "pessoa", 400, "Essa ordem nao e um turno da pessoa.");

    // Retry ou toque duplo: a resposta ja existe, devolve ela em vez de gerar de novo.
    const jaRespondido = await banco.buscarTurno(conversaId, Number(ordem) + 1);
    if (jaRespondido) {
      return { mensagens: jaRespondido.mensagens && jaRespondido.mensagens.length ? jaRespondido.mensagens : [jaRespondido.texto], seguir: (jaRespondido.meta && jaRespondido.meta.seguir) || [], meta: jaRespondido.meta || {}, reaproveitado: true };
    }

    const [tracos, anteriores, panorama] = await Promise.all([
      banco.listarTracos({}),
      banco.ultimosTurnos(conversaId, 20),
      // o panorama e contexto, nao insumo: falha dele nao pode derrubar a resposta
      banco.panoramaBase().catch(() => null),
    ]);
    // o turno atual vai no prompt, entao sai do historico pra nao aparecer duas vezes
    const passados = anteriores.filter((t) => t.ordem < Number(ordem));

    /* A evidencia vem do turno, gravada pela camada 1. Turno sem ela (anterior a
       esta versao, ou /contexto que falhou no meio) e re-planejado aqui, em vez
       de responder as cegas. */
    let meta = turnoPessoa.meta || {};
    let plano = meta.plano;
    if (!plano || meta.evidencia == null) {
      const t = await prepararTurno({ texto: turnoPessoa.texto, historico: passados, conversaId });
      plano = planoCompacto(t.plano);
      meta = { ...meta, plano, evidencia: t.pacote.texto, memorias: t.memorias, fontes: t.pacote.fontes };
    }

    const prompt = montarPromptTurno({
      tracos, panorama,
      memoriasBase: Array.isArray(meta.memorias) ? meta.memorias : [],
      evidencia: meta.evidencia || "",
      plano, texto: turnoPessoa.texto,
      perguntasSeguidas: perguntasSeguidas(passados),
    });
    const r = await gerarResposta({ prompt, historico: historicoParaMensagens(passados), plano });

    const { turno } = await banco.inserirTurno({
      conversaId,
      ordem: Number(ordem) + 1,
      papel: "cerebro",
      texto: r.texto,
      mensagens: [r.texto],
      notasUsadas: turnoPessoa.notas_usadas || [],
      meta: {
        // o modo e a carga ficam no turno do CEREBRO: o planejador do proximo turno le daqui
        modo: plano.modo, modo_secundario: plano.modo_secundario, tamanho: plano.tamanho,
        carga_emocional: plano.carga_emocional,
        planejador: plano.fonte, motivo: plano.motivo,
        fontes: (meta.fontes || []).map((f) => f.ferramenta),
        tracos: tracos.length,
        seguir: r.seguir || [],
        // qual modelo respondeu: e a unica forma de saber se caiu pra reserva
        provedor: r.meta && r.meta.provedor, modelo: r.meta && r.meta.modelo, pensando: r.meta && r.meta.pensando,
      },
    });

    return { mensagens: turno.mensagens, seguir: r.seguir || [], meta: turno.meta, reaproveitado: false };
  }

  // ---- depois da resposta: memoriza fatos duraveis ----
  /* Separada do /responder de proposito: em serverless, trabalho depois do
     response e descartado. A tela chama esta rota quando a resposta ja chegou
     e a pessoa ja esta lendo, entao o custo nao aparece como espera. */
  if (req.method === "POST" && rota === "/memorizar") {
    const { conversa_id: conversaId, ordem } = corpo;
    exigir(conversaId, 400, "Informe conversa_id.");
    exigir(Number.isFinite(Number(ordem)), 400, "Informe a ordem do turno da pessoa.");
    const turno = await banco.buscarTurno(conversaId, Number(ordem));
    exigir(turno && turno.papel === "pessoa", 404, "Turno da pessoa nao encontrado.");
    const meta = turno.meta || {};
    // o planejador decide se a mensagem tem fato duravel: pergunta e papo nao gastam chamada
    if (meta.memoravel !== true) return { pulado: true, motivo: "nada duravel nesta mensagem" };
    if (meta.memorizado) return { pulado: true, motivo: "ja memorizado" };

    const antes = (await banco.ultimosTurnos(conversaId, 6))
      .filter((t) => t.papel === "pessoa" && t.ordem < Number(ordem)).slice(-2).map((t) => t.texto);
    const r = await memorizar({ textoPessoa: turno.texto, contexto: antes, conversaId, ordem: Number(ordem) });
    await banco.mesclarMetaTurno(conversaId, Number(ordem), { memorizado: true, memoria_ops: r }).catch(() => {});
    return r;
  }

  // ---- sugestoes: o "feed" de assuntos do dia, tirado das suas notas ----
  if (req.method === "GET" && rota === "/sugestoes") {
    return await gerarSugestoes({ forcar: url.searchParams.get("forcar") === "1" });
  }

  // ---- diagnostico: por que ele respondeu daquele jeito ----
  /* Roda planejamento + consulta SEM gerar resposta e devolve tudo: o modo, as
     perguntas reescritas, o que cada fonte trouxe e em quantos ms. E a rota pra
     abrir quando a resposta sair estranha. */
  if (req.method === "POST" && rota === "/diagnostico") {
    exigir(corpo.texto && String(corpo.texto).trim(), 400, "Informe texto.");
    const historico = corpo.conversa_id ? await banco.ultimosTurnos(corpo.conversa_id, 8).catch(() => []) : [];
    const t = await prepararTurno({ texto: corpo.texto, historico, conversaId: corpo.conversa_id || null });
    return {
      plano: planoCompacto(t.plano),
      planejador: t.plano.planejador || null,
      frase: t.frase,
      fontes: t.pacote.fontes,
      sem_resultado: t.pacote.semResultado,
      memorias: t.memorias,
      evidencia: t.pacote.texto,
      ms: t.ms,
    };
  }

  // ---- conversas: lista, renomear, favoritar, arquivar, excluir ----
  if (req.method === "GET" && rota === "/conversas") {
    return { conversas: await banco.listarConversas({ arquivadas: url.searchParams.get("arquivadas") === "1" }) };
  }
  const idConversa = pegarId(rota, "/conversas");
  if (idConversa && req.method === "PATCH") return await banco.atualizarConversa(idConversa, corpo);
  if (idConversa && req.method === "DELETE") return await banco.excluirConversa(idConversa);

  // ---- tracos da alma ----
  if (req.method === "GET" && rota === "/tracos") {
    return { tracos: await banco.listarTracos({ incluirInativos: url.searchParams.get("todos") === "1" }) };
  }
  if (req.method === "POST" && rota === "/tracos") {
    exigir(corpo.traco && String(corpo.traco).trim(), 400, "Informe o traco.");
    // fixado: escrito por voce, o destilador nao mexe
    const id = await banco.registrarTraco({ traco: corpo.traco, categoria: corpo.categoria, exemplo: corpo.exemplo });
    if (id && corpo.fixado !== false) await banco.atualizarTraco(id, { fixado: true });
    return { id, tracos: await banco.listarTracos({ incluirInativos: true }) };
  }
  const idTraco = pegarId(rota, "/tracos");
  if (idTraco && req.method === "PATCH") return await banco.atualizarTraco(idTraco, corpo);
  if (idTraco && req.method === "DELETE") return await banco.excluirTraco(idTraco);

  // ---- memorias: o que ele sabe sobre voce, editavel por voce ----
  if (req.method === "GET" && rota === "/memorias") {
    return await comMemorias(async () => ({
      memorias: await banco.listarMemorias({ incluirInativas: url.searchParams.get("todas") === "1" }),
    }));
  }
  if (req.method === "POST" && rota === "/memorias") {
    exigir(corpo.fato && String(corpo.fato).trim().length >= 3, 400, "Informe o fato.");
    return await comMemorias(async () => {
      // escrita por voce nasce FIXADA: o sistema nunca reescreve nem desativa
      const m = await banco.inserirMemoria({
        fato: corpo.fato, categoria: corpo.categoria || "outro", importancia: corpo.importancia || 4,
        fixado: corpo.fixado !== false, embedding: await vetorDe(String(corpo.fato)),
      });
      invalidarCache();
      return m;
    });
  }
  const idMemoria = pegarId(rota, "/memorias");
  if (idMemoria && req.method === "PATCH") {
    return await comMemorias(async () => {
      const campos = { ...corpo };
      if (typeof corpo.fato === "string" && corpo.fato.trim()) campos.embedding = await vetorDe(corpo.fato);
      const m = await banco.atualizarMemoria(idMemoria, campos);
      invalidarCache();
      return m;
    });
  }
  if (idMemoria && req.method === "DELETE") {
    return await comMemorias(async () => { const r = await banco.excluirMemoria(idMemoria); invalidarCache(); return r; });
  }

  // ---- alma ----
  if (req.method === "GET" && rota === "/alma") {
    const [alma, tracos, total] = await Promise.all([
      lerAlma(),
      banco.listarTracos({ incluirInativos: true }),
      banco.contarTurnosTotal(),
    ]);
    return { ...alma, tracos, turnos_totais: total, precisa_destilar: precisaDestilar(alma, total) };
  }

  // Observacao livre, escrita por voce. O que o sistema aprende sozinho vai
  // pra alma_tracos, nao pra ca.
  if (req.method === "PUT" && rota === "/alma") {
    exigir(typeof corpo.perfil === "string", 400, "Informe perfil (texto).");
    return await salvarAlma(corpo.perfil, corpo.turnos_lidos);
  }

  if (req.method === "POST" && rota === "/destilar") {
    const [alma, tracos, total] = await Promise.all([
      lerAlma(),
      banco.listarTracos({ incluirInativos: true }),
      banco.contarTurnosTotal(),
    ]);
    if (!corpo.forcar && !precisaDestilar(alma, total)) {
      return { destilou: false, motivo: `faltam turnos (a cada ${TURNOS_ENTRE_DESTILACOES})`, turnos_totais: total };
    }
    const novos = Math.max(1, total - (alma.turnos_lidos || 0));
    const turnos = await banco.turnosNaoDestilados(novos);
    const r = await destilar({ tracos, turnos });

    /* Um por um pela RPC de proposito: e ela que deduplica por texto e soma o
       `vezes`. Traco repetido nao vira linha nova, vira contagem maior. */
    for (const t of r.tracos) await banco.registrarTraco(t);
    await salvarAlma(undefined, total);

    return {
      destilou: r.tracos.length > 0,
      novos: r.tracos.length,
      observacao: r.observacao,
      turnos_totais: total,
      tracos: await banco.listarTracos({ incluirInativos: true }),
    };
  }

  throw new ErroHttp(404, `Rota nao encontrada: ${req.method} ${url.pathname}`);
}

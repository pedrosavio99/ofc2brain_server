/**
 * Rotas do modulo CONVERSA. Tres camadas, duas requisicoes.
 *
 *   camada 0  no front, instantanea, zero rede
 *   camada 1  POST /api/contexto    embedding + pgvector. Sem LLM.
 *   camada 2  POST /api/responder   o modelo, com alma + notas + historico
 *
 * A camada 1 grava o turno da pessoa com os ids que achou. A camada 2 le
 * aquele turno pelo (conversa_id, ordem): o cliente nao carrega contexto entre
 * as duas chamadas, entao nao tem como mandar outra coisa na segunda.
 */
import { recuperar, blocoDeNotas, blocoDoPanorama, blocoDoPeriodo } from "./recuperacao.mjs";
import { lerAlma, salvarAlma, blocoDaAlma, destilar, precisaDestilar, TURNOS_ENTRE_DESTILACOES } from "./alma.mjs";
import * as banco from "./banco.mjs";
import { checarBanco as banco_checar } from "./banco.mjs";
import { ErroHttp } from "./banco.mjs";
import { chatJSONDetalhado } from "../../../src/groqClient.js";
import { escolherTom, instrucaoDoTom, tokensDoTom } from "./tom.mjs";
import { gerarJSONDetalhado, temGemini } from "../../../src/geminiClient.js";
import * as db from "../../../src/db.js";

const SISTEMA = `Voce e o segundo cerebro dessa pessoa. Voce nao e assistente, nao e atendente e nao e terapeuta: voce e a parte da cabeca dela que guardou tudo e lembra.

Como falar:
- Portugues do Brasil, conversa de verdade. Frase curta. Sem travessao.
- Sem "posso ajudar", sem "que interessante", sem resumir o que ela acabou de dizer.

(Como responder ESTE turno vem mais abaixo, no bloco de instrucao. Ele manda sobre
o resto: se ele disser para nao dar contraponto, nao de contraponto.)

O que voce sabe:
- Voce so conhece as notas que te deram neste turno. Se nao tem nota sobre o assunto, diga isso e fale do que voce sabe dela.
- Nunca invente uma nota, uma data ou um numero. Citar errado e pior que nao citar.
- Referencie pelo conteudo, nunca por id.
- Cada nota vem com a idade dela entre parenteses (hoje, ontem, ha 5 dias). USE essa
  palavra. Nota de hoje nao e "aquela vez que voce escreveu": e de hoje, e tratar
  como antiga faz voce parecer que nao leu.

Formato: UMA mensagem so, inteira. Quem conversa em blocos curtos e a mensagem rapida que ja chegou antes de voce; voce e a resposta que ela estava cobrindo. Pode ter varios paragrafos. Nao repita o que a mensagem rapida disse, continue dali.

Responda SOMENTE com JSON:
{"mensagem": "texto inteiro aqui"}`;

/** Historico do banco no formato da API. Puro. */
export function historicoParaMensagens(turnos) {
  return (Array.isArray(turnos) ? turnos : [])
    .filter((t) => t && t.texto && String(t.texto).trim())
    .map((t) => ({
      role: t.papel === "pessoa" ? "user" : "assistant",
      content: String(t.texto),
    }));
}

/** Monta o prompt do turno. Puro, pra dar pra testar sem rede. */
export function montarPrompt({ tracos, panorama, bloco, texto, hojeISO, tom }) {
  return `Hoje e ${hojeISO}.

${blocoDaAlma(tracos)}

${blocoDoPanorama(panorama)}

${bloco}

Ela acabou de dizer:
"""
${String(texto || "").slice(0, 2000)}
"""

${tom ? instrucaoDoTom(tom) : ""}`;
}

const SISTEMA_RAPIDA = `Voce e o segundo cerebro dessa pessoa, e acabou de receber uma mensagem dela. A resposta de verdade ainda esta sendo pensada e chega daqui a alguns segundos. Seu trabalho e segurar a conversa nesse meio tempo, como gente faz.

Voce PODE:
- reagir ao que ela disse AGORA
- dizer o que voce encontrou nas notas, pelo conteudo ("tem uma sua de junho falando de X")
- pensar em voz alta ("deixa eu juntar isso com aquilo")
- fazer uma pergunta curta sobre o assunto de agora

REGRA MAIS IMPORTANTE: fique NO ASSUNTO desta mensagem e do que veio antes na
conversa. Nota que nao tem a ver com o que ela esta falando agora, voce IGNORA.
Ela veio falar de uma coisa; puxar outra porque apareceu na lista e pior do que
ficar calado.

Voce NAO PODE, de jeito nenhum:
- concluir, opinar, aconselhar ou responder a pergunta dela
- dizer o que aquilo significa ou o que ela deveria fazer
Quem responde e a mensagem que vem depois. Se voce concluir agora, vai se contradizer daqui a pouco.

Tom: portugues do Brasil falado, informal, sem travessao. Nada de "posso ajudar" nem de repetir o que ela disse.
Formato: 2 ou 3 mensagens BEM curtas, de uma linha cada, como quem manda no chat enquanto pensa.

Responda SOMENTE com JSON:
{"mensagens": ["...", "..."]}`;

/* Mensagem grande vira duas, cortando no fim de frase. Prompt sozinho nao
   segura tamanho: o Gemini com thinking manda paragrafo mesmo pedindo duas
   linhas. Cortar no meio da palavra seria pior que o problema. */
export function quebrarMensagens(msgs, max = 340) {
  const fora = [];
  for (const m of Array.isArray(msgs) ? msgs : []) {
    let resto = String(m || "").trim();
    while (resto.length > max && fora.length < 5) {
      const janela = resto.slice(0, max);
      let corte = Math.max(janela.lastIndexOf(". "), janela.lastIndexOf("? "), janela.lastIndexOf("! "));
      if (corte < max * 0.4) corte = janela.lastIndexOf(" ");
      if (corte <= 0) break;
      fora.push(resto.slice(0, corte + 1).trim());
      resto = resto.slice(corte + 1).trim();
    }
    if (resto) fora.push(resto);
  }
  return fora.slice(0, 5);
}

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

export async function rotear(req, url) {
  const rota = url.pathname.replace(/^\/api/, "") || "/";
  const corpo = req.body && typeof req.body === "object" ? req.body : {};

  /* Health que ENCOSTA no banco. O anterior respondia ok sempre, entao a tela
     subia achando que estava tudo certo e so descobria na primeira mensagem.
     Responde 200 mesmo com o banco fora: o corpo e o diagnostico, e 500 aqui
     faria a tela mostrar "erro interno" em vez do motivo real. */
  if (req.method === "GET" && rota === "/health") {
    const banco = await banco_checar();
    return { status: banco.ok ? "ok" : "degradado", modulo: "conversa", banco };
  }

  // ---- sessao ----
  if (req.method === "POST" && rota === "/sessao") {
    return await banco.criarConversa(corpo.titulo);
  }

  if (req.method === "GET" && rota === "/historico") {
    const id = url.searchParams.get("conversa_id");
    exigir(id, 400, "Informe conversa_id.");
    /* 404 em historico de conversa que nao existe.
       Sem esta linha, ultimosTurnos devolvia lista vazia e 200 para um id morto,
       e a tela adotava o id achando que era valido. So o /contexto e que conferia,
       na primeira mensagem, e ai voltava "Conversa nao encontrada" sem saida. */
    exigir(await banco.conversaExiste(id), 404, "Conversa nao encontrada.", "Abra uma conversa nova.");
    return { turnos: await banco.ultimosTurnos(id, Number(url.searchParams.get("n")) || 20) };
  }

  // ---- camada 1: recupera e grava o turno da pessoa ----
  if (req.method === "POST" && rota === "/contexto") {
    const { conversa_id: conversaId, texto } = corpo;
    exigir(conversaId, 400, "Informe conversa_id.", "Chame POST /conversa/api/sessao primeiro.");
    exigir(texto && String(texto).trim(), 400, "Texto vazio.");
    exigir(await banco.conversaExiste(conversaId), 404, "Conversa nao encontrada.");

    const achado = await recuperar(texto, { buscar: 40, maxFortes: 20, maxFracas: 4 });
    const ordem = await banco.proximaOrdem(conversaId);
    const { turno } = await banco.inserirTurno({
      conversaId,
      ordem,
      papel: "pessoa",
      texto,
      // fortes primeiro, tangentes depois: e essa ordem que o /rapida usa
      notasUsadas: achado.notas.map((n) => n.id),
      /* A janela vai gravada: o /responder remonta o bloco do zero e, sem
         isto, nao saberia que o pedido era por data. Perderia a instrucao de
         nao trocar por nota de outra data, e periodo vazio voltaria a virar
         "a base nao tem nota sobre isso", que e outra coisa. */
      meta: {
        fortes: achado.fortes.length,
        janela: achado.janela || null,
        totalPeriodo: (achado.resumo && achado.resumo.totalPeriodo) || null,
      },
    });

    // primeira mensagem nomeia a conversa. Sem LLM: e so a frase dela.
    const tituloNovo = turno.ordem === 1 ? await banco.nomearSeVazia(conversaId, texto) : null;

    return {
      ordem: turno.ordem,
      titulo: tituloNovo,
      frase: achado.frase,
      achado: {
        total: achado.resumo.total,
        fortes: achado.resumo.fortes,
        areas: achado.resumo.areas,
      },
      // criado_em vai junto: e o que deixa a tela dizer "aquela de junho" na espera
      notas: achado.fortes.map((n) => ({
        id: n.id, resumo: n.resumo, area: n.area, score: n.score,
        criado_em: String(n.criado_em || "").slice(0, 10),
      })),
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

    const ids = Array.isArray(turnoPessoa.notas_usadas) ? turnoPessoa.notas_usadas : [];
    /* SO as fortes. A lista vem fortes primeiro e tangentes depois; o /responder
       recebe as duas separadas e rotuladas, mas aqui entrava tudo achatado, e o
       modelo leve agarrava a tangente mais chamativa e saia do assunto. */
    const qtdFortes = Number(turnoPessoa.meta && turnoPessoa.meta.fortes) || 0;
    const soFortes = ids.slice(0, Math.min(6, qtdFortes));
    const brutas = await Promise.all(soFortes.map((id) => db.buscarPorId(id).catch(() => null)));
    const resumos = brutas.filter(Boolean)
      .map((n, i) => `${i + 1}. [${n.area || "sem area"}] ${n.resumo || "(sem resumo)"} (de ${String(n.criado_em).slice(0, 10)})`)
      .join("\n");

    /* Historico: sem ele, no quinto turno o modelo leve nao sabe do que voces
       estavam falando e comeca do zero a cada mensagem. Poucos turnos de
       proposito, isto precisa voltar em menos de um segundo. */
    const antes = await banco.ultimosTurnos(conversaId, 6);
    const historicoRapida = historicoParaMensagens(antes.filter((t) => t.ordem < Number(ordem)));

    const prompt = `Ela acabou de dizer:\n"""\n${String(turnoPessoa.texto).slice(0, 800)}\n"""\n\n` +
      (resumos
        ? `Notas dela que se ligam a ISSO:\n${resumos}`
        : "Voce nao achou nota nenhuma sobre isso. Diga que nao achou, nao invente outro assunto.");

    /* Groq de proposito, e o menor deles. O ponto aqui e chegar rapido; o
       modelo forte esta rodando em paralelo pra mensagem que importa. */
    const r = await chatJSONDetalhado(SISTEMA_RAPIDA, prompt, {
      modelo: process.env.GROQ_MODEL_RAPIDA || process.env.GROQ_MODEL_RELINK || "llama-3.1-8b-instant",
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
      return { mensagens: jaRespondido.mensagens || [jaRespondido.texto], meta: jaRespondido.meta || {}, reaproveitado: true };
    }

    const ids = Array.isArray(turnoPessoa.notas_usadas) ? turnoPessoa.notas_usadas : [];
    const brutas = await Promise.all(ids.slice(0, 24).map((id) => db.buscarPorId(id).catch(() => null)));

    /* score: 1 em TUDO era o defeito. A recuperacao separa forte de tangente
       pelo limiar 0.42 e grava as fortes primeiro, com a contagem em
       meta.fortes; o /rapida ja usava isso. Aqui a distincao era jogada fora, e
       o blocoDeNotas entregava ao modelo "Notas dele que falam disso (20)"
       mesmo quando so 3 falavam. Dai ele citar tangente com a mesma confianca.

       map ANTES do filter de proposito: nota que falhou ao carregar desloca as
       posicoes seguintes, e o corte de fortes passaria a marcar a nota errada.

       Turno antigo nao tem meta.fortes. Ali mantemos o comportamento de antes
       (tudo forte) em vez de rebaixar tudo a tangente, que seria pior. */
    const janelaDoTurno = (turnoPessoa.meta && turnoPessoa.meta.janela) || null;
    const temContagem = turnoPessoa.meta && turnoPessoa.meta.fortes != null;
    const qtdFortes = temContagem ? Number(turnoPessoa.meta.fortes) || 0 : ids.length;
    const notas = brutas
      .map((n, i) => (n ? { ...n, embedding: undefined, score: i < qtdFortes ? 1 : 0 } : null))
      .filter(Boolean);

    const [alma, tracos, anteriores, panorama, tom] = await Promise.all([
      lerAlma(),
      banco.listarTracos({}),
      banco.ultimosTurnos(conversaId, 20),
      // falha do panorama nao pode derrubar a resposta: ele e contexto, nao insumo
      banco.panoramaBase().catch(() => null),
      /* Camada de tom. Vai no MESMO Promise.all de proposito: em serie ela viraria
         mais um segundo de espera antes de o modelo forte nem comecar. Nunca lanca,
         entao nao precisa de catch: erro vira heuristica la dentro. */
      escolherTom({ texto: turnoPessoa.texto, notas }),
    ]);
    // o turno atual vai no prompt, entao sai do historico pra nao aparecer duas vezes
    const historico = historicoParaMensagens(anteriores.filter((t) => t.ordem < Number(ordem)));

    const prompt = montarPrompt({
      tracos,
      panorama,
      bloco: janelaDoTurno
        ? blocoDoPeriodo(janelaDoTurno, notas, Number(turnoPessoa.meta.totalPeriodo) || notas.length)
        : blocoDeNotas(notas),
      texto: turnoPessoa.texto,
      hojeISO: new Date().toISOString().slice(0, 10),
      tom,
    });
    // O teto sai do tom. O 4096 fixo de antes cortava resposta longa no meio.
    const tetoTokens = tokensDoTom(tom);

    /* Gemini com thinking primeiro, Groq de reserva. E a MESMA ordem que o
       insight usa (ideasService.js): antes a conversa rodava direto no Groq,
       ou seja, no plano B do insight, permanentemente. E por isso que a
       resposta saia rasa. Fica mais lento, e as camadas 0 e 1 cobrem isso. */
    let r = null;
    let metaLLM = null;
    if (temGemini()) {
      try {
        const g = await gerarJSONDetalhado(SISTEMA, prompt, {
          /* 4096 e nao 1200: com thinkingConfig o raciocinio gasta do MESMO
             teto, entao teto curto cortava a resposta no meio e o JSON.parse
             quebrava. Era o erro "devolveu JSON invalido". */
          temperatura: 0.75, mensagens: historico, maxTokens: tetoTokens,
        });
        r = g.dados; metaLLM = g.meta;
      } catch (e) {
        console.warn("[conversa] gemini falhou, caindo pro groq: " + e.message);
      }
    }
    if (!r) {
      /* tentativas: 1 de proposito. O padrao e 3, e cada rodada pode dormir
         ate 60s quando as chaves estao em descanso: a tela ficava minutos
         parada sem nada. Aqui e melhor falhar rapido e avisar. */
      const q = await chatJSONDetalhado(SISTEMA, prompt, {
        temperatura: 0.75, mensagens: historico, tentativas: 1,
      });
      r = q.dados; metaLLM = q.meta;
    }
    /* Aceita as duas formas: "mensagem" e o formato novo, "mensagens" cobre o
       Groq de reserva, que as vezes devolve array mesmo com o prompt novo. */
    const cru = r && typeof r.mensagem === "string"
      ? [r.mensagem]
      : (Array.isArray(r && r.mensagens) ? r.mensagens : []);
    const mensagens = cru.map((m) => String(m || "").trim()).filter(Boolean);
    exigir(mensagens.length, 502, "O modelo nao devolveu mensagem.");
    // uma mensagem so: nao quebra mais. Quem conversa em blocos e o modelo leve.
    const partidas = [mensagens.join("\n\n")];

    const { turno } = await banco.inserirTurno({
      conversaId,
      ordem: Number(ordem) + 1,
      papel: "cerebro",
      texto: mensagens.join("\n"),
      mensagens: partidas,
      notasUsadas: ids,
      meta: {
        notas: notas.length, alma_versao: alma.versao || 0, tracos: tracos.length,
        // invisivel na tela; serve pra voce conferir depois por que saiu daquele jeito
        tom: tom.registro, tom_tamanho: tom.tamanho, tom_fonte: tom.fonte, tom_motivo: tom.motivo,
        // qual modelo respondeu: e a unica forma de saber se caiu pra reserva
        provedor: metaLLM && metaLLM.provedor, modelo: metaLLM && metaLLM.modelo,
      },
    });

    return { mensagens: turno.mensagens, meta: turno.meta, reaproveitado: false };
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

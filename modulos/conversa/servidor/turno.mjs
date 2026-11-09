/**
 * O PIPELINE de preparo de um turno: planejar -> consultar -> montar evidencia.
 *
 * Fica fora do rotas.mjs pra ter um unico lugar que define "o que o cerebro
 * sabe quando vai responder", usado pela rota /contexto, pelo /diagnostico e
 * pelo script de avaliacao. Sem isso cada um montaria o seu e divergiria.
 *
 * Nao chama o modelo de resposta: termina quando a evidencia esta pronta.
 */
import { planejar } from "./planejador.mjs";
import { executarPlano } from "./ferramentas.mjs";
import { montarEvidencia, fraseDoPlano } from "./evidencia.mjs";
import { memoriasBase } from "./memoria.mjs";

/**
 * @param {{texto:string, historico?:object[], conversaId?:string|null, agora?:Date}} p
 * @returns {Promise<{plano, base:object[], memorias:object[], resultados:object[], pacote:object, frase:string, ms:object}>}
 */
export async function prepararTurno({ texto, historico = [], conversaId = null, agora = new Date() }) {
  const t0 = Date.now();
  /* A memoria de base nao depende do plano: busca junto com ele. */
  const [plano, base] = await Promise.all([
    planejar({ texto, historico, agora }),
    memoriasBase().catch(() => []),
  ]);
  const tPlano = Date.now() - t0;

  const resultados = await executarPlano(plano, { conversaId, agora, idsBase: new Set(base.map((m) => m.id)) });
  const tFerramentas = Date.now() - t0 - tPlano;

  const relacionadas = (resultados.find((r) => r.nome === "buscar_memoria") || {}).memorias || [];
  const pacote = montarEvidencia(resultados);
  const memorias = [...base, ...relacionadas].map((m) => ({ id: m.id, fato: m.fato }));

  return {
    plano, base, memorias, resultados, pacote,
    frase: fraseDoPlano(plano, pacote, memorias.length),
    ms: { planejar: tPlano, ferramentas: tFerramentas, total: Date.now() - t0 },
  };
}

/** O plano sem o que e grande ou redundante, pra gravar no meta do turno. Pura. */
export function planoCompacto(plano) {
  return {
    modo: plano.modo,
    modo_secundario: plano.modo_secundario || null,
    tamanho: plano.tamanho,
    carga_emocional: plano.carga_emocional || 0,
    pergunta: plano.pergunta,
    consultas: plano.consultas,
    ferramentas: plano.ferramentas.map((f) => f.nome),
    janela: plano.janela ? plano.janela.rotulo : null,
    fonte: plano.fonte,
    motivo: plano.motivo,
    modo_anterior: plano.modo_anterior || null,
    carga_anterior: plano.carga_anterior || 0,
    crise: Boolean(plano.crise),
  };
}

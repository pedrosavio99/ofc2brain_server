/**
 * Registro das metas diarias.
 *
 * Cada meta e um provedor: { id, rotulo, verificar({ hoje }) }. O verificar
 * devolve { estado, titulo, detalhe, imagem?, destaque? }. O balao so conhece
 * esse formato, entao meta nova e um arquivo novo e uma linha em PROVEDORES,
 * sem tocar no front.
 *
 * estado: "feita" | "pendente" | "andamento" | "erro"
 */

import duolingo from "./provedores/duolingo.mjs";
import treino from "../../treino/servidor/meta.mjs";

// A ordem aqui e a ordem no balao.
const PROVEDORES = [
  duolingo,
  treino,
];

// Mesmo fuso dos modulos treino e conversa. Sem isso, das 21h em diante o
// servidor (UTC) ja estaria no dia seguinte e tudo apareceria como pendente.
const FUSO_MIN = Number(process.env.FUSO_MINUTOS ?? -180); // America/Sao_Paulo

export function hojeLocal(agora = new Date()) {
  return new Date(agora.getTime() + FUSO_MIN * 60000).toISOString().slice(0, 10);
}

// API externa lenta nao pode segurar o balao inteiro
const PRAZO_MS = 6000;
const ESTADOS = new Set(["feita", "pendente", "andamento", "erro"]);

function comPrazo(promessa, ms, id) {
  let timer;
  const estouro = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`${id} passou de ${ms}ms`)), ms);
  });
  return Promise.race([promessa, estouro]).finally(() => clearTimeout(timer));
}

function normalizar(provedor, r) {
  const estado = ESTADOS.has(r && r.estado) ? r.estado : "erro";
  return {
    id: provedor.id,
    rotulo: provedor.rotulo,
    estado,
    titulo: String((r && r.titulo) || provedor.rotulo),
    detalhe: String((r && r.detalhe) || ""),
    imagem: (r && r.imagem) || null,
    destaque: (r && r.destaque) || null,
    link: r && typeof r.link === "string" && /^\/(?!\/)/.test(r.link) ? r.link : null,
  };
}

/** Roda todas as metas. Uma que falha vira card de erro, as outras seguem. */
export async function metasDeHoje(agora = new Date()) {
  const hoje = hojeLocal(agora);
  const resultados = await Promise.allSettled(
    PROVEDORES.map((p) =>
      comPrazo(Promise.resolve().then(() => p.verificar({ hoje })), PRAZO_MS, p.id)),
  );

  const metas = PROVEDORES.map((p, i) => {
    const r = resultados[i];
    if (r.status === "fulfilled") return normalizar(p, r.value);
    console.error(`[metas] ${p.id}: ${r.reason && r.reason.message}`);
    return normalizar(p, { estado: "erro", detalhe: "Não consegui verificar agora." });
  });

  return {
    data: hoje,
    total: metas.length,
    feitas: metas.filter((m) => m.estado === "feita").length,
    metas,
  };
}

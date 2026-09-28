/**
 * Meta de calorias do dia.
 *
 * Nada aqui mexe no modulo treino: as tabelas do treino sao lidas SOMENTE
 * para leitura (perfil e calorias das sessoes), e o objetivo (emagrecer,
 * manter, ganhar) mora numa tabela deste modulo.
 *
 * A conta:
 *   gasto parado  = Mifflin-St Jeor com peso, altura, idade e sexo
 *   gasto treino  = media diaria das sessoes concluidas nos ultimos 14 dias
 *   gasto do dia  = os dois somados
 *   teto          = gasto ajustado pelo objetivo
 *
 * HONESTIDADE: Mifflin erra uns 10% e caloria de treino sem batimento erra uns
 * 20%. Serve para orientar, nao para fechar balanco. A tela diz isso.
 *
 * A parte de conta e pura e testavel sem banco.
 */
import { createClient } from "@supabase/supabase-js";
import { ErroHttp, JANELA_DIAS } from "./banco.mjs";

/* MESMAS variaveis do banco.mjs. Ler outro nome de env faz o cliente subir com
   chave invalida e toda consulta falhar em silencio, o que aparece como
   "sem perfil" na tela. Foi exatamente o que aconteceu. */
const URL = process.env.SUPABASE_URL;
const KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const sb = createClient(URL || "http://invalido", KEY || "invalido", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const OBJETIVOS = {
  emagrecer: { rotulo: "Emagrecer", fator: 0.8 },
  manter: { rotulo: "Manter o peso", fator: 1.0 },
  ganhar: { rotulo: "Ganhar massa", fator: 1.12 },
};

export function objetivoValido(o) {
  const k = String(o || "").toLowerCase().trim();
  return OBJETIVOS[k] ? k : "manter";
}

/** Idade em anos a partir de AAAA-MM-DD. Puro. Null quando nao da pra saber. */
export function idadeDe(nascimento, agora = new Date()) {
  if (!nascimento) return null;
  const n = new Date(String(nascimento).slice(0, 10) + "T12:00:00Z");
  if (Number.isNaN(n.getTime())) return null;
  let anos = agora.getUTCFullYear() - n.getUTCFullYear();
  const mes = agora.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && agora.getUTCDate() < n.getUTCDate())) anos--;
  return anos >= 0 && anos < 120 ? anos : null;
}

/**
 * Gasto parado em 24h, Mifflin-St Jeor. Puro.
 * Sem sexo cadastrado devolve null em vez de chutar: a diferenca entre as duas
 * formulas e de 166 kcal, e chutar daria numero errado com cara de certo.
 */
export function basalDiario({ sexo, pesoKg, alturaCm, idade }) {
  const kg = Number(pesoKg), cm = Number(alturaCm), an = Number(idade);
  if (!(kg > 0) || !(cm > 0) || !(an > 0) || (sexo !== "M" && sexo !== "F")) return null;
  const base = 10 * kg + 6.25 * cm - 5 * an;
  return Math.round(sexo === "M" ? base + 5 : base - 161);
}

/** O teto e o que falta dele. Puro. */
export function calcularMeta({ basal, treinoDia, objetivo }) {
  const obj = objetivoValido(objetivo);
  if (!(basal > 0)) return { objetivo: obj, basal: null, treino_dia: 0, gasto: null, teto: null };
  const treino = Math.max(0, Math.round(Number(treinoDia) || 0));
  const gasto = basal + treino;
  // piso no basal: deficit que corta abaixo do gasto parado nao e dieta, e fome
  const teto = Math.max(basal, Math.round(gasto * OBJETIVOS[obj].fator));
  return { objetivo: obj, basal, treino_dia: treino, gasto, teto };
}

/* ------------------------------------------------------------- banco */

/** Objetivo escolhido. Tabela deste modulo; some junto com ele. */
export async function lerObjetivo() {
  const { data, error } = await sb.from("refeicao_config").select("*").eq("id", "unico").maybeSingle();
  // tabela ainda nao criada: nao derruba a tela, so assume "manter"
  if (error) return { objetivo: "manter", faltaTabela: true };
  return { objetivo: objetivoValido(data && data.objetivo), faltaTabela: false };
}

export async function salvarObjetivo(objetivo) {
  const linha = { id: "unico", objetivo: objetivoValido(objetivo), atualizado_em: new Date().toISOString() };
  const { error } = await sb.from("refeicao_config").upsert(linha, { onConflict: "id" });
  if (error) throw new ErroHttp(500, `salvarObjetivo: ${error.message}`);
  return linha.objetivo;
}

/** Perfil do treino, SO LEITURA. Sem o modulo treino, devolve null. */
export async function perfilDoTreino() {
  const { data, error } = await sb.from("treino_perfil").select("*").eq("id", "unico").maybeSingle();
  if (error) return null;
  return data || null;
}

/** Media diaria de caloria de treino nos ultimos 14 dias. SO LEITURA. */
export async function treinoPorDia(desde) {
  const { data, error } = await sb.from("treino_sessoes")
    .select("data, calorias, concluida").gte("data", desde);
  if (error) return 0;
  const total = (data || [])
    .filter((s) => s.concluida)
    .reduce((t, s) => t + (Number(s.calorias) || 0), 0);
  return Math.round(total / JANELA_DIAS);
}

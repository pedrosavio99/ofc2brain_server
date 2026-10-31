/**
 * Tabela de nomes do mapa do corpo.
 *
 * Recebe: nome de músculo como o catálogo escreve (`alvo`/`secundarios`), em inglês ou
 *   pt-BR, com ou sem acento e caixa.
 * Devolve: o id da região do mapa (peito, triceps...), o rótulo pt-BR e, para um
 *   exercício inteiro, o objeto { regiao: intensidade } que o <mapa-corpo> aceita.
 * Não faz: desenhar nada, nem chutar. Nome que o mapa não desenha (mãos, cardio) volta null.
 */

/** Regiões do mapa, na ordem da cabeça aos pés. Todas têm desenho. O desenho não tem serrátil, flexores do quadril nem tibial: esses nomes acendem a vizinha (peito, quadríceps, panturrilha). */
export const REGIOES = [
  "trapezio", "ombro", "peito", "costas", "biceps", "triceps", "antebraco",
  "abdomen", "obliquos", "lombar", "gluteo", "quadriceps", "posterior", "adutores",
  "panturrilha",
];

const ROTULOS = {
  trapezio: "Trapézio", ombro: "Ombro", peito: "Peito", costas: "Costas",
  biceps: "Bíceps", triceps: "Tríceps", antebraco: "Antebraço",
  abdomen: "Abdômen", obliquos: "Oblíquos", lombar: "Lombar",
  gluteo: "Glúteo", quadriceps: "Quadríceps", posterior: "Posterior de coxa", adutores: "Adutores",
  panturrilha: "Panturrilha",
};

// Grafias do catálogo (inglês do openGym e pt-BR), já normalizadas.
const SINONIMOS = {
  trapezio: ["trapezius", "traps", "trapezios", "levator scapulae", "elevador da escapula"],
  ombro: ["deltoids", "delts", "shoulders", "rear deltoids", "rotator cuff", "ombros", "deltoide", "deltoides", "manguito rotador"],
  peito: ["chest", "pectorals", "upper chest", "peitoral", "peitorais", "peitoral maior", "peitoral superior",
    "serratil", "serratus", "serratus anterior", "serratil anterior"],
  costas: ["upper back", "back", "lats", "latissimus dorsi", "rhomboids", "dorsal", "dorsais", "grande dorsal", "romboides", "parte superior das costas"],
  biceps: ["brachialis", "braquial"],
  triceps: [],
  antebraco: ["forearm", "forearms", "wrists", "wrist flexors", "wrist extensors", "grip muscles", "antebracos", "punhos", "flexores do punho", "extensores do punho"],
  abdomen: ["abs", "core", "abdominals", "lower abs", "abdominais", "abdominal", "reto abdominal"],
  obliquos: ["obliques", "obliquo"],
  lombar: ["lower back", "spine", "lombares", "parte baixa das costas", "eretores da espinha"],
  gluteo: ["gluteal", "glutes", "abductors", "gluteos", "gluteo maximo", "abdutores"],
  quadriceps: ["quads", "quadricep", "coxa", "coxas", "flexores quadril", "hip flexors", "flexores do quadril", "iliopsoas"],
  posterior: ["hamstring", "hamstrings", "isquiotibiais", "posteriores de coxa", "posterior de coxa", "posteriores"],
  adutores: ["adductors", "groin", "inner thighs", "adutor", "parte interna da coxa"],
  panturrilha: ["calves", "calf", "soleus", "soleo", "panturrilhas", "gastrocnemio",
    "tibial", "tibialis", "shins", "tibial anterior", "canelas", "canela"],
};

const normalizar = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

const POR_NOME = new Map();
for (const regiao of REGIOES) {
  POR_NOME.set(normalizar(regiao), regiao);
  for (const nome of SINONIMOS[regiao] || []) POR_NOME.set(normalizar(nome), regiao);
}

/** Nome do catálogo -> id da região, ou null se o mapa não desenha. */
export function regiaoDe(nome) {
  if (typeof nome !== "string") return null;
  return POR_NOME.get(normalizar(nome)) ?? null;
}

/** Id da região -> rótulo pt-BR. Id desconhecido volta como veio. */
export function rotuloDe(regiao) {
  return ROTULOS[regiao] ?? regiao;
}

const lista = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

/** Alvo vale 1, secundário vale `secundario` (0.5); quem aparece nos dois fica com o maior. */
export function intensidadesDoExercicio(alvo, secundarios, secundario = 0.5) {
  const saida = {};
  const por = (nomes, peso) => {
    for (const n of lista(nomes)) {
      const r = regiaoDe(n);
      if (r) saida[r] = Math.max(saida[r] ?? 0, peso);
    }
  };
  por(secundarios, secundario);
  por(alvo, 1);
  return saida;
}

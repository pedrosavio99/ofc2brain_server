/**
 * Ficha montada por REGRAS, sem rede. E o ultimo recurso quando Gemini e Groq
 * falham ou estao fora: melhor um treino conservador e explicado do que
 * ficar sem treino no meio da academia.
 *
 * Como ela decide, na ordem:
 * 1. Grupos: os que tem MENOS serie nos ultimos 14 dias entram primeiro
 *    (mesma conta do mapa do corpo, seriesPorGrupo).
 * 2. Exercicio: do catalogo abaixo, o primeiro que serve pro local. Em casa
 *    precisa existir aparelho cadastrado que cubra o grupo, senao o item seria
 *    descartado pela normalizarFicha.
 * 3. Nada que apareceu nos ultimos 3 dias, e nada que ja foi feito hoje.
 * 4. Restricao escrita no perfil corta o exercicio pela palavra.
 *
 * Tudo puro: da pra rodar sem banco e sem chave de API.
 */
import { seriesPorGrupo } from "./ficha.mjs";
import { hojeLocal } from "./banco.mjs";

/* Catalogo enxuto de proposito. Cada entrada diz onde serve:
   - tipos: tipos de aparelho de CASA que servem (vazio = nao serve em casa)
   - livre: true quando da pra fazer sem aparelho nenhum (academia, rua, casa sem nada)
   O nome e o que aparece na ficha; os grupos vao na ordem, principal primeiro. */
const CATALOGO = [
  // aquecimento (entra sempre que da, pra ficha nao comecar no peso)
  { nome: "Polichinelo", grupos: ["cardio"], tipos: [], livre: true, aquecimento: true,
    series: 2, medida: "tempo", duracao_min: 2, reps: "2 min" },
  { nome: "Mobilidade de ombro e quadril", grupos: ["corpo inteiro"], tipos: [], livre: true, aquecimento: true,
    series: 1, medida: "tempo", duracao_min: 3, reps: "3 min" },
  // peito
  { nome: "Flexão de braço", grupos: ["peito", "triceps"], tipos: [], livre: true, series: 3, reps: "10-15" },
  { nome: "Flexão com pés elevados", grupos: ["peito", "triceps"], tipos: [], livre: true, series: 3, reps: "8-12" },
  { nome: "Flexão diamante", grupos: ["peito", "triceps"], tipos: [], livre: true, series: 3, reps: "8-12" },
  { nome: "Supino com halteres", grupos: ["peito", "triceps"], tipos: ["peso_livre", "banco"], livre: false, series: 3, reps: "10-12" },
  { nome: "Supino reto", grupos: ["peito", "triceps"], tipos: ["maquina", "peso_livre"], livre: false, series: 3, reps: "8-12" },
  { nome: "Crucifixo com elástico", grupos: ["peito"], tipos: ["elastico"], livre: false, series: 3, reps: "12-15" },
  // costas
  { nome: "Remada curvada", grupos: ["costas", "biceps"], tipos: ["peso_livre", "kettlebell"], livre: false, series: 3, reps: "10-12" },
  { nome: "Remada com elástico", grupos: ["costas", "biceps"], tipos: ["elastico"], livre: false, series: 3, reps: "12-15" },
  { nome: "Puxada na polia", grupos: ["costas", "biceps"], tipos: ["maquina"], livre: false, series: 3, reps: "10-12" },
  { nome: "Remada invertida na barra baixa", grupos: ["costas", "biceps"], tipos: [], livre: true, series: 3, reps: "8-12" },
  { nome: "Remada unilateral com halter", grupos: ["costas", "biceps"], tipos: ["peso_livre", "kettlebell", "banco"], livre: false, series: 3, reps: "10 por lado" },
  { nome: "Pulldown com elástico", grupos: ["costas"], tipos: ["elastico"], livre: false, series: 3, reps: "12-15" },
  // ombro
  { nome: "Desenvolvimento com halteres", grupos: ["ombro", "triceps"], tipos: ["peso_livre"], livre: false, series: 3, reps: "10-12" },
  { nome: "Elevação lateral", grupos: ["ombro"], tipos: ["peso_livre", "elastico"], livre: false, series: 3, reps: "12-15" },
  { nome: "Flexão pique (pés elevados)", grupos: ["ombro", "triceps"], tipos: [], livre: true, series: 3, reps: "8-10" },
  { nome: "Elevação frontal", grupos: ["ombro"], tipos: ["peso_livre", "elastico"], livre: false, series: 3, reps: "12-15" },
  { nome: "Remada alta", grupos: ["ombro", "costas"], tipos: ["peso_livre", "kettlebell"], livre: false, series: 3, reps: "10-12" },
  // biceps
  { nome: "Rosca direta", grupos: ["biceps"], tipos: ["peso_livre", "elastico", "kettlebell"], livre: false, series: 3, reps: "10-12" },
  { nome: "Rosca martelo", grupos: ["biceps", "costas"], tipos: ["peso_livre"], livre: false, series: 3, reps: "10-12" },
  { nome: "Rosca concentrada", grupos: ["biceps"], tipos: ["peso_livre", "banco"], livre: false, series: 3, reps: "12 por lado" },
  // triceps
  { nome: "Tríceps testa", grupos: ["triceps"], tipos: ["peso_livre", "banco"], livre: false, series: 3, reps: "10-12" },
  { nome: "Mergulho no banco", grupos: ["triceps", "peito"], tipos: ["banco"], livre: true, series: 3, reps: "10-15" },
  { nome: "Tríceps francês unilateral", grupos: ["triceps"], tipos: ["peso_livre", "kettlebell"], livre: false, series: 3, reps: "12 por lado" },
  { nome: "Tríceps coice com elástico", grupos: ["triceps"], tipos: ["elastico"], livre: false, series: 3, reps: "12-15" },
  // perna e gluteo
  { nome: "Agachamento livre", grupos: ["perna", "gluteo"], tipos: [], livre: true, series: 4, reps: "12-15" },
  { nome: "Agachamento com peso", grupos: ["perna", "gluteo"], tipos: ["peso_livre", "kettlebell", "maquina"], livre: false, series: 3, reps: "10-12" },
  { nome: "Afundo alternado", grupos: ["perna", "gluteo"], tipos: [], livre: true, series: 3, reps: "10 por perna" },
  { nome: "Elevação de quadril", grupos: ["gluteo", "lombar"], tipos: [], livre: true, series: 3, reps: "12-15" },
  { nome: "Stiff", grupos: ["gluteo", "lombar", "perna"], tipos: ["peso_livre", "kettlebell"], livre: false, series: 3, reps: "10-12" },
  { nome: "Agachamento búlgaro", grupos: ["perna", "gluteo"], tipos: ["banco"], livre: true, series: 3, reps: "10 por perna" },
  { nome: "Ponte unilateral", grupos: ["gluteo", "lombar"], tipos: [], livre: true, series: 3, reps: "12 por lado" },
  { nome: "Levantamento terra com halteres", grupos: ["perna", "gluteo", "lombar"], tipos: ["peso_livre", "kettlebell"], livre: false, series: 3, reps: "8-10" },
  // panturrilha
  { nome: "Panturrilha em pé", grupos: ["panturrilha"], tipos: [], livre: true, series: 4, reps: "15-20" },
  // abdomen e lombar
  { nome: "Prancha", grupos: ["abdomen", "lombar"], tipos: [], livre: true, series: 3, medida: "tempo", duracao_min: 1, reps: "1 min" },
  { nome: "Abdominal remador", grupos: ["abdomen"], tipos: [], livre: true, series: 3, reps: "12-15" },
  { nome: "Abdominal bicicleta", grupos: ["abdomen"], tipos: [], livre: true, series: 3, reps: "20 alternados" },
  { nome: "Prancha lateral", grupos: ["abdomen"], tipos: [], livre: true, series: 2, medida: "tempo", duracao_min: 1, reps: "1 min por lado" },
  { nome: "Superman", grupos: ["lombar", "gluteo"], tipos: [], livre: true, series: 3, reps: "12-15" },
  // cardio
  { nome: "Corrida leve", grupos: ["cardio"], tipos: ["esteira"], livre: true, series: 1, medida: "tempo", duracao_min: 15, reps: "15 min" },
  { nome: "Bike moderada", grupos: ["cardio"], tipos: ["bike"], livre: false, series: 1, medida: "tempo", duracao_min: 15, reps: "15 min" },
  { nome: "Pular corda", grupos: ["cardio"], tipos: ["corda"], livre: false, series: 3, medida: "tempo", duracao_min: 3, reps: "3 min" },
];

/* Restricao escrita no perfil corta exercicio pela palavra. Conservador de
   proposito: na duvida tira, porque quem monta aqui nao e a IA e ninguem
   vai ler o texto da restricao alem de voce. */
const CORTES = [
  { termos: ["joelho"], nomes: ["Agachamento", "Afundo", "Corrida", "Pular corda"] },
  { termos: ["ombro", "manguito"], nomes: ["Desenvolvimento", "Elevação lateral", "Flexão pique"] },
  { termos: ["lombar", "coluna", "hernia", "hérnia"], nomes: ["Stiff", "Remada curvada", "Superman", "Agachamento com peso"] },
  { termos: ["punho"], nomes: ["Flexão", "Mergulho"] },
  { termos: ["tornozelo"], nomes: ["Corrida", "Pular corda", "Panturrilha", "Afundo"] },
];

const SEM_RODIZIO = ["cardio", "corpo inteiro"];

function semAcento(t) {
  return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Nomes usados nos ultimos N dias, pra nao repetir treino. Puro. */
export function nomesRecentes(sessoes, dias = 3, hoje = new Date()) {
  const base = new Date(hojeLocal(hoje) + "T12:00:00Z").getTime();
  const usados = new Set();
  for (const s of Array.isArray(sessoes) ? sessoes : []) {
    if (!s || !s.data) continue;
    const idade = Math.round((base - new Date(s.data + "T12:00:00Z").getTime()) / 86400000);
    if (idade < 0 || idade > dias) continue;
    (s.ficha || []).forEach((i) => usados.add(semAcento(i.nome)));
  }
  return usados;
}

/** Grupos na ordem de prioridade: menos serie nos 14 dias primeiro. Puro. */
export function prioridadeDosGrupos(sessoes) {
  const conta = seriesPorGrupo(sessoes);
  return Object.keys(conta)
    .filter((g) => !SEM_RODIZIO.includes(g))
    .sort((a, b) => conta[a] - conta[b] || a.localeCompare(b, "pt-BR"));
}

function cortadoPorRestricao(nome, restricoes) {
  const r = semAcento(restricoes);
  if (!r) return false;
  return CORTES.some((c) => c.termos.some((t) => r.includes(semAcento(t)))
    && c.nomes.some((n) => semAcento(nome).includes(semAcento(n))));
}

/** Aparelho cadastrado que serve pro exercicio (so em casa). */
function aparelhoPara(ex, equipamentos) {
  return (equipamentos || []).find((e) => ex.tipos.includes(String(e.tipo))) || null;
}

/* Numero estavel a partir de um texto: serve de semente pra variar a escolha
   sem sortear. Mesmo dia, mesma ficha; dia seguinte, outra. */
function semente(texto) {
  let n = 0;
  for (const c of String(texto)) n = (n * 31 + c.charCodeAt(0)) % 100000;
  return n;
}

/* Series e repeticoes conforme o nivel do perfil. Iniciante faz menos serie e
   mais repeticao; avancado o contrario. Sem nivel, fica como esta no catalogo. */
function ajustarVolume(ex, nivel) {
  const n = semAcento(nivel);
  if (n.includes("inicia")) return { series: Math.max(2, (ex.series || 3) - 1), reps: ex.reps };
  if (n.includes("avanc")) return { series: Math.min(5, (ex.series || 3) + 1), reps: ex.reps };
  return { series: ex.series || 3, reps: ex.reps };
}

function montarItem(ex, eq, onde, nivel) {
  const vol = ajustarVolume(ex, nivel);
  return {
    equipamento_id: eq ? eq.id : null,
    // exercicio de peso do corpo continua sendo peso do corpo na academia
    equipamento: eq ? eq.nome
      : (!ex.tipos.length ? "peso do corpo"
        : onde === "academia" ? "aparelho da academia" : "peso do corpo"),
    tipo: eq ? eq.tipo : (ex.tipos[0] || "peso_corporal"),
    nome: ex.nome,
    grupos: ex.grupos.slice(0, 3),
    series: vol.series,
    medida: ex.medida === "tempo" ? "tempo" : "reps",
    reps: vol.reps || "10-12",
    duracao_min: ex.medida === "tempo" ? ex.duracao_min : null,
    // descanso maior no composto pesado, menor no resto
    descanso_s: ex.series >= 4 || /Agachamento|Stiff|Supino|Remada/.test(ex.nome) ? 90 : 60,
    observacao: "",
  };
}

/**
 * A ficha por regras. Devolve no MESMO formato cru que o modelo devolveria,
 * pra seguir pelo normalizarFicha como qualquer outra.
 *
 * @param {object} o { equipamentos, sessoes, perfil, local, modo, feitosHoje, hoje }
 * @returns {{ motivo: string, ficha: object[] }}
 */
export function fichaPorRegras({ equipamentos = [], sessoes = [], perfil = {},
  local = "casa", modo = "dia", feitosHoje = [], hoje = new Date() } = {}) {
  const onde = String(local || "casa");
  const emCasa = onde === "casa";
  const alvo = modo === "extra" ? 3 : 5;

  const evitar = nomesRecentes(sessoes, 3, hoje);
  (feitosHoje || []).forEach((i) => evitar.add(semAcento(i.nome)));

  const usados = new Set();
  const itens = [];
  const gruposEntrando = [];

  // gira as alternativas do grupo conforme o dia: sem isso a ficha sem IA sai
  // sempre igual, que foi a reclamacao de quem viu a primeira versao
  const dia = hojeLocal(hoje);

  function candidatos(grupo) {
    const lista = CATALOGO.filter((e) => !e.aquecimento && e.grupos[0] === grupo);
    if (lista.length < 2) return lista;
    const corte = semente(dia + grupo) % lista.length;
    return lista.slice(corte).concat(lista.slice(0, corte));
  }

  function tentar(grupo, permitirRepetido) {
    for (const ex of candidatos(grupo)) {
      if (usados.has(ex.nome)) continue;
      if (!permitirRepetido && evitar.has(semAcento(ex.nome))) continue;
      if (cortadoPorRestricao(ex.nome, perfil.restricoes)) continue;

      const eq = emCasa ? aparelhoPara(ex, equipamentos) : null;
      // em casa, item sem aparelho cadastrado seria descartado depois
      if (emCasa && !eq) continue;
      if (!emCasa && !ex.livre && !ex.tipos.length) continue;
      // sem equipamento e ao ar livre: so o que da pra fazer sem nada
      if ((onde === "sem_equipamento" || onde === "ar_livre") && !ex.livre) continue;

      usados.add(ex.nome);
      itens.push(montarItem(ex, eq, onde, perfil.nivel));
      if (!gruposEntrando.includes(grupo)) gruposEntrando.push(grupo);
      return true;
    }
    return false;
  }

  /* Aquecimento primeiro, quando da: ficha que comeca no peso e o que mais
     faz o treino sem IA parecer lista solta. Em casa so entra se houver
     aparelho, senao a normalizarFicha descartaria. */
  if (modo !== "extra") {
    const aq = CATALOGO.filter((e) => e.aquecimento)
      .find((e) => !cortadoPorRestricao(e.nome, perfil.restricoes) && (!emCasa || aparelhoPara(e, equipamentos)));
    if (aq) {
      usados.add(aq.nome);
      itens.push(montarItem(aq, emCasa ? aparelhoPara(aq, equipamentos) : null, onde, perfil.nivel));
    }
  }

  const ordem = prioridadeDosGrupos(sessoes);
  for (const g of ordem) {
    if (itens.length >= alvo) break;
    tentar(g, false);
  }
  // faltou item (pouco aparelho, muita restricao): afrouxa o "nao repetir"
  for (const g of ordem) {
    if (itens.length >= alvo) break;
    tentar(g, true);
  }

  const motivo = itens.length
    ? "Ficha montada sem IA (nenhum modelo respondeu). Foco de hoje: " + gruposEntrando.join(", ") +
      ", os grupos com menos série nos últimos 14 dias. Os exercícios giram a cada dia e nenhum repete " +
      "o que você fez nos últimos 3 dias. " +
      (semAcento(perfil.nivel || "").includes("inicia") ? "Volume reduzido pelo nível iniciante do perfil. "
        : semAcento(perfil.nivel || "").includes("avanc") ? "Volume um pouco maior pelo nível avançado do perfil. " : "") +
      "Ajuste o peso pelo que você sente. " +
      (perfil.restricoes ? "Tirei o que conflita com: " + String(perfil.restricoes).slice(0, 120) + "." : "")
    : "";

  return { motivo, ficha: itens };
}

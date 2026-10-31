/* Modulo TREINO - foto de exemplo de cada exercicio da ficha.
 *
 * Recebe: a ficha ja pintada na tela (#tela). Cada linha .tr-ex traz o nome do
 *   exercicio, os grupos (.tr-ex-meta em) e o equipamento (.tr-ex-equip).
 * Faz: acha no indice (exercicio-foto-indice.js, free-exercise-db, dominio
 *   publico) a foto do movimento mais parecido, poe uma miniatura ao lado do
 *   exercicio e, ao tocar nela, abre um modal pequeno com as duas fotos
 *   (inicio e fim) e o mapa do corpo com os musculos do exercicio.
 * Nao faz: mexer na ficha, no servidor ou no toque da linha (marcar feito). A
 *   linha continua igual; sem foto, ela fica como era.
 *
 * Como casa: o nome vem em portugues e o indice em ingles. A tabela REGRAS
 *   traduz o movimento ("supino" vira "press", "elevacao lateral" vira
 *   "lateral raise"), o equipamento (halter, barra, polia...) e o musculo do
 *   grupo dao desempate. Se nenhum movimento do nome for reconhecido, vale a
 *   foto-padrao do grupo com o mesmo equipamento. O modal avisa quando a foto
 *   e de um movimento parecido e nao do exercicio exato.
 *
 * A parte de casamento (primeira metade) e pura: sem DOM, sem rede. Fica em
 *   window.TreinoFoto.casar(nome, grupos, equipamento) e, em Node, em module.exports.
 */
(function (raiz) {
  "use strict";

  /* ------------------------------------------------------------ texto */

  /* Minusculo e sem acento. So para comparar, nunca para mostrar. */
  function sem(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  /* Palavras do indice, em ingles: variantes que o dado escreve de jeitos diferentes viram uma so. */
  var CANON_EN = [
    [/\bpush[\s-]?ups?\b/g, "pushup"], [/\bpull[\s-]?ups?\b/g, "pullup"], [/\bchin[\s-]?ups?\b/g, "chinup"],
    [/\bsit[\s-]?ups?\b/g, "situp"], [/\bstep[\s-]?ups?\b/g, "stepup"], [/\bv[\s-]?ups?\b/g, "vup"],
    [/\bget[\s-]?ups?\b/g, "getup"], [/\bdb\b/g, "dumbbell"], [/\bkb\b/g, "kettlebell"], [/\be[\s-]?z\b/g, "ez"],
    [/\bflyes?\b|\bflys\b|\bflies\b/g, "fly"], [/\bbicep\b/g, "biceps"], [/\btricep\b/g, "triceps"],
    [/\blegged\b/g, "leg"], [/\bcalves\b/g, "calf"], [/\bglutes?\b/g, "glute"], [/\bwalking\b/g, "walk"],
  ];
  /* Palavras sem peso na comparacao (conectivos e equipamento, que tem conta propria). */
  var NEUTRAS = {
    the: 1, a: 1, an: 1, with: 1, and: 1, of: 1, on: 1, to: 1, for: 1, in: 1, off: 1, from: 1, into: 1, at: 1, by: 1,
    barbell: 1, dumbbell: 1, cable: 1, machine: 1, kettlebell: 1, band: 1, ez: 1, bar: 1, bodyweight: 1,
    exercise: 1, medicine: 1, ball: 1, smith: 1, weighted: 1, grip: 1, medium: 1, position: 1, version: 1,
  };
  var PROTEGIDAS = { biceps: 1, triceps: 1, abs: 1, press: 1, bus: 1, gas: 1, plus: 1, lats: 1 };

  function singular(p) {
    if (p.length <= 3 || PROTEGIDAS[p]) return p;
    if (/ies$/.test(p)) return p.slice(0, -3) + "y";
    if (/(sses|ches|shes|xes)$/.test(p)) return p.slice(0, -2);
    if (/[^s]s$/.test(p) && !/(us|is)$/.test(p)) return p.slice(0, -1);
    return p;
  }

  /* Texto em ingles -> lista de palavras unicas, ja no formato do indice. */
  function palavrasEn(texto) {
    var t = sem(texto);
    CANON_EN.forEach(function (c) { t = t.replace(c[0], c[1]); });
    var vistas = {}, saida = [];
    t.replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (p) {
      if (!p) return;
      p = singular(p);
      if (!vistas[p]) { vistas[p] = 1; saida.push(p); }
    });
    return saida;
  }

  /* ------------------------------------------------------------ vocabulario */

  var C = 3;      // peso do movimento: o que define o exercicio
  var F = 2.5;    // detalhe que muda o exercicio (inclinado, declinado)
  var M = 1.2;    // detalhe que so ajusta (sentado, alternado, pegada)

  /* Uma ranhura de busca: S(peso, "alternativa 1", "alternativa 2"). Vale a melhor alternativa. */
  function S(peso) { return { alts: Array.prototype.slice.call(arguments, 1), w: peso }; }
  /* Uma regra: se o nome (sem acento) casa com `re`, soma estas ranhuras. `o.fam` e o equipamento que o
     proprio nome ja diz; `o.ap` marca foto que so se parece ("polichinelo" -> pular corda); `o.alo` e alongamento. */
  function R(re, slots, o) { return { re: re, slots: slots, fam: o && o.fam, ap: !!(o && o.ap), alo: !!(o && o.alo) }; }

  /* Do mais especifico para o mais geral: o trecho que casa sai do nome, entao "remada curvada"
     nao conta tambem como "remada". */
  var REGRAS = [
    // ---- cardio e pecas de nome proprio
    R(/\b(pular corda|corda de pular|pulo de corda|rope jumping|jump rope|skipping)\b/, [S(C, "rope jumping")]),
    R(/\b(polichinelo|jumping jacks?)\b/, [S(C, "rope jumping", "scissors jump")], { ap: true }),
    R(/\b(burpees?)\b/, [S(C, "freehand jump squat", "jump squat")], { ap: true }),
    R(/\b(mountain climbers?|escaladores?|escalador)\b/, [S(C, "mountain climber")]),
    R(/\b(corrida|correr|trote|jogging|running|sprint)\b/, [S(C, "running treadmill", "jogging treadmill")]),
    R(/\b(caminhada|andar rapido|walking)\b/, [S(C, "walk treadmill", "trail running walk")]),
    R(/\b(bicicleta ergometrica|bike|spinning|ciclismo|pedalar|bicycling|stationary bike)\b/, [S(C, "bicycling stationary", "recumbent bike", "bicycling")]),
    R(/\b(eliptico|elliptical)\b/, [S(C, "elliptical trainer")]),
    R(/\b(escada|stairmaster|stair climber|step mill)\b/, [S(C, "stairmaster", "step mill")]),
    R(/\b(remo ergometro|remo indoor|remo seco|ergometro|rowing)\b/, [S(C, "rowing stationary")]),
    R(/\b(esteira)\b/, [S(C, "running treadmill", "walk treadmill")]),
    R(/\b(salto (na|no|em|sobre) (a )?(caixa|banco|step)|box jump|pulo (na|no) (caixa|banco))\b/, [S(C, "box jump")]),
    R(/\b(swing)\b/, [S(C, "kettlebell swing")], { fam: "kettlebell" }),
    R(/\b(turkish|levantamento turco|get[- ]?up)\b/, [S(C, "kettlebell turkish getup")]),
    R(/\b(caminhada do fazendeiro|passeio do fazendeiro|farmers? walk)\b/, [S(C, "farmer walk")]),
    R(/\b(thruster)\b/, [S(C, "thruster")]),

    // ---- mobilidade e alongamento
    R(/\b(mobilidade|rotacao|circulos?)\b.*\bombros?\b|\barm circles?\b|\bcirculos? (de|com) bracos?\b/, [S(C, "arm circle")], { ap: true }),
    R(/\b(mobilidade|rotacao|circulos?)\b.*\bquadril\b|\bhip circles?\b/, [S(C, "hip circle")], { ap: true }),
    R(/\b(mobilidade|aquecimento articular)\b/, [S(C, "arm circle", "hip circle")], { ap: true }),
    R(/\b(alongamento|alongar|stretch|stretching)\b/, [S(C, "stretch")], { alo: true }),

    // ---- aparelhos de perna (antes de braco: "leg curl" nao e rosca)
    R(/\b(panturrilha|gemeos?|calf|calves)\b.*\b(leg press)\b|\bcalf press\b/, [S(C, "calf press")], { fam: "maquina" }),
    R(/\b(leg press|leg 45|press de pernas|press 45|pressao de pernas)\b/, [S(C, "leg press")], { fam: "maquina" }),
    R(/\b(cadeira extensora|extensora|extensao de pernas?|extensao de joelhos?|leg extension)\b/, [S(C, "leg extension")], { fam: "maquina" }),
    R(/\b(cadeira flexora|seated leg curl)\b/, [S(C, "seated leg curl", "leg curl")], { fam: "maquina" }),
    R(/\b(mesa flexora|flexora|flexao de pernas?|flexao de joelhos?|leg curl)\b/, [S(C, "lying leg curl", "leg curl")], { fam: "maquina" }),
    R(/\b(cadeira abdutora|abdutora|abducao( de quadril)?|hip abduction)\b/, [S(C, "abductor", "hip abduction")], { fam: "maquina" }),
    R(/\b(cadeira adutora|adutora|aducao|adductor)\b/, [S(C, "adductor")], { fam: "maquina" }),

    // ---- abdomen e core
    R(/\bprancha\b.*\blateral\b|\bprancha lateral\b|\bside plank\b/, [S(C, "side bridge", "side plank")]),
    R(/\b(prancha|plank)\b/, [S(C, "plank")]),
    R(/\b(russian twists?|rotacao russa|torcao russa)\b/, [S(C, "russian twist")]),
    R(/\b(dead bug)\b/, [S(C, "dead bug")]),
    R(/\babdominal\b.*\b(remador|canivete)\b|\bcanivete\b|\bv[- ]?up\b/, [S(C, "vup", "jackknife situp")]),
    R(/\b(roda abdominal|ab wheel|ab roller|rolo abdominal)\b|\babdominal (com|na) roda\b/, [S(C, "ab roller", "ab rollout")]),
    R(/\babdominal\b.*\b(polia|cabo|corda)\b|\bcrunch (na|no) (polia|cabo)\b|\bcable crunch\b/, [S(C, "cable crunch")], { fam: "cabo" }),
    R(/\babdominal\b.*\bbicicleta\b|\bbicycle crunch\b/, [S(C, "air bike", "bicycle crunch", "crunch")]),
    R(/\babdominal\b.*\bobliquo\b|\bobliquos?\b|\boblique\b/, [S(C, "oblique crunch")]),
    R(/\babdominal\b.*\b(infra|inferior)\b|\binfra\b|\breverse crunch\b/, [S(C, "reverse crunch", "leg raise")]),
    R(/\b(abdominal completo|abdominal tradicional|abdominal total|sit[- ]?up)\b/, [S(C, "situp", "crunch")]),
    R(/\belevacao (de|das|dos) (pernas?)\b|\bleg raise\b|\belevacao de pernas\b/, [S(C, "leg raise")]),
    R(/\belevacao (de|dos) joelhos?\b|\bknee raise\b|\bknee tuck\b/, [S(C, "knee raise", "hanging leg raise")]),
    R(/\b(abdominal|abdominais|crunch|supra)\b/, [S(C, "crunch")]),

    // ---- peito
    R(/\bsupino\b.*\b(fechad[oa]|pegada fechada)\b|\bclose grip bench\b/, [S(C, "close grip bench press")]),
    R(/\b(voador|peck ?deck|butterfly|fly (na|no) maquina|crucifixo (na |no |em )?(maquina|aparelho)|peitoral (na|no) (maquina|aparelho))\b/, [S(C, "butterfly")], { fam: "maquina" }),
    R(/\b(crossover|cross over|cruzamento (de|da|na|no|com) (polia|cabo)|cruzamento de cabos?)\b/, [S(C, "cable crossover")], { fam: "cabo" }),
    R(/\bcrucifixo\b.*\b(invertid[oa]|inverso)\b|\b(invertid[oa]|inverso)\b.*\bcrucifixo\b|\breverse fly\b|\bdeltoide posterior\b|\brear delt\b|\belevacao posterior\b/, [S(C, "reverse fly", "rear delt fly", "rear delt raise", "rear lateral raise")]),
    R(/\b(crucifixo|fly|flye)\b/, [S(C, "fly")]),
    R(/\b(pullover|pull over)\b/, [S(C, "pullover")]),
    R(/\b(flexao pique|pike push|handstand push)\b/, [S(C, "handstand pushup", "pushup")]),
    R(/\bflexao\b.*\b(diamante|fechad[oa]|triceps)\b|\bdiamond push/, [S(C, "pushup"), S(F, "close", "triceps")]),
    R(/\bflexao\b.*\b(pes elevados|pes no banco|declinad[oa])\b|\bflexao declinada\b/, [S(C, "pushup"), S(F, "decline", "feet elevated")]),
    R(/\b(flexao|flexoes|push[- ]?ups?|apoio de frente)\b/, [S(C, "pushup")]),
    R(/\b(peitoral (na|no) (maquina|aparelho)|chest press|supino (na|no) (maquina|aparelho)|supino maquina)\b/, [S(C, "chest press", "machine bench press")], { fam: "maquina" }),
    R(/\bsupino\b/, [S(C, "press"), S(0.5, "bench")]),
    R(/\b(mergulho|paralelas?|dips?)\b.*\bbanco\b|\bbanco\b.*\b(mergulho|dips?)\b|\btriceps (no|em) banco\b|\bbench dips?\b/, [S(C, "bench dip")]),
    R(/\b(paralelas?|parallel bar)\b/, [S(C, "parallel bar dip", "dip")]),
    R(/\b(mergulho|dips?)\b/, [S(C, "dip"), S(M, "version")]),

    // ---- costas
    R(/\b(barra fixa|pull ?ups?|pullups?)\b.*\b(supinad[oa]|chin)\b|\bchin ?ups?\b|\bbarra supinada\b/, [S(C, "chinup")]),
    R(/\b(barra fixa|pull ?ups?|pullups?|graviton)\b/, [S(C, "pullup")]),
    R(/\bremada\b.*\bbarra (baixa|fixa)\b|\bremada invertida\b|\binverted row\b|\bremada australiana\b/, [S(C, "inverted row")]),
    R(/\bremada\b.*\b(unilateral|serrote|um braco)\b|\bserrote\b|\bone arm row\b/, [S(C, "one arm row")]),
    R(/\bremada\b.*\b(cavalinho|t[- ]?bar|barra t)\b|\bt[- ]?bar\b/, [S(C, "t bar row")]),
    R(/\bremada\b.*\balta\b|\bremada alta\b|\bupright row\b/, [S(C, "upright row")]),
    R(/\bremada\b.*\b(curvada|inclinada|pronada)\b|\bbent over row\b/, [S(C, "bent over row")]),
    R(/\bremada\b.*\b(maquina|articulada|iso ?lateral|aparelho)\b/, [S(C, "leverage iso row", "leverage high row")], { fam: "maquina" }),
    R(/\bremada\b.*\b(baixa|sentada|polia|cabo|triangulo|pulley)\b|\bseated row\b|\bcable row\b/, [S(C, "seated cable row")]),
    R(/\b(remada|row)\b/, [S(C, "seated cable row", "row")]),
    R(/\b(puxada|puxador|pulldown|pull down|pulley (frente|costas))\b.*\b(braco reto|bracos retos|bracos estendidos|reto)\b|\bstraight arm pulldown\b/, [S(C, "straight arm pulldown")]),
    R(/\b(puxada|puxador|pulldown|pull down|lat pull)\b/, [S(C, "lat pulldown", "pulldown")], { fam: "cabo" }),
    R(/\b(face ?pull)\b/, [S(C, "face pull")]),
    R(/\b(encolhimento|shrug)\b/, [S(C, "shrug")]),
    R(/\b(hiperextensao|extensao (de )?lombar|extensao de tronco|banco romano|cadeira romana|back extension|lombar (na|no) (maquina|banco))\b/, [S(C, "hyperextension back extension", "hyperextension")]),
    R(/\b(bom dia|good morning)\b/, [S(C, "good morning")]),
    R(/\b(superman)\b/, [S(C, "superman")]),

    // ---- ombro
    R(/\b(desenvolvimento )?(de |do |com )?arnold( press)?\b/, [S(C, "arnold press")]),
    R(/\bdesenvolvimento\b.*\bmilitar\b|\bmilitar\b|\bmilitary press\b/, [S(C, "military press")]),
    R(/\bdesenvolvimento\b.*\b(maquina|aparelho)\b|\bshoulder press (na|no) maquina\b/, [S(C, "machine shoulder press", "leverage shoulder press")], { fam: "maquina" }),
    R(/\b(desenvolvimento|shoulder press|overhead press|press (acima|sobre) da cabeca|press de ombro)\b/, [S(C, "shoulder press")]),
    R(/\b(elevacao lateral|lateral raise|abertura lateral|voo lateral)\b/, [S(C, "lateral raise")]),
    R(/\b(elevacao frontal|front raise)\b/, [S(C, "front raise")]),

    // ---- bracos
    R(/\brosca\b.*\bmartelo\b|\bmartelo\b|\bhammer curl\b/, [S(C, "hammer curl")]),
    R(/\brosca\b.*\bconcentrad[oa]\b|\bconcentration curl\b/, [S(C, "concentration curl")]),
    R(/\brosca\b.*\b(scott|predicador)\b|\bscott\b|\bpreacher\b/, [S(C, "preacher curl")]),
    R(/\brosca\b.*\b(inversa|invertida|pronada)\b|\breverse curl\b/, [S(C, "reverse curl")]),
    R(/\b(rolo de antebraco|wrist roller)\b/, [S(C, "wrist roller", "wrist curl")]),
    R(/\brosca\b.*\bpunho\b|\brosca de punho\b|\bwrist curl\b|\bpunho\b/, [S(C, "wrist curl")]),
    R(/\b(rosca|curl)\b/, [S(C, "curl"), S(0.6, "biceps")]),
    R(/\btriceps\b.*\b(testa)\b|\btesta\b|\bskull ?crusher\b|\blying triceps\b/, [S(C, "lying triceps extension", "lying triceps press", "ez bar skullcrusher")]),
    R(/\btriceps\b.*\b(corda|polia|pulley|pushdown|puxador|barra v)\b|\bpushdown\b|\btriceps (na|no) (polia|cabo)\b|\btriceps corda\b/, [S(C, "triceps pushdown")], { fam: "cabo" }),
    R(/\btriceps\b.*\b(frances|francesa|overhead|acima da cabeca|atras da cabeca)\b|\b(frances|francesa)\b/, [S(C, "overhead triceps extension", "standing dumbbell triceps extension")]),
    R(/\btriceps\b.*\b(coice|kickback)\b|\btriceps (coice|kickback)\b/, [S(C, "triceps kickback")]),
    R(/\b(coice|kickback|donkey kick|gluteo (na|no) (polia|cabo)|quatro apoios|4 apoios)\b/, [S(C, "glute kickback", "kickback")]),
    R(/\bextensao de triceps\b|\btriceps extension\b/, [S(C, "triceps extension")]),

    // ---- pernas e gluteos
    R(/\b(levantamento terra|terra|deadlift)\b.*\b(romeno|romanian)\b|\b(romeno|romanian)\b/, [S(C, "romanian deadlift")]),
    R(/\b(stiff|pernas? estendidas?|pernas? retas?|stiff leg)\b/, [S(C, "stiff leg deadlift")]),
    R(/\b(levantamento terra|terra|deadlift)\b.*\bsumo\b|\bsumo deadlift\b|\bterra sumo\b/, [S(C, "sumo deadlift")]),
    R(/\b(levantamento terra|terra|deadlift)\b/, [S(C, "deadlift")]),
    R(/\bagachamento\b.*\b(sumo)\b|\bsumo\b|\bplie\b/, [S(C, "plie squat", "sumo squat")]),
    R(/\b(agachamento|afundo)\b.*\b(bulgaro)\b|\bbulgaro\b|\bsplit squat\b|\bagachamento unilateral\b/, [S(C, "split squat", "single leg squat", "one leg squat")]),
    R(/\bagachamento\b.*\b(frontal)\b|\bfront squat\b/, [S(C, "front squat")]),
    R(/\bgoblet\b|\bagachamento\b.*\b(taca|copa)\b/, [S(C, "goblet squat")]),
    R(/\bhack\b/, [S(C, "hack squat")], { fam: "maquina" }),
    R(/\bagachamento\b.*\b(salto|saltando|pulo|pliometrico)\b|\bjump squat\b/, [S(C, "jump squat")]),
    R(/\b(pistol)\b/, [S(C, "pistol squat")]),
    R(/\bagachamento\b.*\b(smith)\b|\bsmith\b/, [S(C, "squat"), S(M, "smith")], { fam: "maquina" }),
    R(/\bagachamento livre\b/, [S(C, "squat")], { fam: "corpo-fraco" }),
    R(/\b(agachamento|squat)\b/, [S(C, "squat")]),
    R(/\b(step ?ups?|subida (no|na|em) (banco|step|caixa|degrau))\b/, [S(C, "stepup")]),
    R(/\b(afundo|avanco|passada|lunges?|passo a frente)\b/, [S(C, "lunge")]),
    R(/\b(elevacao pelvica|hip thrust)\b/, [S(C, "hip thrust")]),
    R(/\b(elevacao de quadril|ponte|glute bridge)\b/, [S(C, "butt lift bridge", "glute bridge", "bridge")]),
    R(/\b(panturrilha|gemeos?|calf|calves)\b/, [S(C, "calf raise")]),

    // ---- por ultimo, so o musculo
    R(/\btriceps\b/, [S(1, "triceps")]),
    R(/\bbiceps\b/, [S(1, "biceps")]),
  ];

  /* Detalhes que valem em qualquer exercicio. Mais fracos que o movimento. */
  var DETALHES = [
    [/\binclinad[oa]s?\b|\bincline\b/, [S(F, "incline")]],
    [/\bdeclinad[oa]s?\b|\bdecline\b/, [S(F, "decline")]],
    [/\bunilateral\b|\bum braco\b|\bsingle arm\b|\bone arm\b/, [S(M, "one arm", "single arm"), S(0.6, "one leg", "single leg")]],
    [/\bcom (peso|carga|anilha)s?\b/, [S(M, "dumbbell", "barbell", "goblet")]],
    [/\buma perna\b|\bunipodal\b|\bone leg\b|\bsingle leg\b/, [S(M, "one leg", "single leg")]],
    [/\balternad[oa]s?\b|\balternate\b|\balternating\b/, [S(M, "alternate", "alternating")]],
    [/\bsentad[oa]s?\b|\bseated\b/, [S(M, "seated")]],
    [/\b(em pe|de pe|standing)\b/, [S(M, "standing")]],
    [/\b(deitad[oa]s?|lying)\b/, [S(M, "lying")]],
    [/\bajoelhad[oa]s?\b|\bkneeling\b/, [S(M, "kneeling")]],
    [/\b(caminhando|andando|walking)\b/, [S(M, "walk")]],
    [/\b(reverso|reversa|para tras|reverse)\b/, [S(M, "reverse", "rear")]],
    [/\b(aberta|pegada aberta|ampla|wide)\b/, [S(M, "wide")]],
    [/\b(pegada fechada|triangulo)\b/, [S(M, "close")]],
    [/\b(supinada|supinado|underhand)\b/, [S(M, "underhand", "reverse")]],
    [/\b(pronada|pronado|overhand)\b/, [S(M, "overhand")]],
    [/\b(neutra|neutro)\b/, [S(M, "neutral")]],
    [/\b(suspens[oa]|hanging)\b/, [S(M, "hanging")]],
  ];

  /* "Barra fixa" e peso do corpo; so a "barra" sozinha e a de peso. */
  function corrigirBarra(t) { return t.replace(/\bbarra (fixa|de apoio|baixa|alta|horizontal|paralela)\b/g, " peso do corpo "); }

  /* O mesmo equipamento escrito de varios jeitos -> familia. Barra fixa nao e barra de peso (as regras de cima ja a consumiram). */
  var EQUIPAMENTOS = [
    ["ez", /\b(barra ez|barra w|barra amanteigada|ez bar|ez)\b/],
    ["halter", /\b(halteres?|halter|dumbbells?|dumbells?|dumbell)\b/],
    ["kettlebell", /\b(kettlebells?|kettlebel|chaleira)\b/],
    ["cabo", /\b(polias?|cabos?|cable|cables|pulley|corda|crossover)\b/],
    ["maquina", /\b(maquinas?|aparelhos?|articulad[oa]|smith|hammer|leverage|convergente|peck deck|leg press)\b/],
    ["banda", /\b(elasticos?|faixas?|mini ?bands?|bands?|theraband|tubing|tubos? elasticos?)\b/],
    ["bola", /\b(bola suica|bola de pilates|bola medicinal|bola|swiss ball|bosu|medicine ball|exercise ball)\b/],
    ["barra", /\b(barras?|barbell|barbells|anilhas?)\b/],
    ["corpo", /\b(peso do corpo|peso corporal|corporal|calistenia|sem equipamentos?|sem pesos?|sem carga|body ?weight|bodyweight|body only)\b/],
  ];

  /* Famílias do indice (campo "equipamento" do free-exercise-db). */
  var FAMILIA_INDICE = {
    "barbell": "barra", "dumbbell": "halter", "cable": "cabo", "machine": "maquina", "kettlebells": "kettlebell",
    "bands": "banda", "e-z curl bar": "ez", "medicine ball": "bola", "exercise ball": "bola", "body only": "corpo",
    "foam roll": "rolo", "other": "outro", "": "indef",
  };

  /* Grupo do app -> musculos do indice. O primeiro grupo da ficha e o principal. */
  var MUSCULOS_DO_GRUPO = {
    peito: ["chest"], costas: ["lats", "middle back", "traps"], ombro: ["shoulders"], biceps: ["biceps"],
    triceps: ["triceps"], perna: ["quadriceps", "hamstrings", "adductors", "abductors"], gluteo: ["glutes"],
    panturrilha: ["calves"], abdomen: ["abdominals"], lombar: ["lower back"], antebraco: ["forearms"],
  };

  /* Foto-padrao de cada grupo por equipamento, para quando o nome nao diz nada reconhecivel.
     Ids do free-exercise-db. "_" vale para qualquer equipamento sem entrada propria. */
  var PADRAO = {
    peito: { halter: "Dumbbell_Bench_Press", barra: "Barbell_Bench_Press_-_Medium_Grip", cabo: "Cable_Crossover", maquina: "Butterfly", banda: "Bench_Press_-_With_Bands", _: "Pushups" },
    costas: { halter: "One-Arm_Dumbbell_Row", barra: "Bent_Over_Barbell_Row", cabo: "Seated_Cable_Rows", maquina: "Wide-Grip_Lat_Pulldown", banda: "Seated_Cable_Rows", _: "Pullups" },
    ombro: { halter: "Side_Lateral_Raise", barra: "Standing_Military_Press", cabo: "Face_Pull", maquina: "Leverage_Shoulder_Press", banda: "Lateral_Raise_-_With_Bands", _: "Side_Lateral_Raise" },
    biceps: { halter: "Dumbbell_Bicep_Curl", barra: "Barbell_Curl", ez: "EZ-Bar_Curl", cabo: "High_Cable_Curls", maquina: "Machine_Bicep_Curl", _: "Dumbbell_Bicep_Curl" },
    triceps: { halter: "Standing_Dumbbell_Triceps_Extension", barra: "Standing_Overhead_Barbell_Triceps_Extension", cabo: "Triceps_Pushdown", maquina: "Machine_Triceps_Extension", banda: "Speed_Band_Overhead_Triceps", corpo: "Bench_Dips", _: "Bench_Dips" },
    perna: { halter: "Dumbbell_Squat", barra: "Barbell_Squat", kettlebell: "Goblet_Squat", maquina: "Leg_Press", corpo: "Bodyweight_Squat", _: "Bodyweight_Squat" },
    gluteo: { barra: "Barbell_Hip_Thrust", halter: "Single_Leg_Glute_Bridge", cabo: "Glute_Kickback", maquina: "Glute_Kickback", _: "Butt_Lift_Bridge" },
    panturrilha: { halter: "Standing_Dumbbell_Calf_Raise", barra: "Standing_Barbell_Calf_Raise", maquina: "Standing_Calf_Raises", _: "Standing_Calf_Raises" },
    abdomen: { cabo: "Cable_Crunch", maquina: "Ab_Crunch_Machine", bola: "Exercise_Ball_Crunch", _: "Crunches" },
    lombar: { halter: "Good_Morning", barra: "Good_Morning", _: "Superman" },
    antebraco: { _: "Seated_Palm-Up_Barbell_Wrist_Curl" },
    cardio: { corda: "Rope_Jumping", _: "Running_Treadmill" },
    "corpo inteiro": { _: "Arm_Circles" },
  };

  var PALAVRAS_PT_SEM_PESO = {
    de: 1, da: 1, do: 1, das: 1, dos: 1, com: 1, sem: 1, na: 1, no: 1, nas: 1, nos: 1, em: 1, para: 1, e: 1, a: 1,
    o: 1, as: 1, os: 1, um: 1, uma: 1, por: 1, ao: 1, pelo: 1, pela: 1, lado: 1, cada: 1, ate: 1, ou: 1, x: 1, kg: 1,
  };

  /* ------------------------------------------------------------ indice */

  var IDX = null;   // { base, itens: [...], porId, vocabulario }

  function prepararIndice(bruto) {
    var itens = (bruto && bruto.itens) || [];
    var voc = {};
    var lista = itens.map(function (r) {
      var palavras = palavrasEn(r[1]);
      palavras.forEach(function (p) { voc[p] = 1; });
      var tok = {};
      palavras.forEach(function (p) { tok[p] = 1; });
      return {
        id: r[0], nome: r[1], tok: tok, n: palavras.length,
        extras: palavras.filter(function (p) { return !NEUTRAS[p]; }),
        fam: FAMILIA_INDICE[String(r[2] || "").toLowerCase()] || "indef",
        mus: r[3] || [], mus2: r[4] || [], cat: r[5] || "",
      };
    });
    var porId = {};
    lista.forEach(function (c) { porId[c.id] = c; });
    return { base: bruto.base, itens: lista, porId: porId, vocabulario: voc };
  }

  function usarIndice(bruto) { IDX = prepararIndice(bruto); return IDX; }

  /* ------------------------------------------------------------ consulta */

  function alternativas(textos) {
    return textos.map(function (t) { return palavrasEn(t); });
  }

  /* O nome em portugues vira uma consulta: ranhuras (o que procurar), familia de equipamento e flags. */
  function entender(nome, grupos, equipamento) {
    var n = " " + sem(nome).replace(/[()\[\]\/,;:+]/g, " ").replace(/\b\d+([.,]\d+)?\s*(kg|lbs?|x|reps?|series|graus)?\b/g, " ").replace(/\s+/g, " ") + " ";
    var q = { slots: [], fam: null, famRegra: null, famFraca: null, ap: false, alo: false, grupos: grupos || [], sobra: [] };

    REGRAS.forEach(function (r) {
      var m = r.re.exec(n);
      if (!m) return;
      r.slots.forEach(function (s) { q.slots.push({ alts: alternativas(s.alts), w: s.w }); });
      if (r.fam === "corpo-fraco") q.famFraca = "corpo";
      else if (r.fam && !q.famRegra) q.famRegra = r.fam;
      if (r.ap) q.ap = true;
      if (r.alo) q.alo = true;
      n = n.replace(r.re, " ");
    });
    DETALHES.forEach(function (d) {
      if (!d[0].test(n)) return;
      d[1].forEach(function (s) { q.slots.push({ alts: alternativas(s.alts), w: s.w }); });
      n = n.replace(d[0], " ");
    });

    // equipamento: o que o nome diz vale mais que o campo do aparelho
    n = corrigirBarra(n);
    var famNome = null;
    EQUIPAMENTOS.forEach(function (e) {
      if (!famNome && e[1].test(n)) { famNome = e[0]; }
      n = n.replace(e[1], " ");
    });
    var famCampo = null;
    var eq = corrigirBarra(" " + sem(equipamento) + " ");
    EQUIPAMENTOS.forEach(function (e) { if (!famCampo && e[1].test(eq)) famCampo = e[0]; });
    // aparelho que a regra ja sabe (polia, maquina) vale mais que "barra" solta no nome: "pulley com barra reta" e polia
    if ((famNome === "barra" || famNome === "ez") && (q.famRegra === "cabo" || q.famRegra === "maquina")) famNome = q.famRegra;
    q.fam = famNome || q.famRegra || famCampo || q.famFraca;
    q.famForte = !!(famNome || q.famRegra);   // dito no nome: errar o aparelho pesa mais

    // o que sobrou: palavra que o indice conhece (nome em ingles, "hip thrust") entra como esta
    var sobra = [];
    palavrasEn(n).forEach(function (p) {
      if (PALAVRAS_PT_SEM_PESO[p] || NEUTRAS[p] || p.length < 3) return;
      if (IDX && IDX.vocabulario[p]) sobra.push(p);
    });
    if (sobra.length) {
      var temMovimento = q.slots.some(function (s) { return s.w >= C; });
      q.slots.push({ alts: [sobra], w: temMovimento ? 1.5 : C, sobra: true }); q.sobra = sobra;
    }

    // musculos do grupo: principal primeiro
    q.musPrincipal = []; q.musOutros = [];
    (grupos || []).forEach(function (g, i) {
      (MUSCULOS_DO_GRUPO[g] || []).forEach(function (m) { (i === 0 ? q.musPrincipal : q.musOutros).push(m); });
    });
    return q;
  }

  function cruza(lista, alvo) {
    for (var i = 0; i < lista.length; i++) if (alvo.indexOf(lista[i]) >= 0) return true;
    return false;
  }

  /* Pares quase iguais para quem treina: a foto serve e nao deve ser tratada como erro. */
  var PARENTES = {
    "ez|barra": 1.2, "barra|ez": 1.0, "halter|kettlebell": 0.8, "kettlebell|halter": 0.8,
    "maquina|cabo": 0.6, "cabo|maquina": 0.6, "banda|cabo": 0.6,
  };
  function compativel(fq, fc) {
    if (!fq) return 0;
    if (fc === fq) return 2.2;
    if (PARENTES[fq + "|" + fc] != null) return PARENTES[fq + "|" + fc];
    if (fq === "corpo" && (fc === "indef" || fc === "outro")) return 1.4;
    if (fc === "indef" || fc === "outro") return 0;
    return -1.2;
  }

  /* Sem equipamento dito, a versao mais comum ganha o desempate (e faixa elastica, bola e afins ficam por ultimo). */
  var SEM_EQUIPAMENTO = { corpo: 0.3, halter: 0.3, barra: 0.25, maquina: 0.15, cabo: 0.1, ez: 0, kettlebell: -0.3, banda: -0.8, bola: -0.5, outro: -0.2, indef: -0.1, rolo: -0.5 };
  /* Palavra a mais no nome do indice que muda o exercicio: pesa mais que palavra qualquer. */
  var MODIFICADORES = {
    seated: 1, standing: 1, lying: 1, reverse: 1, decline: 1, incline: 1, one: 1, single: 1, alternate: 1, wide: 1,
    close: 1, behind: 1, hanging: 1, kneeling: 1, hammer: 1, upright: 1, smith: 1, stiff: 1, sumo: 1, front: 1, rear: 1,
    overhead: 1, bent: 1, jump: 1, split: 1, plie: 1, bulgarian: 1, preacher: 1, concentration: 1,
  };

  /* Variantes de nome proprio: se a foto e de uma delas e o nome nao a pediu, e foto parecida, nao exata. */
  var VARIANTES = { stiff: 1, romanian: 1, sumo: 1, pistol: 1, zottman: 1, snatch: 1, clean: 1, jerk: 1, trap: 1, leverage: 1, wide: 1 };
  VARIANTES.wide = 0;   // "pegada aberta" e o padrao da puxada: nao conta como variante

  function palavrasPedidas(q) {
    var conhecidas = {};
    q.slots.forEach(function (sl) { sl.alts.forEach(function (a) { a.forEach(function (p) { conhecidas[p] = 1; }); }); });
    return conhecidas;
  }

  function pontuar(c, q) {
    var s = 0, cobertura = [], dado = {};
    q.slots.forEach(function (sl) {
      var melhor = -1e9, frac = 0;
      sl.alts.forEach(function (alt) {
        if (!alt.length) return;
        var cob = 0;
        alt.forEach(function (p) { if (c.tok[p]) cob++; });
        var v = sl.w * (cob - 0.6 * (alt.length - cob));
        if (v > melhor) { melhor = v; frac = cob / alt.length; }
      });
      if (melhor > -1e9) s += melhor;
      if (sl.w >= C) cobertura.push(frac);
    });
    var comp = compativel(q.fam, c.fam);
    if (comp < 0 && q.famForte) comp *= 1.8;
    s += comp;
    if (!q.fam) s += SEM_EQUIPAMENTO[c.fam] || 0;
    if (q.musPrincipal.length || q.musOutros.length) {
      if (cruza(c.mus, q.musPrincipal)) s += 1.6;
      else if (cruza(c.mus, q.musOutros) || cruza(c.mus2, q.musPrincipal)) s += 0.9;
      else s -= 1.4;
    }
    if (!q.alo && c.cat === "stretching") s -= 3;
    if (c.cat === "cardio" && !q.cardio) s -= 0.6;
    if (c.cat === "strongman") s -= 2;
    if (c.cat === "olympic weightlifting") s -= 0.8;
    if (c.cat === "plyometrics") s -= 0.4;
    // nome com palavra a mais que a consulta nao tem e menos provavel de ser o que se quer
    var conhecidas = {};
    q.slots.forEach(function (sl) { sl.alts.forEach(function (a) { a.forEach(function (p) { conhecidas[p] = 1; }); }); });
    var extra = 0;
    var extraPeso = 0;
    c.extras.forEach(function (p) {
      if (conhecidas[p]) return;
      extra++;
      extraPeso += MODIFICADORES[p] ? 1.1 : 0.5;
    });
    s -= Math.min(extraPeso, 3.5);
    dado.cobertura = cobertura.length ? cobertura.reduce(function (a, b) { return a + b; }, 0) / cobertura.length : 0;
    dado.temMovimento = cobertura.length > 0;
    return { pontos: s, dado: dado };
  }

  function urlsDe(c) {
    var raiz = IDX.base.replace(/\/?$/, "/");
    var pasta = encodeURIComponent(c.id);
    return [raiz + pasta + "/0.jpg", raiz + pasta + "/1.jpg"];
  }

  function resultado(c, nivel) {
    return { id: c.id, nome: c.nome, nivel: nivel, urls: urlsDe(c) };
  }

  /* A foto-padrao do grupo (e do equipamento), quando o nome nao ajuda. */
  function padrao(q) {
    var g = (q.grupos || []).filter(function (x) { return PADRAO[x]; })[0];
    if (!g) return null;
    var tabela = PADRAO[g];
    var id = (q.fam && tabela[q.fam]) || tabela._;
    return id && IDX.porId[id] ? IDX.porId[id] : null;
  }

  /**
   * casar(nome, grupos, equipamento) -> { id, nome, nivel, urls } ou null.
   * nivel: "exato" quando o movimento do nome foi todo reconhecido na foto, "parecido" quando e
   * uma foto aproximada (movimento semelhante, ou so o grupo muscular).
   */
  function casar(nome, grupos, equipamento) {
    if (!IDX || !IDX.itens.length) return null;
    var q = entender(nome, grupos, equipamento);
    q.cardio = (grupos || []).indexOf("cardio") >= 0 || q.slots.some(function (s) {
      return s.alts.some(function (a) { return a.indexOf("treadmill") >= 0 || a.indexOf("bicycling") >= 0 || a.indexOf("rowing") >= 0 || a.indexOf("rope") >= 0; });
    });
    var melhor = null, melhorP = -1e9, melhorDado = null;
    IDX.itens.forEach(function (c) {
      var r = pontuar(c, q);
      if (r.pontos > melhorP) { melhorP = r.pontos; melhor = c; melhorDado = r.dado; }
    });
    if (melhor && melhorDado.temMovimento) {
      var pedidas = palavrasPedidas(q);
      var variante = melhor.extras.some(function (p) { return VARIANTES[p] && !pedidas[p]; });
      var outroEquip = variante || q.fam && (compativel(q.fam, melhor.fam) < 0 || (q.fam === "banda" && melhor.fam !== "banda"));
      if (melhorDado.cobertura >= 0.99 && !q.ap && !outroEquip) return resultado(melhor, "exato");
      if (melhorDado.cobertura >= 0.5 || q.ap) return resultado(melhor, "parecido");
    }
    var p = padrao(q);
    return p ? resultado(p, "parecido") : null;
  }

  var API = { casar: casar, usarIndice: usarIndice, entender: entender, _sem: sem, _palavrasEn: palavrasEn };
  raiz.TreinoFoto = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  /* ============================================================ tela */

  if (typeof document === "undefined") return;

  var ARQUIVO_INDICE = "/treino/exercicio-foto-indice.js";
  var estado = { carregando: null, tentou: false, pendente: false };
  var cache = {};      // chave do exercicio -> resultado de casar()

  /* O banco guarda o grupo sem acento; a tela mostra como se escreve. Volta ao id. */
  function grupoDoRotulo(txt) { return sem(txt).trim(); }

  /* Grupo do app -> regioes do <mapa-corpo> (as mesmas que o mapa dos 14 dias usa). */
  var REGIOES_DO_GRUPO = {
    peito: ["peito"], costas: ["costas"], ombro: ["ombro"], biceps: ["biceps"], triceps: ["triceps"],
    perna: ["quadriceps", "posterior"], gluteo: ["gluteo"], panturrilha: ["panturrilha"],
    abdomen: ["abdomen"], lombar: ["lombar"],
  };
  var ROTULO_GRUPO = {
    peito: "peito", costas: "costas", ombro: "ombro", biceps: "bíceps", triceps: "tríceps", perna: "perna",
    gluteo: "glúteo", panturrilha: "panturrilha", abdomen: "abdômen", lombar: "lombar", cardio: "cardio",
    "corpo inteiro": "corpo inteiro",
  };

  /* Principal vale 1, os outros metade: o mesmo peso que o catalogo do vault usa. */
  function dadosDoMapa(grupos) {
    var saida = {};
    grupos.forEach(function (g, i) {
      (REGIOES_DO_GRUPO[g] || []).forEach(function (r) { saida[r] = Math.max(saida[r] || 0, i === 0 ? 1 : 0.5); });
    });
    return saida;
  }

  function carregarIndice() {
    if (IDX) return Promise.resolve(true);
    if (estado.carregando) return estado.carregando;
    estado.carregando = new Promise(function (ok) {
      var s = document.createElement("script");
      s.src = ARQUIVO_INDICE;
      s.async = true;
      s.onload = function () {
        try { usarIndice(raiz.TREINO_FOTO_INDICE); ok(true); } catch (e) { ok(false); }
      };
      s.onerror = function () { ok(false); };
      document.head.appendChild(s);
    }).then(function (certo) {
      // falhou: libera para tentar de novo na proxima pintura, sem insistir em laco
      if (!certo) { estado.carregando = null; estado.tentou = true; }
      return certo;
    });
    return estado.carregando;
  }

  function dadosDaLinha(li) {
    var nomeEl = li.querySelector(".tr-ex-nome");
    var nome = nomeEl ? nomeEl.textContent.trim() : "";
    var grupos = [];
    li.querySelectorAll(".tr-ex-meta em").forEach(function (e) {
      var g = grupoDoRotulo(e.textContent);
      if (g && grupos.indexOf(g) < 0) grupos.push(g);
    });
    var eqEl = li.querySelector(".tr-ex-equip");
    return { nome: nome, grupos: grupos, equipamento: eqEl ? eqEl.textContent.trim() : "" };
  }

  function achar(d) {
    var chave = d.nome + "|" + d.grupos.join(",") + "|" + d.equipamento;
    if (!(chave in cache)) {
      try { cache[chave] = casar(d.nome, d.grupos, d.equipamento); } catch (e) { cache[chave] = null; }
    }
    return cache[chave];
  }

  function el(tag, classe, texto) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  /* A miniatura. Um botao dentro da linha: tocar nele abre o modal e NAO marca o exercicio como feito. */
  function miniatura(li, d, r) {
    var b = el("button", "tr-ex-foto");
    b.type = "button";
    b.setAttribute("aria-label", "Ver foto de exemplo: " + d.nome);
    var img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.src = r.urls[0];
    // sem rede ou foto fora do ar: a linha volta a ser o que era
    img.addEventListener("error", function () {
      li.classList.remove("com-foto");
      if (b.parentNode) b.parentNode.removeChild(b);
    });
    b.appendChild(img);
    b.addEventListener("click", function (e) { e.stopPropagation(); abrirModal(d, r, b); });
    b.addEventListener("keydown", function (e) { e.stopPropagation(); });
    return b;
  }

  function aplicar(tela) {
    var linhas = tela.querySelectorAll(".tr-ex:not([data-foto])");
    if (!linhas.length) return;
    if (!IDX) {
      if (estado.tentou || estado.pendente) return;
      estado.pendente = true;
      carregarIndice().then(function (certo) { estado.pendente = false; if (certo) aplicar(tela); });
      return;
    }
    linhas.forEach(function (li) {
      li.setAttribute("data-foto", "0");
      var d = dadosDaLinha(li);
      if (!d.nome) return;
      var r = achar(d);
      if (!r) return;
      var check = li.querySelector(".tr-check");
      if (!check) return;
      li.setAttribute("data-foto", "1");
      li.classList.add("com-foto");
      check.insertAdjacentElement("afterend", miniatura(li, d, r));
    });
  }

  /* ------------------------------------------------------------ modal */

  var modal = null;
  var voltarFoco = null;

  function montarModal() {
    var veu = el("div", "tr-foto-veu");
    veu.hidden = true;
    var caixa = el("div", "tr-foto-caixa");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-labelledby", "trFotoTitulo");
    var topo = el("div", "tr-foto-topo");
    var titulo = el("h3", "tr-foto-titulo");
    titulo.id = "trFotoTitulo";
    var fechar = el("button", "icone-btn tr-foto-fechar");
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar");
    fechar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    topo.appendChild(titulo);
    topo.appendChild(fechar);
    var fotos = el("div", "tr-foto-par");
    var nota = el("p", "tr-foto-nota");
    var musculos = el("div", "tr-foto-musculos");
    var credito = el("p", "tr-foto-credito", "Fotos: free-exercise-db (domínio público).");
    caixa.appendChild(topo);
    caixa.appendChild(fotos);
    caixa.appendChild(nota);
    caixa.appendChild(musculos);
    caixa.appendChild(credito);
    veu.appendChild(caixa);
    document.body.appendChild(veu);

    veu.addEventListener("click", function (e) { if (e.target === veu) fecharModal(); });
    fechar.addEventListener("click", fecharModal);
    document.addEventListener("keydown", function (e) {
      if (veu.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecharModal(); }
      // so ha um botao na caixa: o Tab fica nele em vez de escapar para a tela de tras
      else if (e.key === "Tab") { e.preventDefault(); fechar.focus(); }
    }, true);
    return { veu: veu, titulo: titulo, fotos: fotos, nota: nota, musculos: musculos, fechar: fechar };
  }

  function abrirModal(d, r, origem) {
    if (!modal) modal = montarModal();
    voltarFoco = origem || null;
    modal.titulo.textContent = d.nome;

    modal.fotos.textContent = "";
    ["Início", "Fim"].forEach(function (rotulo, i) {
      var fig = el("figure", "tr-foto-fig");
      var img = document.createElement("img");
      img.alt = rotulo + " do movimento";
      img.decoding = "async";
      img.src = r.urls[i];
      img.addEventListener("error", function () { fig.classList.add("sem"); img.removeAttribute("src"); });
      fig.appendChild(img);
      fig.appendChild(el("figcaption", "", rotulo));
      modal.fotos.appendChild(fig);
    });

    modal.nota.textContent = "";
    var exato = r.nivel === "exato";
    modal.nota.appendChild(el("b", "", exato ? "Foto de exemplo" : "Exemplo parecido"));
    modal.nota.appendChild(document.createTextNode(
      exato ? ": " + r.nome + "."
        : ": não achei este exercício exato, então esta é a foto de um movimento próximo (" + r.nome + ")."));

    modal.musculos.textContent = "";
    var dados = dadosDoMapa(d.grupos);
    if (Object.keys(dados).length) {
      var mapa = document.createElement("mapa-corpo");
      mapa.className = "tr-foto-mapa";
      mapa.setAttribute("inert", "");
      mapa.setAttribute("aria-hidden", "true");
      mapa.setAttribute("dados", JSON.stringify(dados));
      modal.musculos.appendChild(mapa);
      var leg = el("div", "tr-foto-legenda");
      var principal = ROTULO_GRUPO[d.grupos[0]] || d.grupos[0];
      leg.appendChild(el("span", "", "Principal: " + principal));
      var outros = d.grupos.slice(1).filter(function (g) { return REGIOES_DO_GRUPO[g]; }).map(function (g) { return ROTULO_GRUPO[g] || g; });
      if (outros.length) leg.appendChild(el("span", "", "Secundário: " + outros.join(", ")));
      modal.musculos.appendChild(leg);
    }

    modal.veu.hidden = false;
    document.documentElement.classList.add("tr-foto-aberto");
    // um quadro depois, para a transicao de entrada rodar
    requestAnimationFrame(function () { modal.veu.classList.add("aberto"); });
    modal.fechar.focus();
  }

  function fecharModal() {
    if (!modal || modal.veu.hidden) return;
    modal.veu.classList.remove("aberto");
    document.documentElement.classList.remove("tr-foto-aberto");
    var veu = modal.veu;
    setTimeout(function () { if (!veu.classList.contains("aberto")) veu.hidden = true; }, 200);
    if (voltarFoco && document.body.contains(voltarFoco)) { try { voltarFoco.focus(); } catch (e) {} }
    voltarFoco = null;
  }

  /* ------------------------------------------------------------ liga */

  function ligar() {
    var tela = document.getElementById("tela");
    if (!tela) return;
    var pintando = false;
    new MutationObserver(function () {
      // a propria insercao das miniaturas dispara o observador: so segue se ainda houver linha sem marca
      if (pintando) return;
      if (!tela.querySelector(".tr-ex:not([data-foto])")) return;
      pintando = true;
      try { aplicar(tela); } catch (e) { /* a foto e enfeite: nunca derruba a ficha */ }
      pintando = false;
    }).observe(tela, { childList: true, subtree: true });
    try { aplicar(tela); } catch (e) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligar);
  else ligar();
})(typeof window !== "undefined" ? window : globalThis);

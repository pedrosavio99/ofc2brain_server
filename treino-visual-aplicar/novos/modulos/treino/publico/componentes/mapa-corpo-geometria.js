// Geometria do corpo (frente e costas) para <mapa-corpo>.
//
// Origem: CorpoMapa.dc.html, o mapa do corpo que o Danilo escolheu no protótipo do Claude Design
// (31/10/2026, issue #90). Os traçados são desse protótipo; nada vem de biblioteca de terceiros.
// Substitui o desenho que a #55 trouxe de fora: o texto de licença daquele desenho saiu junto.
//
// Formato de cada vista: { vb, cabeca, silhueta, p, unico }
//   vb         viewBox da vista (100 x 212)
//   cabeca     traçado da cabeça (inerte)
//   silhueta   traçados do lado esquerdo do corpo (inertes)
//   p          { regiao: [d, ...] } traçados do lado esquerdo, no id de mapa-corpo-nomes.js
//   unico      { regiao: [d, ...] } peças do meio (trapézio), desenhadas uma vez só
// O que está em `silhueta` e `p` o desenhador espelha em x = 50, então só o lado esquerdo mora aqui.
// Todas as regiões de mapa-corpo-nomes.js têm desenho; serrátil, flexores do quadril e tibial não existem no desenho e acendem peito, quadríceps e panturrilha.

const SILHUETA = "M50 24 L44 26 L42 35 L33 37 Q24 39 23 50 L20 76 L15 100 L12 116 Q7 122 9 131 L13 131 L16 122 L19 116 L25 98 L29 80 L32 66 L34 88 L33 104 L31 130 L32 160 L33 190 L30 207 L40 208 L40 190 L42 160 L45 130 L48 110 L50 108 Z";
const CABECA = "M41.5 15a8.5 10.5 0 1 0 17 0a8.5 10.5 0 1 0 -17 0Z";
const ANTEBRACO = "M22 78 Q26 76 28 79.5 L21.5 103 Q18.5 106 17.2 102 Z";

export default {
  frente: {
    vb: "0 0 100 212",
    cabeca: CABECA,
    silhueta: [SILHUETA],
    p: {
      ombro: ["M33.5 38.5 Q25 40 24 50 Q27 54 31 52 Q33 45 38 40.5 Z"],
      peito: ["M39 40 Q44 38.5 49.3 40 L49.3 56 Q42 58 35.5 54 Q34 46 39 40 Z"],
      biceps: ["M25 55 Q29 53 31 56 L29.5 73 Q25.5 76 23.5 72 Z"],
      antebraco: [ANTEBRACO],
      abdomen: [
        "M45 58 H47.3 A2 2 0 0 1 49.3 60 V64 A2 2 0 0 1 47.3 66 H45 A2 2 0 0 1 43 64 V60 A2 2 0 0 1 45 58 Z",
        "M45 67.5 H47.3 A2 2 0 0 1 49.3 69.5 V73.5 A2 2 0 0 1 47.3 75.5 H45 A2 2 0 0 1 43 73.5 V69.5 A2 2 0 0 1 45 67.5 Z",
        "M45 77 H47.3 A2 2 0 0 1 49.3 79 V83 A2 2 0 0 1 47.3 85 H45 A2 2 0 0 1 43 83 V79 A2 2 0 0 1 45 77 Z",
        "M43 86.5 L49.3 86.5 L49.3 99 Q45 97 43 92 Z",
      ],
      obliquos: ["M36 58 L41.5 60 L41.5 90 L37 86 Q34.5 72 36 58 Z"],
      quadriceps: ["M35.5 103 Q42 100 46 107 L45 142 Q40 148 36.5 144 Q32.5 124 35.5 103 Z"],
      adutores: ["M47 107 L49.3 111 L48 131 L45.8 124 Z"],
      panturrilha: ["M35 155 Q39 152 42 156 L41 186 Q38 190 36 186 Q33 170 35 155 Z"],
    },
    unico: {},
  },
  costas: {
    vb: "0 0 100 212",
    cabeca: CABECA,
    silhueta: [SILHUETA],
    p: {
      ombro: ["M33.5 38.5 Q25 40 24 50 Q27 54 31 52 Q33 45 37 41 Z"],
      costas: ["M37.5 45 L46 48 L49.3 62 L49.3 82 L41 78 Q35.5 63 37.5 45 Z"],
      lombar: ["M42.5 81.5 L49.3 84.5 L49.3 98 L41.5 95.5 Z"],
      triceps: ["M24.5 53 Q29 51 31 55 L30 73 Q26 76 23.5 72 Z"],
      antebraco: [ANTEBRACO],
      gluteo: ["M36 99 Q44 95 49.3 100.5 L49.3 116 Q42 120 35 114 Z"],
      posterior: ["M35 118.5 Q42 121 47 118.5 L45 146 Q40 150 36.5 146 Q33 132 35 118.5 Z"],
      panturrilha: ["M35 155 Q40 150 44 156 L42 181 Q38 187 36 181 Q32 167 35 155 Z"],
    },
    unico: {
      trapezio: ["M50 26 L43 32 L35.5 38.5 L44 43 L50 64 L56 43 L64.5 38.5 L57 32 Z"],
    },
  },
};

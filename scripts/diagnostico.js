// Diagnostico do estado do "segundo cerebro".
// Rode:  node scripts/diagnostico.js
// Diz se o relink rodou, se ha embeddings, e o que o modelo acha que se conecta.
import * as db from "../src/db.js";

function cos(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return p / (Math.sqrt(na) * Math.sqrt(nb));
}

const PISO = Number(process.env.PISO_SIMILARIDADE || 0.3);
const todas = await db.listarTodas();

console.log(`\n=== ESTADO DO BANCO ===`);
console.log(`Total de ideias: ${todas.length}`);
const comEmb = todas.filter((i) => i.embedding && i.embedding.length);
const comRel = todas.filter((i) => i.relacionados && i.relacionados.length);
console.log(`Com embedding:   ${comEmb.length}`);
console.log(`Com >=1 conexao: ${comRel.length}\n`);

console.log(`--- por ideia ---`);
todas.forEach((i, idx) => {
  const emb = i.embedding && i.embedding.length ? `emb:${i.embedding.length}` : "emb:SEM";
  console.log(`${String(idx).padStart(2)} | ${emb} | rel:${i.relacionados?.length || 0} | [${i.area}] ${i.resumo?.slice(0, 46)}`);
});

if (comEmb.length >= 2) {
  console.log(`\n--- similaridades entre pares (modelo atual) ---`);
  const pares = [];
  for (let i = 0; i < todas.length; i++)
    for (let j = i + 1; j < todas.length; j++) {
      if (!todas[i].embedding || !todas[j].embedding) continue;
      pares.push([cos(todas[i].embedding, todas[j].embedding), i, j]);
    }
  pares.sort((a, b) => b[0] - a[0]);
  pares.slice(0, 15).forEach(([s, i, j]) => {
    const mark = s >= PISO ? `  <- candidata (>= ${PISO})` : "";
    console.log(`${s.toFixed(3)}  ${todas[i].resumo?.slice(0, 34)}  <>  ${todas[j].resumo?.slice(0, 34)}${mark}`);
  });
  const acima = pares.filter(([s]) => s >= PISO).length;
  console.log(`\nPares acima do piso ${PISO}: ${acima}`);
}

console.log(`\n=== VEREDITO ===`);
if (comEmb.length === 0) {
  console.log(`Nenhum embedding no banco. O relink NAO rodou (ou falhou).`);
  console.log(`Rode:  curl -X POST http://localhost:3333/relink`);
  console.log(`e confira a resposta (deve vir { ok:true, ideias, relacoes, modelo }).`);
} else if (comRel.length === 0) {
  console.log(`Embeddings OK, mas ZERO conexoes. As candidatas existem (veja acima),`);
  console.log(`entao o gargalo e o LLM vetando as relacoes no relink. Me manda essa`);
  console.log(`saida que eu troco o LLM de "veto" para "so explica o motivo".`);
} else {
  console.log(`Ha ${comRel.length} ideia(s) conectada(s). Se ainda faltam conexoes obvias,`);
  console.log(`o LLM esta conservador demais. Da pra baixar o rigor ou auto-linkar por similaridade.`);
}

// Avaliacao do pipeline da conversa contra um conjunto de casos SEUS.
// Roda planejamento + ferramentas reais (Groq + Supabase do .env); NAO gera
// resposta final, entao gasta pouco e mede o que mais importa: ele escolheu o
// modo certo, consultou as fontes certas e achou o que devia achar?
//
// Uso:  npm run avaliar                       (usa data/avaliacao-conversa.json,
//                                              ou o .exemplo.json se nao existir)
//       node scripts/avaliar-conversa.mjs caminho.json
import "dotenv/config";
import fs from "node:fs";
import { prepararTurno } from "../modulos/conversa/servidor/turno.mjs";

const arg = process.argv[2];
const candidatos = [arg, "data/avaliacao-conversa.json", "data/avaliacao-conversa.exemplo.json"].filter(Boolean);
const arquivo = candidatos.find((c) => fs.existsSync(c));
if (!arquivo) { console.error("Nenhum arquivo de casos encontrado."); process.exit(2); }

const sem = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const lista = (v) => (v === undefined ? null : Array.isArray(v) ? v : [v]);

function conferir(t, espera = {}) {
  const falhas = [];
  const modos = lista(espera.modo);
  if (modos && !modos.includes(t.plano.modo)) falhas.push(`modo "${t.plano.modo}" fora de [${modos.join(", ")}]`);
  const nomes = t.plano.ferramentas.map((f) => f.nome);
  for (const f of lista(espera.ferramentas) || []) if (!nomes.includes(f)) falhas.push(`faltou ferramenta ${f}`);
  for (const f of lista(espera.nao_ferramentas) || []) if (nomes.includes(f)) falhas.push(`nao devia usar ${f}`);
  if (espera.crise !== undefined && Boolean(t.plano.crise) !== espera.crise) falhas.push(`crise=${Boolean(t.plano.crise)}, esperado ${espera.crise}`);
  const ev = sem(t.pacote.texto);
  for (const trecho of lista(espera.evidencia_contem) || []) if (!ev.includes(sem(trecho))) falhas.push(`evidencia sem "${trecho}"`);
  return falhas;
}

const { casos } = JSON.parse(fs.readFileSync(arquivo, "utf8"));
console.log(`Avaliando ${casos.length} casos de ${arquivo}\n`);
let ok = 0; const tempos = [];
for (const c of casos) {
  try {
    const t = await prepararTurno({ texto: c.texto });
    tempos.push(t.ms.total);
    const falhas = conferir(t, c.espera);
    if (!falhas.length) ok++;
    console.log(`${falhas.length ? "FALHOU" : "ok    "} [${t.plano.modo}${t.plano.crise ? "!" : ""}] ${t.ms.total}ms  ${c.texto.slice(0, 70)}`);
    console.log(`        ferramentas: ${t.plano.ferramentas.map((f) => f.nome).join(", ")}  |  fontes: ${t.pacote.fontes.map((f) => `${f.ferramenta}:${f.itens}`).join(" ") || "-"}`);
    for (const f of falhas) console.log(`        - ${f}`);
  } catch (e) {
    console.log(`ERRO   ${c.texto.slice(0, 70)}: ${e.message}`);
  }
}
tempos.sort((a, b) => a - b);
const p = (q) => tempos.length ? tempos[Math.min(tempos.length - 1, Math.floor(q * tempos.length))] : 0;
console.log(`\n${ok}/${casos.length} passaram  |  latencia p50 ${p(0.5)}ms, p90 ${p(0.9)}ms`);
process.exit(ok === casos.length ? 0 : 1);

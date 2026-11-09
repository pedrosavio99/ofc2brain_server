# TrendRadar (`modulos/trendradar`)

Radar de oportunidades B2B que só mostra **dado coletado**. Não existe catálogo fixo, score editorial nem estimativa: se algo não foi medido, a tela diz que não mediu.

Prefixo HTTP: `/trendradar`. Persistência: Supabase (`supabase/trendradar-v2.sql`), com reserva em memória enquanto as tabelas não existem.

## O que aparece na tela

Cada cartão é uma linha de `radar_descobertas`, de uma de três origens:

| origem | de onde vem |
|---|---|
| `radar` | achado sozinho pela coleta diária, a partir de manchetes reais |
| `pesquisa` | um alvo que você pesquisou (menu ••• ou lupa) |
| `csv` | uma série do Google Trends que você exportou e importou |

E cada cartão só carrega o que tem fonte:

- **Manchetes** (veículo, data, link) que sustentam o assunto.
- **Pulso de imprensa**: matérias distintas do Google Notícias nos últimos 7 dias contra os 7 anteriores. Menos de 6 matérias no total = "sem dado" (nunca finge tendência); amostra pequena é avisada. A série diária cresce a cada coleta.
- **Série e regiões do Google Trends**, só se vieram de CSV seu ou da `SERPAPI_KEY`.
- **Leitura da IA** (quem paga, dores, soluções que já existem, teste de 7 dias): sempre rotulada "hipótese a validar". Se a IA não responde, o campo fica vazio; nunca entra texto pronto.
- **Combina com você**: nota sua mais parecida (embedding), só acima de 0,72 de similaridade (`RADAR_PISO_AFINIDADE`).

A contagem de matérias mede **atenção da imprensa**, não demanda de mercado. Valide com clientes antes de construir.

## Como o radar se alimenta

Uma coleta por dia (cron da Vercel) e sob demanda quando os dados têm mais de 14 h:

1. **Descoberta**: ~18 buscas de manchetes dos últimos 3 dias (3 por frente) → uma chamada ao Groq propõe oportunidades **ancoradas nas manchetes**. Filtros: link vem dos dados (nunca do modelo), mínimo 2 veículos diferentes, só B2B com "quem paga" nomeado, sem repetir assunto já visto (inclusive descartado, mesmo com outras palavras), sem expandir siglas.
2. **Afinidade** com suas notas.
3. **Pulso** de cada alvo vivo (inclusive os recém descobertos), gravado em `radar_pulso`.

"Nova" que ninguém tocou em 21 dias sai da frente (a linha fica no banco). Descartada nunca volta.

## Operação

- Rode `supabase/trendradar-v2.sql` (3 tabelas, RLS ligado, idempotente). **Se você rodou a versão anterior, rode de novo**: ela completa as colunas `origem`, `dossie`, `serie` e `regioes`. Sem isso a tela avisa "Falta atualizar o banco" e pesquisar/investigar não salvam.
- Cron diário em `vercel.json` (`0 9 * * *` UTC = 06:00 BRT) chama `GET /trendradar/api/cron/coletar`. Exige `CRON_SECRET` na Vercel; sem ela a rota responde 503 (nunca fica aberta). O cron é opcional: sem ele a coleta roda na primeira abertura do dia, mas o histórico só cresce nos dias em que você abre.
- Variáveis opcionais: `RADAR_PERFIL`, `GROQ_MODEL_RADAR`, `RADAR_PISO_AFINIDADE`, `SERPAPI_KEY` (série e regiões do Trends).

## Rotas

| rota | uso |
|---|---|
| `GET /api/radar` | cartões + resumo + saúde da coleta |
| `POST /api/coletar` `{forcar?}` | coleta sob demanda |
| `GET /api/cron/coletar` | cron (Bearer `CRON_SECRET`) |
| `PATCH /api/descobertas` `{id,status}` | `nova` / `salva` / `descartada` |
| `POST /api/descobertas/investigar` `{id}` | imprensa nova + hipóteses da IA na mesma linha |
| `POST /api/investigar` `{termo}` | pesquisa um alvo novo |
| `POST /api/importar-csv` `{csv,nome?,frente?}` | importa série do Trends |
| `GET /api/cotas` | uso das APIs opcionais |

## Arquivos

```text
modulos/trendradar/
├── servidor/
│   ├── index.js        # Router Express, estáticos e erros
│   ├── rotas.mjs       # Endpoints
│   ├── coleta.mjs      # Coleta diária (descoberta, afinidade, pulso), montarRadar, resumo p/ Conversa
│   ├── vivo.mjs        # Puro e testável: RSS, janelas 7d x 7d, estado do pulso, saneamento das descobertas
│   ├── cartoes.mjs     # Linha do banco -> cartão da tela (puro)
│   ├── nucleo.mjs      # Config, cotas, guardas HTTP, pesquisa de alvo e importação de CSV
│   ├── ia.mjs          # Hipóteses a partir das manchetes (null se a IA falhar)
│   └── radar-banco.mjs # Supabase (radar_*) com reserva em memória e detecção de SQL desatualizado
├── publico/
│   ├── trendradar.html, radar.js, radar.css
│   └── aba-trendradar.js   # atalho no menu do app
└── testes/             # npm test
```

## O que foi removido (e por quê)

O catálogo de 15 oportunidades fixas, o gerador de estados "estimados", o "dossiê plausível" de modelo pronto, o score editorial, a lente dos 4 objetivos, a síntese executiva e o relatório comparativo MD/PDF. Todos eram construídos sobre números que não vinham de coleta. O relatório pode voltar, construído sobre os cartões reais.

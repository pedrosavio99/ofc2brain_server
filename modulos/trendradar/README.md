# Módulo TrendRadar — Segundo Cérebro (`modulos/trendradar`)

Radar estratégico de inteligência de mercado B2B integrado ao ecossistema **Segundo Cérebro**. Organiza as **6 Frentes de Mercado** e **4 Objetivos Simultâneos**, respondendo às **6 Perguntas de Decisão** (série temporal e anti-hype, concentração geográfica nas 27 UFs, dores recorrentes, lacunas competitivas, ICP pagador e auditoria de evidências).

## Arquitetura no Segundo Cérebro

- **Prefixo HTTP**: `/trendradar`
- **Persistência**: o catálogo base vem de `dados-historico.json` (somente leitura na Vercel). O que muda (pulso diário, descobertas, itens pesquisados) fica no Supabase (`supabase/trendradar-v2.sql`), com reserva em memória se as tabelas não existirem.
- **Design System Oficial (`/estilos.css`)**:
  - Tela principal enxuta com barra superior oficial (`Segundo cérebro / TrendRadar`), busca rápida, controle segmentado animado (`.segmentado` + `.indicador`) e chips das 6 frentes.
  - Todas as ferramentas avançadas (**Pesquisar Alvo**, **Importar CSV Google Trends**, **Relatório Executivo MD/PDF**, **Síntese Executiva da IA**, **Monitor de Cotas de API**, **Seletor de Modelo de IA**, **Filtro por Tipo de Alvo**, **Lente dos 4 Objetivos** e **Aparência/Tema**) ficam concentradas no menu `•••` (`Opções`) da navbar.

## Radar vivo (muda todo dia)

O catálogo de oportunidades é uma **tese editorial** (métricas estimadas, rotuladas como tal na tela). O que o torna vivo é uma **coleta diária** com dados reais:

1. **Pulso de imprensa**: para cada oportunidade, quantas matérias *distintas* (dedup por título, filtro de relevância) o Google Notícias teve nos últimos 7 dias contra os 7 anteriores. Estados: `subindo` / `esfriando` / `estável` / `sem dado` (precisa de ≥4 menções, ±35% e ≥3 de volume). A pontuação vira `0,65 × tese + 0,35 × momentum`. A foto diária fica em `radar_pulso`, então o histórico real cresce a cada dia.
2. **Descobertas**: manchetes recentes de cada frente → uma chamada ao Groq propõe oportunidades **ancoradas nas manchetes** (links vêm dos dados, nunca do modelo; mínimo 2 fontes distintas; só B2B com "quem paga" nomeado; sem repetir assunto já proposto, mesmo com outras palavras).
3. **Afinidade**: embedding de cada descoberta contra as suas notas; só aparece "Combina com você" acima de 0,72 de similaridade (`RADAR_PISO_AFINIDADE`).

A tela **Hoje no radar** (topo da página) mostra sinais novos (Investigar / Conversar / Salvar / Descartar) e o movimento da imprensa. "Conversar" abre `/conversa?abrir=…` e os sinais novos também entram como cartão "Radar" no feed da Conversa.

**Operação**
- Rode `supabase/trendradar-v2.sql` uma vez (4 tabelas, RLS ligado). Sem ele tudo funciona em memória e a tela avisa que o histórico não é guardado.
- Cron diário em `vercel.json` (`0 9 * * *` UTC = 06:00 BRT) chama `GET /trendradar/api/cron/coletar`. Exige `CRON_SECRET` nas variáveis da Vercel; sem ela a rota responde 503 (nunca fica aberta).
- Se os dados têm mais de 14 h, o painel dispara uma coleta sozinho (uma vez por sessão). `POST /api/coletar` força manualmente.
- Rotas novas: `GET /api/hoje`, `POST /api/coletar`, `PATCH /api/descobertas`, `POST /api/descobertas/investigar`.

**Limites honestos**: contagem de matérias é um *proxy* de interesse (ruidoso, pode oscilar com poucos números); as métricas da tese editorial não são coleta; a investigação aprofundada ainda gera reclamações/concorrentes por LLM, apresentados como hipóteses a validar.

## Estrutura de Arquivos e Variáveis de Ambiente

O módulo **não possui `.env` próprio**: ele consome diretamente o `.env` da raiz do **Segundo Cérebro** (e as *Environment Variables* da Vercel), reaproveitando nativamente `GEMINI_API_KEYS`, `GEMINI_MODELOS`, `GROQ_API_KEY`, `GROQ_CHAT_MODEL` e `PIN_ACESSO`, além das 3 chaves opcionais de coleta externa (`SERPAPI_KEY`, `NEWSAPI_KEY` e `GNEWS_API_KEY`).

```text
modulos/trendradar/
├── dados-historico.json  # Base histórica das oportunidades e 27 UFs
├── README.md             # Documentação do módulo
├── servidor/
│   ├── index.js          # Monta express.Router(), assets estáticos e rotas
│   ├── rotas.mjs         # Endpoints REST (/api/itens, /api/investigar, /api/importar-csv, /api/relatorio, /api/cotas)
│   ├── nucleo.mjs        # Lógica de domínio, cache TTL, controle de cotas e gerador Markdown
│   ├── ia.mjs            # Cascata resiliente Gemini -> Groq -> Heurística determinística local
│   ├── vivo.mjs          # Radar vivo: RSS, pulso de imprensa, momentum, descoberta por IA (puro e testável)
│   ├── coleta.mjs        # Orquestra a coleta diária (pulso + descobertas + afinidade) e o cron
│   └── radar-banco.mjs   # Persistência Supabase (radar_*) com reserva em memória
├── testes/               # node --test (npm test)
└── publico/
    ├── radar-hoje.js     # Seção "Hoje no radar"
    ├── aba-trendradar.js # Injeta atalho no menu Opções (•••) da página inicial (/)
    ├── trendradar.html   # Casca HTML seguindo o padrão Segundo Cérebro
    ├── trendradar.css    # Estilos específicos usando exclusivamente tokens de /estilos.css
    └── trendradar.js     # Cliente SPA e menu de ferramentas completo
```

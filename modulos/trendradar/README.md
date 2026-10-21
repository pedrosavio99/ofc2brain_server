# Módulo TrendRadar — Segundo Cérebro (`modulos/trendradar`)

Radar estratégico de inteligência de mercado B2B integrado ao ecossistema **Segundo Cérebro**. Organiza as **6 Frentes de Mercado** e **4 Objetivos Simultâneos**, respondendo às **6 Perguntas de Decisão** (série temporal e anti-hype, concentração geográfica nas 27 UFs, dores recorrentes, lacunas competitivas, ICP pagador e auditoria de evidências).

## Arquitetura no Segundo Cérebro

- **Prefixo HTTP**: `/trendradar`
- **Sem dependência de banco de dados externo**: Opera com persistência local (`modulos/trendradar/dados-historico.json`) e cache em memória (`memoriaRuntime`), mantendo zero acoplamento com `src/*`.
- **Design System Oficial (`/estilos.css`)**:
  - Tela principal enxuta com barra superior oficial (`Segundo cérebro / TrendRadar`), busca rápida, controle segmentado animado (`.segmentado` + `.indicador`) e chips das 6 frentes.
  - Todas as ferramentas avançadas (**Pesquisar Alvo**, **Importar CSV Google Trends**, **Relatório Executivo MD/PDF**, **Síntese Executiva da IA**, **Monitor de Cotas de API**, **Seletor de Modelo de IA**, **Filtro por Tipo de Alvo**, **Lente dos 4 Objetivos** e **Aparência/Tema**) ficam concentradas no menu `•••` (`Opções`) da navbar.

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
│   └── ia.mjs            # Cascata resiliente Gemini -> Groq -> Heurística determinística local
└── publico/
    ├── aba-trendradar.js # Injeta atalho no menu Opções (•••) da página inicial (/)
    ├── trendradar.html   # Casca HTML seguindo o padrão Segundo Cérebro
    ├── trendradar.css    # Estilos específicos usando exclusivamente tokens de /estilos.css
    └── trendradar.js     # Cliente SPA e menu de ferramentas completo
```

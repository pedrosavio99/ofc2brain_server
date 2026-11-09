# Arquitetura de Módulos e Ecossistema (Segundo Cérebro)

Este documento define a hierarquia, os contratos e os padrões visuais e arquiteturais que todos os módulos existentes e futuros do **Segundo Cérebro** devem seguir.

---

## 1. Visão Geral do Ecossistema

O Segundo Cérebro é um ecossistema integrado composto por módulos especializados que se conectam ao assistente central (**Conversa**):

| Módulo | Prefixo de Rota | Descrição |
|---|---|---|
| **Início** | `/` | Mural de notas, memórias, sinapses e pesquisa semântica. |
| **Conversa** | `/conversa` | Assistente IA conectado aos dados de todos os outros módulos. |
| **Treino** | `/treino` | Fichas de musculação, séries, cargas e gasto calórico. Inclui a **Alimentação** (modal): diário alimentar, macros, ciclo de 14 dias e meta calórica. |
| **fdsFlix** | `/fdsflix` | Filmes e séries (busca TMDB, player próprio sem anúncios, legendas, continuar assistindo). A API roda em `https://fdsflix.onrender.com` (Render gratuito: cold start de até ~40 s). |
| **Trabalho** | `/trabalho` | Integração com ClickUp, planejamento diário (daily) e prazos. |
| **Música** | `/musica` | Player Sua Música, streaming de áudio e rádio infinita. |
| **TrendRadar** | `/trendradar` | Radar estratégico de oportunidades B2B nas 6 frentes, com coleta diária real (pulso de imprensa, sinais novos, afinidade com suas notas). Veja `modulos/trendradar/README.md`. |

---

## 2. Hierarquia e Padronização da Navbar (Barra de Navegação)

Todos os módulos devem respeitar a mesma identidade visual no cabeçalho superior (`<header class="barra" id="barra">`).

### Estrutura Visual Canônica

```
+-----------------------------------------------------------------------------------------+
| [🧠] / [Nome do Módulo]                      [Ação 1] [Ação 2] [Ação Opcional] [•••]   |
+-----------------------------------------------------------------------------------------+
  \_____________________/                      \_____________________________/   \___/
     Marca do Início                             Ações Específicas do Módulo    Menu Eco
```

1. **Lado Esquerdo (Marca & Hierarquia do Ecossistema)**:
   - Logo oficial do cérebro (`/cerebro-mini.svg`) como link para o início (`/`), sem texto redundante para economizar espaço em todas as telas.
   - Separador elegante (`/`).
   - Nome do módulo atual (destacado na cor de acento).

2. **Lado Direito (Ações do Módulo + Menu Global)**:
   - **Opções Opcionais**: botões de ação exclusivos daquele módulo (ex: Nova conversa, Filtro, Atualizar, Equipamentos).
   - **Menu do Ecossistema (`#btnMenuEco`)**: botão fixo de 3 pontos (`•••`) que abre a folha padronizada do ecossistema.

### HTML Padrão para Novos Módulos

```html
<!doctype html>
<html lang="pt-BR" data-tema="sistema">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Nome do Módulo</title>
  <link rel="icon" type="image/svg+xml" href="/cerebro-mini.svg" />
  <link rel="stylesheet" href="/estilos.css" />
  <link rel="stylesheet" href="/seumodulo/estilo.css" />
  <script>
    try { document.documentElement.dataset.tema = localStorage.getItem("2brain-tema") || "sistema"; } catch (e) {}
  </script>
</head>
<body data-modulo="seumodulo">

<header class="barra" id="barra">
  <div class="barra-int">
    <div class="barra-marca-bloco">
      <a class="barra-marca" href="/" title="Ir para início do Segundo cérebro" aria-label="Segundo cérebro">
        <img src="/cerebro-mini.svg" alt="" width="28" height="28" draggable="false" />
      </a>
      <span class="barra-separador-modulo" aria-hidden="true">/</span>
      <span class="barra-modulo-atual">Nome do Módulo</span>
    </div>
    <div class="barra-acoes">
      <!-- Suas ações opcionais específicas do módulo: -->
      <button class="icone-btn" id="btnMinhaAcao" aria-label="Ação" title="Minha Ação">
        <svg viewBox="0 0 24 24" ...></svg>
      </button>

      <!-- Botão universal de menu do ecossistema: -->
      <button class="icone-btn btn-menu-eco" id="btnMenuEco" aria-label="Menu do ecossistema" title="Menu do ecossistema">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
    </div>
  </div>
</header>

<main class="envolucro">
  <!-- Conteúdo do módulo -->
</main>

<script src="/pin.js"></script>
<script src="/navegacao.js"></script>
<script src="/seumodulo/app.js"></script>
</body>
</html>
```

### O Script Compartilhado `/navegacao.js`

O arquivo `public/navegacao.js`:
- Gerencia a lista central de módulos ativos.
- Garante o efeito de rolagem da barra (`.barra.rolou`).
- Controla a abertura do menu gaveta/sheet do ecossistema, permitindo alternar de módulo em 1 clique e trocar o tema (Claro / Escuro / Sistema).
- Expõe a API `window.SegundoCerebroNav` caso o módulo queira registrar dinamicamente novos submódulos via `SegundoCerebroNav.modulos.push(...)`.

---

## 3. Conexão com o Módulo Conversa (Assistente IA Central)

A premissa do Segundo Cérebro é que **a IA central conhece a rotina e os dados dos outros módulos**.

### Como a Conexão Funciona (pipeline por turno)

Cada mensagem passa por camadas, nesta ordem (`modulos/conversa/servidor/turno.mjs`):

1. **Planejador** (`planejador.mjs`): uma chamada barata ao Groq decide o **modo** (direto, resgate, parceiro,
   escuta, reflexão, técnico, pensar junto, execução, exploração, organizar, análise), o tamanho da resposta,
   a carga emocional, reescreve a pergunta de forma autônoma, gera 1–3 consultas de busca e escolhe as ferramentas.
   Se o Groq falhar, cai numa heurística local. **Crise e janelas de data são regras fixas, nunca decididas pelo modelo.**
2. **Ferramentas** (`ferramentas-spec.mjs` + `ferramentas.mjs`): um registro único (`buscar_notas`, `notas_por_periodo`,
   `buscar_memoria`, `buscar_conversas`, `ver_treinos`, `ver_refeicoes`, `ver_peso`, `ver_metas`, `ver_tarefas`,
   `ver_lembretes`, `ver_radar`). Rodam em paralelo, com timeout, e nunca derrubam o turno.
3. **Busca híbrida** (`busca.mjs`): vetor (pgvector) + texto (FTS português) fundidos por RRF no Postgres, rerank por LLM e corte relativo.
4. **Memória** (`memoria.mjs`): fatos atômicos sobre a pessoa (estilo Mem0: ADD/UPDATE/DELETE/NOOP). Roda via `POST /memorizar`
   chamado pelo front depois da resposta. Memórias fixadas por você nunca são alteradas pelo sistema. Editáveis no painel "Alma".
5. **Evidência** (`evidencia.mjs`): monta o bloco consultado com orçamento de caracteres e avisa quando nada foi achado (evita invenção).
6. **Resposta** (`resposta.mjs` + `modos.mjs`): texto livre (sem JSON mode), com instrução e "thinking" por modo, e ponte entre o modo anterior e o atual.

### Conexão com o MCP (clientes externos)

`POST /mcp` (`mcp.mjs`) expõe as mesmas ferramentas, somente leitura, mais `consultar` (pergunta em linguagem natural),
para Claude, ChatGPT, Cursor etc. Exige `Authorization: Bearer <MCP_TOKEN>`; sem `MCP_TOKEN` no ambiente responde 503.
O chat interno chama as funções direto (sem rede). Gere o token com `openssl rand -hex 32`.

### Feed e atalhos (engajamento útil)

- **Feed da tela inicial** (`sugestoes.mjs`, `GET /conversa/api/sugestoes`): ao abrir uma conversa vazia, cartões de assuntos do dia tirados das suas notas
  (fio solto, ligação entre notas, redescoberta, prazo chegando, curiosidade). Garimpo sem modelo (notas recentes, antigas amostradas por semente do dia,
  eventos, tarefas, memórias, títulos de conversas recentes) + uma chamada ao modelo só com esse material + saneamento. Sem modelo, cai numa heurística.
  Cache de 40 min no servidor e do dia no aparelho; o botão ↻ força novos. `?forcar=1` ignora o cache.
- **Atalhos depois da resposta**: o modelo escreve linhas `[SEGUIR: ...]` no fim; o servidor as tira do texto e devolve em `seguir`; a tela mostra como botões.
  Nunca em modo sensível (escuta, reflexão, crise).

### Depuração e avaliação

- `POST /conversa/api/diagnostico {"texto": "..."}`: roda planejamento + consulta sem gerar resposta e devolve modo, consultas, fontes, tempos e evidência.
- `npm test`: testes das partes puras (crise, modos, planejador, busca, evidência, MCP).
- `npm run avaliar`: roda o pipeline real contra `data/avaliacao-conversa.json` (copie o `.exemplo.json`) e confere modo, ferramentas e evidência esperados.
- SQL necessário: `supabase/conversa-v2.sql` (idempotente). Sem ele o chat funciona em modo reduzido (só busca por significado, sem memórias).

### Integração com Música

- A IA sabe que possui o módulo de música e, ao ser solicitada para tocar músicas ("toca um forró", "música pra treinar"), inclui a tag:
  `[TOCAR_MUSICA: termo ou artista]`
- O frontend (`conversa.js`) intercepta a tag, consulta `/conversa/api/musica/busca?q=...` e renderiza um **card interativo de música**.

### Como Conectar um Novo Módulo ao Conversa

1. No seu módulo, exporte em `servidor/banco.mjs` uma função que retorne um resumo (ex: `resumoDoDia()`).
2. Em `modulos/conversa/servidor/ferramentas-spec.mjs`, adicione a entrada em `ESPEC` (nome, descrição para o planejador, argumentos).
3. Em `modulos/conversa/servidor/ferramentas.mjs`, implemente a função e registre em `FERRAMENTAS`. Ela passa a valer no chat **e** no MCP.
4. Descreva bem o "quando usar" na `descricao`: é com ela que o planejador decide quando consultar.

---

## 4. Checklist para Criar um Novo Módulo

1. **Estrutura de Pastas**:
   ```
   modulos/<nome-do-modulo>/
   ├── publico/
   │   ├── <nome>.html
   │   ├── <nome>.css
   │   └── <nome>.js
   └── servidor/
       ├── index.js     (Router Express montado sob /<nome>)
       └── rotas.mjs
   ```
2. **Plugar no Express (`src/app.js`)**:
   ```javascript
   import meuModuloRouter from "../modulos/<nome>/servidor/index.js";
   app.use("/<nome>", meuModuloRouter);
   ```
3. **Registrar no Catálogo (`public/navegacao.js`)**:
   Adicione seu módulo ao array `MODULOS` com id, nome, rota, descrição e ícone SVG.
4. **Adicionar como ferramenta da IA** (`ferramentas-spec.mjs` + `ferramentas.mjs` em `modulos/conversa/servidor/`) se o módulo contiver informações relevantes para o assistente.


---

## 6. Notas: Alimentação dentro do Treino e módulo fdsFlix

- **Refeição não tem mais aba nem tela própria.** A tela inteira (resumo do dia, ciclo de 14 dias, meta,
  calcular/registrar direto, corrigir, excluir) virou o modal **Alimentação** do Treino
  (`modulos/treino/publico/alimentacao.js` + `alimentacao.css`, tudo escopado em `.rf-modal`).
  Abre pelo ícone de talheres da barra do Treino ou pelo cartão "Alimentação de hoje".
  `/refeicao` (página) redireciona para `/treino#alimentacao`; a API `/refeicao/api/*` continua igual e é
  usada pelo Treino, pela Conversa e pelo Metas.
- **fdsFlix** (`modulos/fdsflix`) não tem API própria: a tela fala direto, do navegador, com
  `https://fdsflix.onrender.com` (CORS liberado). O `/pin.js` só carimba chamadas da mesma origem, então o PIN
  do 2brain nunca vai para lá. Como o Render gratuito dorme, `navegacao.js` faz um aquecimento silencioso
  (`/api/health`, no máximo 1x a cada 10 min, só quando o navegador está ocioso) e a tela tem esqueletos e
  barra de espera para o cold start.

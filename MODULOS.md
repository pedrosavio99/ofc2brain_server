# Arquitetura de Módulos e Ecossistema (Segundo Cérebro)

Este documento define a hierarquia, os contratos e os padrões visuais e arquiteturais que todos os módulos existentes e futuros do **Segundo Cérebro** devem seguir.

---

## 1. Visão Geral do Ecossistema

O Segundo Cérebro é um ecossistema integrado composto por módulos especializados que se conectam ao assistente central (**Conversa**):

| Módulo | Prefixo de Rota | Descrição |
|---|---|---|
| **Início** | `/` | Mural de notas, memórias, sinapses e pesquisa semântica. |
| **Conversa** | `/conversa` | Assistente IA conectado aos dados de todos os outros módulos. |
| **Treino** | `/treino` | Fichas de musculação, séries, cargas e gasto calórico. |
| **Refeições** | `/refeicao` | Diário alimentar, cálculo de macronutrientes e metas calóricas. |
| **Trabalho** | `/trabalho` | Integração com ClickUp, planejamento diário (daily) e prazos. |
| **Música** | `/musica` | Player Sua Música, streaming de áudio e rádio infinita. |

---

## 2. Hierarquia e Padronização da Navbar (Barra de Navegação)

Todos os módulos devem respeitar a mesma identidade visual no cabeçalho superior (`<header class="barra" id="barra">`).

### Estrutura Visual Canônica

```
+-----------------------------------------------------------------------------------------+
| [🧠 Segundo cérebro] / [Nome do Módulo]      [Ação 1] [Ação 2] [Ação Opcional] [•••]   |
+-----------------------------------------------------------------------------------------+
  \_____________________________________/      \_____________________________/   \___/
     Marca Universal do Ecossistema              Ações Específicas do Módulo    Menu Eco
```

1. **Lado Esquerdo (Marca & Hierarquia do Ecossistema)**:
   - Logo oficial do cérebro (`/cerebro-mini.svg`).
   - Link para o início (`/`) com o texto `Segundo cérebro`.
   - Separador elegante (`/`).
   - Nome do módulo atual (destacado na cor de acento).
   - *No mobile (telas ≤ 480px)*: o texto "Segundo cérebro" é omitido automaticamente, exibindo apenas `[🧠] / [Nome]`, garantindo espaço para as ações à direita sem quebrar a linha.

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
      <a class="barra-marca" href="/" title="Ir para início do Segundo cérebro">
        <img src="/cerebro-mini.svg" alt="" width="22" height="22" draggable="false" />
        <span class="barra-marca-nome">Segundo cérebro</span>
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

### Como a Conexão Funciona

1. **Contexto no Servidor (`modulos/conversa/servidor/ecossistema.mjs`)**:
   - As funções `obterContextoRefeicoes()` e `obterContextoTreinos()` consultam o banco do Supabase e retornam resumos em texto puro sobre as refeições do dia (calorias, macros, itens) e treinos (status da sessão, ficha, peso, altura).
   - O bloco gerado é injetado diretamente no prompt da LLM (Gemini / Groq) nas rotas `/contexto` e `/responder`.

2. **Integração com Música**:
   - A IA sabe que possui o módulo de música e, ao recomendar ou ser solicitada para tocar músicas ("toca um forró", "música pra treinar"), inclui a tag:
     `[TOCAR_MUSICA: termo ou artista]`
   - O frontend da conversa (`conversa.js`) intercepta a tag, consulta a rota `/conversa/api/musica/busca?q=...` e renderiza um **card interativo de música** com capa, título, artista e botão Play/Pause direto no chat.

### Como Conectar um Novo Módulo ao Conversa

Se você criar um novo módulo (ex: `sono`, `financeiro`, `leitura`):
1. No seu módulo, crie uma função exportada em `servidor/banco.mjs` que retorne um resumo do dia ou da semana (ex: `resumoDoDia()`).
2. Em `modulos/conversa/servidor/ecossistema.mjs`, adicione a chamada a essa função dentro de um bloco `try/catch` seguro.
3. Formate as informações em poucas linhas de texto claro e anexe-as ao `obterContextoEcossistema()`.
4. Assim, o assistente responderá automaticamente com base nos dados do seu novo módulo!

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
4. **Adicionar ao Conector da IA (`modulos/conversa/servidor/ecossistema.mjs`)** se o módulo contiver informações relevantes para o assistente.

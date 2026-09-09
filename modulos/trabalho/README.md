# Módulo Trabalho (ClickUp)

Módulo independente dentro do Segundo Cérebro. Tudo dele vive nesta pasta:
dá pra zipar `modulos/trabalho/` inteira e pedir novas features sem mandar o
resto do projeto junto.

## O que o app principal precisa saber

Duas linhas, e só. Nada mais no Segundo Cérebro depende deste módulo.

1. Em `src/app.js`:

        import trabalhoRouter from "../modulos/trabalho/servidor/index.js";
        app.use("/trabalho", trabalhoRouter);

2. Em `public/index.html`, depois do `/app.js`:

        <script src="/trabalho/aba-trabalho.js"></script>

Para desligar o módulo, comente as duas. O app volta ao que era.

## Estrutura

    modulos/trabalho/
      servidor/
        index.js        Router do Express. Único ponto de contato com o app.
        rotas.mjs       As rotas, sem framework. (req, url) entra, objeto sai.
        clickup.mjs     Config, chamadas à API do ClickUp, normalização.
        groq.mjs        Ordem de execução via Groq, com heurística de reserva.
      publico/
        trabalho.html   A tela. Usa /estilos.css do app + trabalho.css.
        trabalho.css    Só o que é específico. Zero cor fixa: tudo token.
        trabalho.js     Estado, render, sheet, toast.
        aba-trabalho.js Injeta a aba "Trabalho" no menu do Segundo Cérebro.
      env.example
      README.md

## Rotas

Todas sob o prefixo de montagem, que é `/trabalho`.

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/trabalho` | A tela do módulo |
| GET | `/trabalho/api/health` | Diagnóstico: token, Groq, modo de escrita |
| GET | `/trabalho/api/me` | Usuário do token e workspaces |
| GET | `/trabalho/api/tasks` | Lista de tarefas, com os filtros |
| GET | `/trabalho/api/tasks/:id` | Detalhe com descrição em markdown e subtarefas |
| GET | `/trabalho/api/tasks/:id/statuses` | Status válidos da lista da tarefa |
| POST | `/trabalho/api/tasks/:id/comment` | Comenta na tarefa |
| PUT | `/trabalho/api/tasks/:id/status` | Muda o status |
| POST | `/trabalho/api/plano` | Ordem de execução de até 25 tarefas |

Parâmetros de `/trabalho/api/tasks`:

    closed=1        inclui as concluídas
    subtasks=0      esconde subtarefas
    due=            vencida | hoje | semana | depois | sem-prazo
    atividade=      7 ou 30, em dias desde a última mexida
    q=              busca livre
    space=          filtra por espaço
    ordem=          prazo (padrão) ou atualizada

Escrita exige o cabeçalho `x-clickup-local: 1` e origem igual à da página. A
tela já manda isso.

## Variáveis de ambiente

Ver `env.example`. Só `CLICKUP_API_TOKEN` é obrigatório. `GROQ_API_KEY` o
Segundo Cérebro já tem, e o módulo reaproveita.

## Rodar com dados de exemplo

    MOCK=1 npm start

Sobe sem token, com quatro tarefas fictícias. Bom para mexer no visual.

## Como criar o próximo módulo

1. `modulos/<nome>/servidor/index.js` exportando um Router do Express.
2. `modulos/<nome>/publico/<nome>.html` linkando `/estilos.css` primeiro.
3. Uma cópia de `aba-trabalho.js` com ROTA e ROTULO trocados.
4. Duas linhas no `src/app.js` e uma no `public/index.html`.
5. No `vercel.json`, o `includeFiles` com `modulos/**` já cobre.

Atenção quando isso crescer: cada módulo empilha código no mesmo bundle
serverless da Vercel, que tem limite de 250 MB descompactado. Se algum módulo
trouxer dependência pesada, dê a ele a própria função em `api/` em vez de
pendurar no `api/index.js`.

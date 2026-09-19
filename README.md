# Segundo Cérebro

Um sistema pessoal de memória, conversa e rotina. Você joga texto solto dentro dele e ele
organiza sozinho: resume, classifica, liga com o que você já tinha escrito, e depois conversa
com você em cima disso.

Não é um app de notas com IA colada por cima. A diferença está em três decisões de arquitetura
que atravessam o projeto inteiro, e que vale explicar antes de qualquer instrução de instalação.

## Por que ele funciona assim

### 1. A IA sugere, o código decide

Todo lugar onde um modelo produz um valor que vai ser **usado como número ou como chave**, existe
uma camada de validação depois dele. Não é desconfiança genérica: é que modelo erra com cara de
certo, e erro com cara de certo é o pior tipo.

Exemplos concretos, todos no código:

- No cadastro de equipamento de treino, o modelo sugere o MET (o multiplicador de gasto
  energético). Uma tabela de faixas por tipo corrige o valor se ele sair do plausível. Halter com
  MET 15 viraria "levantar peso queima como corrida de velocidade".
- Na geração da ficha de treino, o modelo escolhe exercícios por id. Id que não existe é
  **descartado**, não aceito. Um exercício com aparelho que você não tem é pior que um exercício
  a menos.
- Na conversa, o que é nota "forte" e o que é "tangente" é decidido por limiar numérico de
  similaridade, não por opinião do modelo.

### 2. Determinismo onde o número importa

Calorias de treino não são pedidas ao modelo. Elas saem da equação padrão do Compendium of
Physical Activities: MET x 3,5 x peso / 200 x minutos.

O motivo é simples: se o modelo estimasse, o mesmo treino daria 180 kcal hoje e 320 amanhã, e o
número pararia de servir pra comparar semana com semana, que é o único uso real dele. Aqui o
mesmo treino dá sempre o mesmo número, e treino melhor dá número maior.

O papel do modelo é outro e é melhor: escolher o MET de uma atividade que não está na tabela.

### 3. Dois modelos, cada um no seu papel

O projeto usa dois provedores ao mesmo tempo, de propósito:

- **Gemini** (modelo forte) para o que precisa de raciocínio: a resposta da conversa, o insight
  sobre as notas, a ficha de treino, a extração estruturada de uma nota nova.
- **Groq** (modelo rápido e barato) para o que precisa de velocidade: classificar o tom da
  mensagem, catalogar um equipamento, achar o MET de uma atividade, gerar a frase de espera
  enquanto o modelo forte pensa.

E tem uma quarta camada, a mais barata de todas: **tabela local**. Antes de chamar a Groq para
saber o MET de uma caminhada, o sistema olha uma tabela. Nove em cada dez atividades comuns são
resolvidas sem nenhuma chamada de rede.

### 4. Núcleo pequeno, módulos plugáveis

O núcleo sabe de uma coisa só: notas com embedding. Tudo o mais é módulo, e módulo é uma pasta
com um `index.js` que exporta um Router do Express e **uma linha** no `src/app.js`.

Para tirar um módulo do ar, comenta a linha. Nada mais no sistema depende dele. Cada módulo tem
suas próprias tabelas, seu próprio cliente de banco e sua própria tela.

## Como rodar

    npm install
    cp env.example .env
    # preencha o .env (veja a seção de variáveis abaixo)
    npm run dev

Sobe em `http://localhost:3333`. O Express serve a API e as telas no mesmo processo: não existe
front separado para rodar.

### Variáveis de ambiente

As obrigatórias:

    SUPABASE_URL            # https://SEU-PROJETO.supabase.co
    SUPABASE_SECRET_KEY     # a chave sb_secret_... (Project Settings > API Keys)
    GEMINI_API_KEYS         # uma ou mais, separadas por vírgula
    GROQ_API_KEY            # o modelo rápido

As opcionais que mudam comportamento:

    PIN_ACESSO              # vazio = sistema aberto. Preenchido = tudo que devolve dado exige PIN
    GEMINI_THINKING         # HIGH por padrão
    FUSO_MINUTOS            # -180 (America/Sao_Paulo). Decide onde o dia começa
    TETO_HEALTH_MS          # 6000. Teto de tempo do health do banco

### O banco

O Supabase guarda tudo. Rode os arquivos de `supabase/` no SQL Editor do projeto, **uma vez cada**:

    supabase/schema.sql         # o núcleo: tabela ideias com pgvector
    supabase/conversa.sql       # o módulo conversa
    supabase/treino.sql         # o módulo treino
    supabase/armazenamento.sql  # função que mede o tamanho real das tabelas

Todos são idempotentes: rodar duas vezes não estraga nada.

## O núcleo

Uma tabela, `ideias`, com o texto original, o resumo, a área, as tags, o tipo, os relacionados e
um embedding de 768 dimensões (Gemini text-embedding-004) indexado com HNSW.

### O que acontece quando você salva uma nota

1. O texto vai inteiro para o Gemini, que devolve resumo, área, tags, tipo e data de evento.
2. O sistema gera o embedding do texto.
3. Compara esse embedding com o de todas as notas existentes, por similaridade de cosseno. Isso é
   conta local, sem custo de modelo, e produz uma lista de **candidatas**.
4. Só as candidatas, não a base inteira, vão para o modelo, que decide quais são de fato
   relacionadas e escreve o motivo de cada ligação.

Esse desenho híbrido evita os dois erros clássicos: mandar a base toda para o modelo a cada nota
nova, que é caro e lento, e confiar na intuição do modelo sem nenhum filtro numérico.

### Insight

O insight lê um recorte das suas notas (por área, por período, por busca) e escreve um texto em
cima delas. Dois eixos o controlam: **ângulo** (panorama, contradição, padrão, ação) e **tamanho**.

Além dos presets, existe um campo de texto livre onde você diz o que precisa daquele recorte
agora, com suas palavras. Esse pedido **manda sobre o preset**: se o que você escreveu conflita
com o ângulo escolhido, o que você escreveu ganha.

### As outras rotas do núcleo

    GET    /ideias              lista, com filtros de área e tipo
    POST   /ideias              cria (a análise automática acontece aqui)
    DELETE /ideias/:id
    GET    /pesquisa?q=         busca semântica
    GET    /insight             o texto sobre um recorte
    POST   /insight/continuar   pergunta de acompanhamento sobre um insight
    GET    /eventos/proximos    os lembretes com data
    POST   /relink              recalcula as ligações de toda a base
    GET    /backup              exporta tudo em JSON
    POST   /restore             importa de volta
    GET    /armazenamento       tamanho real das tabelas, em bytes
    GET    /docs                Swagger da API

## Módulo Conversa

Falar com o segundo cérebro. Ele responde lendo as suas notas.

O que o torna diferente de um chat comum:

**Recuperação com separação de força.** Cada nota trazida pela busca recebe um score. Acima do
limiar ela é "forte", ou seja, fala do assunto; abaixo, é tangente. O modelo recebe as duas
listas rotuladas de formas diferentes, e é instruído a usar a tangente só se ajudar. Sem essa
separação, ele cita uma nota sobre outra coisa com a mesma confiança de uma que é sobre o
assunto.

**Filtro por data de verdade.** "As notas de hoje" não é uma pergunta semântica: nenhuma nota é
parecida com a palavra "hoje", elas são parecidas com jiu-jitsu, com entrevista, com gente.
Quando a mensagem tem expressão de tempo, o sistema **filtra por data** em vez de buscar por
semelhança. Entende hoje, ontem, anteontem, essa semana, mês passado, há 3 dias, dia 12 e 12/09,
e aceita digitação torta: "ontme", "hj", "smeana passada". A tolerância usa distância de
Damerau, que cobra 1 por letra trocada de lugar, que é o erro mais comum.

**Camada de tom.** Antes de responder, um modelo pequeno lê a mensagem e escolhe **como**
responder, entre seis registros: direto, resgate, pensar junto, escuta, execução e exploração.
Isso existe porque um prompt único produz um registro único: o sistema respondia um desabafo com
o mesmo contraponto que usava numa decisão de arquitetura. O registro `escuta` proíbe
explicitamente aconselhar e relativizar.

A mesma camada decide o **tamanho** da resposta, e com ele o teto de tokens. Isso não é enfeite:
com o raciocínio ligado, o pensamento consome do mesmo teto da resposta, então teto curto corta a
resposta no meio.

**A alma.** Um painel onde ficam os traços que ele aprendeu sobre como você escreve, destilados
da conversa, mais uma observação sua. Cada traço tem categoria e contagem de repetição, e você
pode fixar, desligar ou apagar.

## Módulo Trabalho

Ponte com o ClickUp. Lê suas tarefas e usa o modelo rápido para resumir e organizar.

## Módulo Treino

Ficha de treino gerada por IA, com o cálculo de calorias feito por conta.

**Equipamentos.** Você escreve "halteres ajustáveis" e o modelo rápido devolve um rascunho com
resumo, como usar numa ficha, grupos musculares e MET. A tela mostra tudo para você conferir
**antes de salvar**, e nada vai para o banco sem o seu ok. Grupo muscular vem de lista fechada:
se o modelo inventar "core lateral", some, porque senão em seis meses existem quarenta nomes para
a mesma coisa e nenhum filtro funciona.

**A ficha do dia.** O Gemini lê os equipamentos que você tem, o seu perfil e o que você treinou
nos últimos 14 dias, e monta a ficha com o **motivo** da escolha junto. Duas coisas ele não
decide: carga em quilos, porque ele não sabe quanto você levanta, e o MET, que já foi validado no
cadastro.

**O check parcial.** Você marca o que fez. Treino cumprido pela metade vale metade, e é isso que
torna o número honesto. A marcação é otimista: pinta na hora e salva depois, porque esperar a rede
no meio do treino é insuportável.

**O fechamento.** Duração, esforço percebido (leve, moderado, pesado) e o cálculo. O esforço
calibra o MET dentro da faixa do exercício, aproveitando um dado que você ia dar de qualquer
forma. O resultado vem com comparação: a média do ciclo, se foi recorde, a sequência de dias
seguidos, e quanto aquilo representa do seu gasto num dia parado. Nenhuma dessas frases vem de
modelo, todas saem de conta.

**Ciclos de 14 dias.** A sessão vive 14 dias e depois vira uma linha de resumo. Como não existe
processo de fundo na Vercel, a poda acontece quando você abre o dia, dentro de um catch: limpeza
que derruba a tela é pior que lixo acumulado. E o resumo é gravado **antes** da poda, porque
apagar primeiro e falhar na gravação perderia o período para sempre.

## Acesso por PIN

Com `PIN_ACESSO` preenchido, tudo que devolve dado exige o header `x-pin`. A tela pede uma vez, num
modal, valida no servidor **antes** de guardar no navegador, e depois manda sozinha em toda chamada.

A casca (HTML, CSS, JS) continua pública de propósito: sem ela carregar não existe modal onde
digitar o PIN, e a casca não tem dado nenhum. Suas notas estão todas atrás da API.

O lado da tela envolve o `fetch` global em vez de mexer em cada arquivo, então módulo novo já nasce
coberto.

Limite conhecido: PIN curto é quebrável por tentativa e erro. Existe atraso progressivo e bloqueio
após 10 erros, mas em ambiente serverless cada instância tem a própria memória, então o contador
não é confiável entre requisições. Use 8 caracteres ou mais.

## Criando um módulo novo

O contrato inteiro cabe aqui:

    modulos/SEU-MODULO/
      servidor/
        index.js      exporta um Router do Express
        rotas.mjs     a função rotear(req, res, rota, url)
        banco.mjs     cliente próprio do Supabase e as tabelas do módulo
      publico/
        SEU.html      a tela
        SEU.css       só o que é específico; tokens e componentes vêm do /estilos.css
        SEU.js        o comportamento
        aba-SEU.js    injeta o item no menu do app

E no `src/app.js`, duas linhas:

    import seuRouter from "../modulos/SEU-MODULO/servidor/index.js";
    app.use("/SEU-MODULO", seuRouter);

Três armadilhas que já custaram caro neste projeto:

1. **O PIN.** Adicione o caminho da casca em `CASCA`, no `src/acesso.js`. Sem isso a página do
   módulo cai no 401 e o navegador mostra JSON cru em vez da tela.
2. **O CSS.** Use só variáveis que o `/estilos.css` define de verdade: `--fundo`, `--superficie`,
   `--texto`, `--separador`, `--acento`, `--sucesso`, `--perigo`. Variável inexistente **não cai
   em fallback**, ela invalida a regra inteira. Foi assim que os modais do treino nasceram
   transparentes, se sobrepondo uns aos outros.
3. **O fuso.** `current_date` no servidor é UTC. Às 21h no Brasil já virou o dia seguinte. Calcule
   a data local no JS e mande explícita, como o `hojeLocal()` do módulo treino faz.

## Tamanho e custo

Sem vetor, um módulo custa quase nada: uma sessão de treino em JSON dá uns 2 KB.

O peso está nas notas. Cada uma ocupa cerca de 11 KB: 1,4 KB de dados, 5,5 KB no TOAST (onde o
Postgres joga o embedding e o texto longo) e 4,2 KB de índice HNSW. Só 1,4 KB disso é o que você
escreveu; o resto é o preço da busca por significado.

Numa base de 353 notas isso dá 3,9 MB. O número que o painel do Supabase mostra é bem maior porque
ele inclui o que o Supabase instala sozinho: `auth`, `storage`, `realtime` e os catálogos, uns
27 MB que existem num projeto vazio e não crescem com o uso.

A rota `/armazenamento` separa os dois: o que é seu e o banco inteiro.

## Limitações conhecidas

- **Estimativa de caloria erra uns 20%** sem medir batimento cardíaco, venha de onde vier. Serve
  para comparar semana com semana, não para fechar balanço calórico.
- **O gasto basal precisa do sexo** no perfil. Sem ele a função devolve nulo em vez de chutar,
  porque a diferença entre as duas fórmulas é de 166 kcal e contexto errado com cara de certo é
  pior que contexto nenhum.
- **`data_evento` depende do modelo** interpretar datas relativas. Vale revisar lembrete
  importante na mão.
- **Não há multiusuário.** O sistema é de uma pessoa: a alma da conversa e o perfil de treino são
  linha única, com id fixo.
- **Na Vercel não há processo de fundo.** Tudo que seria cron acontece no acesso.


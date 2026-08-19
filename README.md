# Segundo Cérebro API

API em Node.js que recebe ideias/conceitos/lembretes em texto livre e organiza tudo **automaticamente**:
resume, classifica por área, extrai tags, detecta se é um lembrete com data, e relaciona com ideias
antigas — inspirada no livro *Building a Second Brain* (Tiago Forte).


## Como rodar

```bash
npm install
cp .env.example .env
# edite o .env e coloque sua nova GROQ_API_KEY
npm start
```

O servidor sobe em `http://localhost:3333` (ou na porta que você definir em `PORT`).

## Front-end (mural)

Abra `http://localhost:3333` no navegador. O próprio Express serve a interface (pasta `public/`)
no mesmo processo/porta da API — não precisa rodar back e front separados. É um mural estilo
cortiça: cada ideia vira uma "ficha" fixada com um pin colorido por tipo (azul = ideia, roxo =
conceito, vermelho = lembrete/evento). Clicar numa ficha desenha barbantes até as ideias
relacionadas, mostrando o motivo da conexão. O JSON puro da API continua em `/api`, `/ideias`,
`/pesquisa`, `/eventos/proximos`, como antes.

## O objeto "ideia"

Cada `POST /ideias` gera automaticamente um objeto assim:

```json
{
  "id": "uuid",
  "texto_original": "o que voce mandou, sem edicao",
  "resumo": "resumo curto gerado pela LLM (o 'antes de enraizar a ideia inteira')",
  "area": "categoria principal, ex: produtividade",
  "tags": ["tag1", "tag2"],
  "tipo": "ideia | conceito | lembrete_evento",
  "data_evento": "YYYY-MM-DD ou null",
  "relacionados": [
    { "id": "uuid-de-outra-ideia", "motivo": "por que estao relacionadas", "score": 0.81 }
  ],
  "criado_em": "timestamp ISO"
}
```

- `score` vem da similaridade de embeddings (0 a 1), calculada localmente.
- `motivo` é a explicação da LLM sobre por que aquela relação é real (a LLM só pode escolher
  entre as ideias que já passaram no filtro de similaridade — ela não relaciona "no escuro").
- O vetor de embedding fica salvo internamente em `data/ideias.json` mas nunca é devolvido nas
  respostas da API (é grande e não serve pra você ler).

## Endpoints

### Criar uma ideia (100% automático)
```bash
curl -X POST http://localhost:3333/ideias \
  -H "Content-Type: application/json" \
  -d '{"texto": "o fogo e o calor moldaram a culinaria humana ha milhares de anos"}'
```

### Listar ideias (com filtros opcionais)
```bash
curl "http://localhost:3333/ideias?area=culinaria"
curl "http://localhost:3333/ideias?tipo=lembrete_evento"
```

### Ver uma ideia específica
```bash
curl http://localhost:3333/ideias/SEU_ID
```

### Apagar uma ideia
```bash
curl -X DELETE http://localhost:3333/ideias/SEU_ID
```

### Modo pesquisa (busca semântica entre as ideias)
```bash
curl "http://localhost:3333/pesquisa?q=fermentação+e+calor"

# com um paragrafo de insight gerado pela LLM conectando os resultados:
curl "http://localhost:3333/pesquisa?q=fermentação+e+calor&insight=true"
```

### Próximos lembretes/eventos
```bash
curl "http://localhost:3333/eventos/proximos?dias=30"
```

## Como a relação entre ideias funciona (híbrido)

1. Ao chegar um texto novo, a API gera o embedding dele.
2. Compara (localmente, sem custo de LLM) com o embedding de todas as ideias já guardadas,
   usando similaridade de cosseno — isso gera uma lista de **candidatas**.
3. Essas candidatas (só elas, não a base toda) são enviadas pra LLM junto do texto novo.
4. A LLM decide quais candidatas são *realmente* relacionadas e explica o motivo em uma frase.
5. O resultado final junta o `score` (matemático, da etapa 2) com o `motivo` (semântico, da etapa 4).

Isso evita dois problemas comuns: mandar a base inteira pro modelo a cada nova ideia (caro e lento),
e confiar cegamente em "vibes" da LLM sem nenhum filtro numérico.

## Estrutura do projeto

```
src/
  server.js        # entrada da API (Express)
  routes/ideias.js # rotas HTTP
  ideasService.js  # regra de negocio: analise automatica + relacoes hibridas
  groqClient.js     # chamadas para a API da Groq (chat + embeddings)
  db.js             # persistencia em data/ideias.json
  similarity.js     # similaridade de cosseno
data/
  ideias.json       # "banco de dados" local (arquivo unico)
```

## Limitações conhecidas / próximos passos possíveis

- Armazenamento em arquivo JSON é ótimo pra começar, mas não escala bem além de alguns milhares
  de ideias nem para múltiplos processos escrevendo ao mesmo tempo. Se crescer muito, migrar pra
  SQLite é o próximo passo natural (a camada `db.js` foi isolada exatamente pra facilitar essa troca).
- Não há autenticação — é pensado pra rodar localmente, para uso pessoal.
- `data_evento` depende da LLM interpretar corretamente datas relativas ("semana que vem", etc.);
  vale revisar lembretes importantes manualmente.

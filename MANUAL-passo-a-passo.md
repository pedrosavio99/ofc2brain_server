# 2brain v2 - Manual do zero (contas, chaves, local e Vercel)

Guia sem pular etapa. Voce vai criar 3 contas gratuitas (Supabase, Google AI
Studio e Groq), rodar o app local pra testar, e depois subir na Vercel.

Tempo estimado: 30 a 45 min na primeira vez.

---

## 0. O que voce vai ter no final

- **Supabase**: seu banco (Postgres + pgvector) com as 86 ideias.
- **Gemini** (Google AI Studio): gera os embeddings (768 dims).
- **Groq**: faz resumo, classificacao e relacoes.
- **Vercel**: hospeda a API + o mural, sem hibernar como o Render free.

Guarde tudo que for "chave" ou "URL" num bloco de notas temporario. No fim
elas vao pro arquivo `.env` (local) e pro painel da Vercel (producao).

---

## 1. Supabase (banco de dados)

### 1.1. Criar conta e projeto
1. Acesse https://supabase.com e clique em **Start your project** / **Sign in**.
   Da pra entrar com o GitHub (mais rapido).
2. Clique em **New project**.
3. Preencha:
   - **Name**: `2brain` (ou o que quiser).
   - **Database Password**: gere uma forte e **guarde** (voce nao precisa dela
     pro app, mas o Supabase pede).
   - **Region**: escolha a mais perto (ex: `South America (Sao Paulo)`).
4. Clique em **Create new project** e espere ~2 min ate provisionar.

### 1.2. Criar as tabelas (rodar o schema)
1. No menu lateral, abra **SQL Editor**.
2. Clique em **New query**.
3. Abra o arquivo `supabase/schema.sql` do projeto, **copie tudo** e cole no editor.
4. Clique em **Run** (ou Ctrl/Cmd + Enter).
5. Deve aparecer "Success. No rows returned". Isso cria a tabela `ideias`, o
   pgvector e a funcao de busca `match_ideias`.

### 1.3. Pegar a URL e a SECRET key
1. No menu lateral, va em **Settings** (engrenagem) > **API Keys**.
2. Na aba **API Keys**:
   - Se aparecer um botao **Create new API keys**, clique (cria as chaves novas
     no formato `sb_publishable_...` e `sb_secret_...`).
   - Copie o valor da secao **Secret keys** (comeca com `sb_secret_...`).
     Essa e a que o app usa. NAO use a publishable aqui.
3. Ainda em **Settings**, va em **Data API** (ou **API**) e copie a
   **Project URL** (algo como `https://xxxxxxxx.supabase.co`).

> Se o seu projeto for antigo e so tiver as chaves legadas, use a
> **service_role key** (aba Legacy API Keys). Ela ainda funciona, mas sera
> descontinuada ate o fim de 2026. Prefira a secret nova.

Guardou dois valores:
```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

---

## 2. Gemini (embeddings) - Google AI Studio

1. Acesse https://aistudio.google.com e entre com sua conta Google.
2. Clique em **Get API key** (canto/menu) > **Create API key**.
3. Copie a chave gerada. Guarde:
```
GEMINI_API_KEYS=cole_a_chave_aqui
```
> Dica: da pra criar 2 chaves em projetos Google diferentes e por as duas
> separadas por virgula (`chave1,chave2`). O app faz rodizio e aguenta melhor
> o limite da camada gratuita. Uma chave so tambem funciona.

---

## 3. Groq (LLM: resumo, classificacao, relacoes)

1. Acesse https://console.groq.com e crie a conta (da pra usar Google/GitHub).
2. No menu, va em **API Keys** > **Create API Key**.
3. Copie a chave (comeca com `gsk_...`). Guarde:
```
GROQ_API_KEY=gsk_...
```

---

## 4. Rodar LOCAL (testar antes de subir)

Pre requisito: **Node 20+** instalado (`node -v` pra conferir).

1. Descompacte o projeto e entre na pasta pelo terminal:
   ```
   cd 2brain-completo
   ```
2. Crie o arquivo `.env` a partir do exemplo:
   ```
   cp env.example .env
   ```
3. Abra o `.env` e preencha com o que voce guardou:
   ```
   SUPABASE_URL=https://xxxxxxxx.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   GEMINI_API_KEYS=sua_chave_gemini
   GROQ_API_KEY=gsk_sua_chave_groq
   ```
4. Instale as dependencias:
   ```
   npm install
   ```
5. **Seed** (leva suas 86 ideias do arquivo pro Supabase):
   ```
   npm run seed
   ```
   Vai imprimindo `ok (1/86)`, `ok (2/86)`... Se aparecer alguma falha de cota
   do Gemini, espere um pouco e rode `npm run seed` de novo (e idempotente, nao
   duplica).
6. Suba o app:
   ```
   npm run dev
   ```
7. Teste no navegador:
   - http://localhost:3333/  -> o mural com suas ideias
   - http://localhost:3333/health -> `{"status":"ok"}`

Se o mural abrir com as notas, a migracao funcionou. Pode parar (Ctrl+C) e ir
pra Vercel.

---

## 5. Subir na VERCEL

A Vercel puxa o codigo de um repositorio Git. Passo a passo:

### 5.1. Por o codigo no GitHub
1. Crie um repo novo no GitHub (pode ser **privado**; suas notas nao ficam no
   codigo, mas privado e mais seguro).
2. Na pasta do projeto:
   ```
   git init
   git add .
   git commit -m "2brain v2: supabase + vercel"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/2brain.git
   git push -u origin main
   ```
   > O `.gitignore` ja ignora `.env`, `node_modules` e afins. Confirme que o
   > `.env` NAO foi para o commit.

### 5.2. Importar na Vercel
1. Acesse https://vercel.com e entre com o GitHub.
2. Clique em **Add New...** > **Project**.
3. Escolha o repo `2brain` e clique em **Import**.
4. Em **Framework Preset**, deixe **Other** (nao e Next.js). Nao precisa mexer
   em build command nem output dir; o `vercel.json` ja cuida do roteamento.

### 5.3. Cadastrar as variaveis de ambiente
Antes de clicar em Deploy, abra **Environment Variables** e adicione (uma a
uma, Name/Value):
```
SUPABASE_URL          https://xxxxxxxx.supabase.co
SUPABASE_SECRET_KEY   sb_secret_...
GEMINI_API_KEYS       sua_chave_gemini
GROQ_API_KEY          gsk_sua_chave_groq
```
> A porta (`PORT`) a Vercel injeta sozinha, nao precisa cadastrar.
> Se voce ja fez o seed local, os dados JA estao no Supabase; a Vercel vai ler
> os mesmos. Nao precisa rodar seed de novo.

### 5.4. Deploy
1. Clique em **Deploy** e espere o build.
2. Ao terminar, a Vercel te da uma URL tipo `https://2brain-xxxx.vercel.app`.
3. Teste:
   - `https://SUA-URL.vercel.app/health` -> `{"status":"ok"}`
   - `https://SUA-URL.vercel.app/` -> o mural com as ideias

Pronto. A partir daqui, todo `git push` na branch `main` faz a Vercel
re-deployar sozinha.

---

## 6. Checklist rapido

- [ ] Projeto Supabase criado e `schema.sql` rodado (Success).
- [ ] `SUPABASE_URL` e `SUPABASE_SECRET_KEY` copiados.
- [ ] Chave do Gemini e do Groq em maos.
- [ ] `.env` preenchido, `npm install`, `npm run seed`, mural abriu local.
- [ ] Repo no GitHub sem o `.env`.
- [ ] Variaveis cadastradas na Vercel.
- [ ] `/health` e `/` respondendo na URL da Vercel.

---

## 7. Deu problema? (os mais comuns)

- **`/ideias` retorna 500 e o log fala de Supabase**: URL ou secret key errada,
  ou o `schema.sql` nao foi rodado. Confira os 3.
- **Seed falha com erro de cota (429) do Gemini**: espere 1 min e rode
  `npm run seed` de novo. Use 2 chaves no `GEMINI_API_KEYS` pra folgar.
- **Mural abre vazio**: o seed nao rodou ou apontou pra outro projeto Supabase.
  Rode `npm run seed` com o `.env` certo.
- **Banco "pausado" depois de dias parado**: no plano free o Supabase pausa apos
  ~7 dias sem uso. Abra o projeto no painel pra religar.
- **`POST /relink` na Vercel retorna 501**: e proposital (job longo nao roda em
  serverless). Rode local: `npm run relink`.

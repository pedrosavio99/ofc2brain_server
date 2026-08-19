# 2brain v2: Supabase + Gemini embeddings + Vercel

Migracao do motor de arquivo binario (`2brain.bin`, em RAM) para um app
**stateless** que roda em **Vercel serverless** (sem hibernar como o Render
free), com dados no **Supabase** (Postgres + pgvector) e embeddings via
**Gemini text-embedding-004** (768 dims).

## Por que a mudanca era obrigatoria

O motor antigo carregava o modelo de embedding local (~450MB, onnxruntime)
dentro do processo e mantinha tudo em RAM. Isso nao roda em funcao serverless
(limite de tamanho, cold start recarregando o modelo, `/tmp` efemero). A v2
troca o embedding local por uma chamada HTTP ao Gemini (stateless) e o arquivo
em RAM pelo Supabase. Consequencia: os embeddings mudaram de 384 para 768 dims,
entao **todos precisam ser regerados** (o seed faz isso).

## O que mudou no codigo

- `src/embeddings.js`: Gemini `text-embedding-004` (era @xenova local).
- `src/db.supabase.js`: nova camada de dados (mesma interface do antigo).
- `src/db.js`: passa a reexportar do Supabase.
- `src/app.js`: app Express exportado (sem `listen`).
- `src/server.js`: so o `listen` local.
- `api/index.js` + `vercel.json`: entrada serverless da Vercel.
- `supabase/schema.sql`: tabela + pgvector + funcao `match_ideias`.
- `scripts/seed-supabase.mjs`: seed dos dados do `.bin` pro Supabase.
- `scripts/relink.mjs`: reconstrucao (rode local; em serverless da 501).
- backup agora e **JSON** (o `.bin` deixou de existir).

---

## Passo a passo

### 1. Supabase
1. Crie um projeto em supabase.com.
2. SQL Editor -> cole e rode `supabase/schema.sql`.
3. Settings > API Keys: pegue `URL` e a **secret key** (sb_secret_...).

### 2. .env local
Copie `env.example` para `.env` e preencha:
```
SUPABASE_URL=...
SUPABASE_SECRET_KEY=sb_secret_...  (secret key, nao a publishable)
GEMINI_API_KEYS=chave1,chave2
GROQ_API_KEY=...
```

### 3. Seed (leva os seus dados atuais pro Supabase)
```
npm install
npm run seed
```
Le `data/2brain.bin` (86 ideias), regera cada embedding no Gemini e faz upsert
no Supabase. E idempotente: pode rodar de novo sem duplicar.

### 4. Testar local
```
npm run dev
# http://localhost:3333/  (mural)
# http://localhost:3333/health -> {"status":"ok"}
```

### 5. Deploy na Vercel
1. Suba o repo no GitHub e importe na Vercel (ou `vercel` pela CLI).
2. Em Project Settings > Environment Variables, cadastre as MESMAS do `.env`
   (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `GEMINI_API_KEYS`, `GROQ_API_KEY`).
3. Deploy. O `public/` vai pro CDN e o resto cai na funcao `api/index.js`.

### 6. Relink (opcional)
Os `relacionados` do seed vieram do espaco antigo (384d). Se quiser reconstruir
as relacoes no espaco novo:
```
npm run relink
```
Roda local, sem limite de tempo, apontando pro mesmo Supabase do `.env`.

---

## Coisas pra saber (sem susto)

- **Supabase free pausa o banco apos ~7 dias sem atividade.** Uso normal
  mantem ativo; se pausar, basta abrir o projeto no painel.
- **Vercel nao hiberna como o Render free** (nada de 30-60s de wake-up), mas
  cada request pode ter cold start (rapido). Pra sua carga, tranquilo.
- **Backup virou JSON** (`GET /backup` baixa `.json`; `POST /restore` recebe JSON).
- **`POST /relink` em producao retorna 501** de proposito: e job longo, roda local.
- O `Dockerfile` e o `scripts/prewarm.js` antigos eram do deploy em container
  com modelo local. Nao sao usados na Vercel.

# Deploy no Home Cloud Platform

Este repo ja sai no formato do manual (`Dockerfile` na raiz, `/health`, porta por
ENV, `0.0.0.0`, logs no stdout, stateless via Postgres). Passo a passo:

## 1. Antes de subir o repo

- Deixe o repo **publico** e no branch **main**.
- **Nao comite** `.env`, `data/ideias.json` (suas notas) nem `data/2brain.db*`.
  O `.gitignore` ja cobre isso. Repo publico = ninguem pode ver suas anotacoes.
- Confirme que o `Dockerfile` esta na **raiz** (esta).

## 2. Banco (o ponto do "stateless")

O app guarda ideias + embeddings. Em container stateless, disco local se perde.
Por isso, em producao use Postgres:

- Crie um Postgres (ex: Neon) e pegue a connection string.
- No formulario do app, cadastre as variaveis (uma por linha):

```
DATABASE_URL=postgres://usuario:senha@host:5432/banco
GROQ_API_KEY=sua_chave_groq
```

Sem `DATABASE_URL` o app ainda sobe, mas usa SQLite local e **as notas somem em
todo restart/escala/pause** (so p/ teste rapido, nunca p/ uso real).

Obs. SSL: Neon e a maioria dos gerenciados exigem SSL (ja e o padrao). Se o seu
Postgres for interno sem SSL, adicione `PGSSL=false`.

## 3. Formulario do app

- **Porta:** `3333` (bate com o `EXPOSE` e com o `PORT` que o app le).
- **Dominio:** o que voce quiser; p/ teste sem DNS use `nome.SEU_IP.nip.io`.
- **Variaveis:** `DATABASE_URL` e `GROQ_API_KEY` (a plataforma injeta `PORT` sozinha).

## 4. Depois que ficar online

O banco novo comeca vazio. Popular/religar as conexoes:

- Adicione ideias pelo mural (`https://SEU_DOMINIO/`), ou
- Se migrou dados, rode o relink uma vez:
  ```
  curl -X POST https://SEU_DOMINIO/relink
  ```

Health e endpoints:
- `https://SEU_DOMINIO/health` -> `{ "status": "ok" }`
- `https://SEU_DOMINIO/` -> mural
- `https://SEU_DOMINIO/api` -> lista de endpoints

## 5. Sobre o build

- Base **Debian slim** (nao Alpine): o motor de embedding (onnxruntime) e o
  better-sqlite3 nao tem binario pra musl/Alpine.
- O modelo de embedding (~450MB) e **pre-baixado no build** (`scripts/prewarm.js`)
  e assado na imagem, entao nao ha download no cold start. Se o build da plataforma
  nao tiver internet, o prewarm e pulado sem falhar e o modelo baixa no 1o uso.
- `better-sqlite3` e dependencia **opcional**: em producao (Postgres) ele nem e
  carregado; se o build nativo dele falhar, o deploy continua.

## Checklist do manual (todos atendidos)

- [x] `Dockerfile` na raiz
- [x] Le a porta de `process.env.PORT` e escuta em `0.0.0.0:$PORT`
- [x] `GET /health` responde 200 rapido (sem tocar o banco)
- [x] Logs no stdout/stderr
- [x] Stateless (Postgres via `DATABASE_URL`)
- [x] Config/segredos por variavel de ambiente
- [x] Porta do formulario = `PORT` = `EXPOSE` (3333)

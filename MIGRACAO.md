# Migração para v2 (SQLite + embeddings multilíngues + relink)

## O que mudou e por quê

**Problema de linkar.** As ligações não apareciam por três motivos somados: o corte fixo
de `0.55` cortava candidatas óbvias (o par PaaS<>PaaS dava 0.42 e ficava de fora), o modelo
`all-MiniLM-L6-v2` é fraco em português e comprimia as similaridades numa faixa estreita, e o
grafo era congelado no insert (nunca recalculado). Agora: pré-seleção por **top-K com piso baixo
(0.30)** deixando o LLM ser o filtro de precisão, **modelo multilíngue** que entende PT, e uma
rota **`POST /relink`** que reconstrói o grafo inteiro.

**Escala.** O gargalo real não era a busca (força bruta sobre alguns milhares de vetores é
milissegundos), e sim o `ideias.json` sendo reescrito inteiro a cada gravação. Trocado por
**SQLite** (`better-sqlite3`): escrita incremental, transacional, índices por área/tipo/data,
embedding guardado como BLOB de `Float32Array`. A varredura de similaridade roda sobre uma
matriz `Float32Array` única em memória (dot de vetores normalizados = cosseno). Isso segura
tranquilo dezenas de milhares de ideias. Só acima de ~100k valeria plugar um índice ANN
(hnswlib), e a interface já está isolada em `db.topKSimilares` para trocar sem mexer no resto.

O mural (front) e os endpoints existentes continuam **idênticos**.

## Passo a passo

1. Instale a nova dependência:
   ```bash
   npm install
   ```
   (compila o `better-sqlite3`; precisa de build tools no sistema, coisa padrão)

2. Atualize seu `.env` com as novas chaves (veja `env.example`): `MODELO_EMBEDDING`,
   `PISO_SIMILARIDADE`, `MAX_CANDIDATOS`.

3. Suba o servidor:
   ```bash
   npm start
   ```
   No primeiro boot, se existir `data/ideias.json`, os textos são importados automaticamente
   para o SQLite (`data/2brain.db`). Os embeddings antigos são descartados de propósito, porque
   o modelo mudou.

4. Reconstrua embeddings e ligações uma vez:
   ```bash
   curl -X POST http://localhost:3333/relink
   ```
   Resposta: `{ ok: true, ideias, relacoes, modelo }`. Rode esse comando sempre que trocar de
   modelo de embedding.

## Observações

- O `data/2brain.db` (e `.db-wal`, `.db-shm`) não deve ir pro git. Adicione ao `.gitignore`:
  ```
  data/2brain.db
  data/2brain.db-*
  ```
- O `data/ideias.json` antigo pode ficar como backup; ele só é lido se o banco estiver vazio.
- A primeira geração de embedding baixa o modelo multilíngue (algumas centenas de MB, uma vez só).
- `src/similarity.js` não precisou mudar (a varredura em escala migrou para `db.js`).

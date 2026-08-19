FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV MODEL_CACHE_DIR=/app/.cache

# Base Debian (glibc) de proposito: o onnxruntime (embeddings) nao tem binario
# pra Alpine/musl. Sem better-sqlite3 nao ha mais modulo nativo pra compilar,
# entao o build dispensa python3/make/g++ e ficou mais leve e rapido.
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Onde fica o arquivo binario de dados. Monte um volume nesse caminho pra que
# as ideias sobrevivam a reinicios/deploys. Sem volume, use GET /backup antes
# e POST /restore depois.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Assa o modelo de embedding dentro da imagem (evita download no cold start).
# Nao-fatal: se o build nao tiver internet, o modelo baixa no primeiro uso.
RUN node scripts/prewarm.js || true

ENV PORT=3333
EXPOSE 3333
CMD ["npm","start"]
# ---- build: ставим все зависимости и собираем UI ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: только прод-зависимости ----
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3001
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src ./src
RUN mkdir -p /data
EXPOSE 3001
CMD ["node", "--disable-warning=ExperimentalWarning", "node_modules/tsx/dist/cli.mjs", "src/server/index.ts"]

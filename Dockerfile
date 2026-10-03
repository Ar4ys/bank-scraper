FROM node:26-slim

RUN npm install --global pnpm@12.6.0

WORKDIR /app

# Manifests first, so that the install layer is reused until a dependency changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/admin/package.json packages/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/userscript/package.json packages/userscript/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @bank-scraper/admin run build

ARG APP_GIT_COMMIT=unknown
ENV APP_GIT_COMMIT=$APP_GIT_COMMIT \
	HTTP_HOST=0.0.0.0 \
	HTTP_PORT=8585 \
	SQLITE_DB_PATH=/data/bank-scraper.db

VOLUME /data
EXPOSE 8585

WORKDIR /app/packages/api
CMD ["node", "src/server.ts"]

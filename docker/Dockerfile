FROM node:24-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/platform-bff/package.json services/platform-bff/package.json
COPY services/model-gateway/package.json services/model-gateway/package.json
RUN pnpm install --frozen-lockfile

COPY services/platform-bff services/platform-bff
COPY services/model-gateway services/model-gateway
RUN pnpm run build

FROM node:24-bookworm-slim AS runtime
RUN groupadd --system dps && useradd --system --gid dps --create-home dps
WORKDIR /app
COPY --from=build --chown=dps:dps /app /app
ENV NODE_ENV=production
USER dps
EXPOSE 3000 4000
CMD ["node", "services/platform-bff/dist/index.js"]

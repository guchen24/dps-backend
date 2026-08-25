# dps-backend

DeepSeek Harness Host, Web UI build, and Docker deployment for the dps local
product. This repository keeps the official Harness workspace layout because
`dsh web` assembles Host, Typert, Client, and Vite artifacts from one build.

## Repository layout

```text
apps/      CLI and Web UI entrypoints
packages/  Host, Client, Typert, and runtime packages
vendor/    vendored runtime dependencies
docker/    Dockerfile, Compose file, and deployment helpers
```

Only these four source directories are needed for the backend build and local
Docker deployment.

## Docker deployment

```powershell
cd docker
Copy-Item .env.example .env
# Edit .env and set DEEPSEEK_API_KEY.
docker compose up -d --build
```

The service is published only at `http://127.0.0.1:3080`. The API key stays in
the ignored `docker/.env`; it is never part of the image source, Web UI, or
desktop executable. `dps-frontend` is the companion Tauri shell:
https://github.com/guchen24/dps-frontend

## Source development

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm dsh web --no-open
```

The `docker/` directory contains the only supported local Docker deployment.

## Upstream

This is a dps overlay over the MIT-licensed
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), pinned to
`dsh-v0.1.1-rc.2` (`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`).

## License

[MIT](LICENSE)

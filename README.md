# dps-backend

DeepSeek Harness Host, Web UI build, and Docker deployment for the dps local
product. This repository keeps the official Harness workspace layout because
`dsh web` assembles Host, Typert, Client, and Vite artifacts from one build.

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
pnpm test
pnpm dsh web --no-open
```

The `backend/` directory contains the source-development entry scripts. The
`docker/` directory contains the only supported local Docker deployment.

## Upstream

This is a dps overlay over the MIT-licensed
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). See
[`UPSTREAMS.md`](UPSTREAMS.md) for the pinned baseline and upgrade policy.

## License

[MIT](LICENSE)

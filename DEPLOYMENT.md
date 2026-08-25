# Backend deployment

## Docker

From the repository root:

```powershell
cd docker
Copy-Item .env.example .env
# Set DEEPSEEK_API_KEY in docker/.env.
docker compose up -d --build
docker compose ps
```

The Compose service publishes only `127.0.0.1:3080:3080`, uses the persistent
`dps-dsh-home` volume, and keeps the API key outside Git. Set `DSH_WORKSPACE` in
`docker/.env` when the default `../workspace` path is not suitable.

## Source Host

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm dsh web --no-open
```

The full build is required after Host, DTO, Context, Lookup, or Client contract
changes so Typert and the Vite Web UI stay synchronized.

## Companion desktop shell

The independent Tauri shell is maintained in
https://github.com/guchen24/dps-frontend. It loads this backend at
`http://127.0.0.1:3080` and contains no API key.

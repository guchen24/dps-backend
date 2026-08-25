# Local Docker backend

This is the only Docker deployment entry for dps. It builds the Harness source
from the repository root and publishes the Web UI and `/api` only at
`127.0.0.1:3080`.

## First run

```powershell
Copy-Item .env.example .env
# Edit .env and set DEEPSEEK_API_KEY.
docker compose up -d --build
```

Open `http://127.0.0.1:3080/`, or use the companion Tauri shell from
https://github.com/guchen24/dps-frontend after building it.

## Daily operations

```powershell
docker compose ps
docker compose logs -f harness
docker compose up -d
docker compose down
```

The ignored `.env` holds the API key and must never be committed. Harness
state persists in the `dps-dsh-home` volume; the legacy `dsh-data` volume is
not modified. The mounted working directory defaults to `../workspace` and
can be changed with `DSH_WORKSPACE` in `.env`.

`support/` contains Docker-only launch and build helpers. It is not a second
deployment entry.

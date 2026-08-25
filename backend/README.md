# Backend development entry

This directory is the day-to-day entry for the DeepSeek Harness Host and CLI.
The official source remains in its upstream-compatible paths:

- `apps/cli` — the `dsh` command and Web host assembly.
- `packages/host` — Host-only capabilities and runtime integrations.
- `packages/*` (except `packages/client`) — shared and server-side packages.

Use `./dev.ps1` to build the complete Host → Typert → Client → Web chain and
start a local source Web profile. Use `./test.ps1` for the Host-focused checks.
For the Docker deployment, use `../docker/` instead.

Do not add API keys to this directory. Docker reads protected settings only
from the ignored `docker/.env` file.

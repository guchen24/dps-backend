# DPS Platform Backend

Backend runtime for the local DPS Platform: BFF, model gateway, PostgreSQL, three isolated Harness Runtime slots and the only published Gateway port.

Build the frontend image first from the sibling `dps-frontend` repository:

```powershell
cd "D:\Desktop\deepseek h\dps-frontend"
docker build -t dps-platform-frontend:0.1.0 .
```

Then copy `docker/.env.example` to `docker/.env`, preserve the private Key source, and start from this repository:

```powershell
cd "D:\Desktop\deepseek h\dps-backend"
docker compose --env-file docker\.env -f docker\compose.yaml up -d --build
```

Only `127.0.0.1:3080` is published. The frontend is an internal `portal` service routed by Gateway at `/_platform/`; the BFF remains responsible for authentication and all API authorization.

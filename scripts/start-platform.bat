@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
pushd "%ROOT%" || exit /b 1

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not installed. Download it from https://www.docker.com/products/docker-desktop/
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not running. Start Docker Desktop and run this script again.
  exit /b 1
)

if not exist "docker\.env" (
  echo [ERROR] Missing docker\.env. Copy docker\.env.example to docker\.env and fill the required administrator, session and database values.
  exit /b 1
)

if not exist "..\dps-frontend\Dockerfile" (
  echo [ERROR] Missing sibling frontend repository: ..\dps-frontend
  exit /b 1
)

echo [1/3] Building the Portal frontend image...
docker build -t dps-platform-frontend:0.1.0 "..\dps-frontend"
if errorlevel 1 goto :diagnose

echo [2/3] Starting the DPS Platform stack...
docker compose --env-file docker\.env -f docker\compose.yaml up -d --build
if errorlevel 1 goto :diagnose

echo [3/3] Checking Gateway, BFF and all three Runtime slots...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\ops\health.ps1"
if errorlevel 1 goto :diagnose

echo [OK] Platform is ready at http://127.0.0.1:3080/
start "DPS Platform" http://127.0.0.1:3080/
popd
exit /b 0

:diagnose
echo.
echo [ERROR] Platform startup or health verification failed. Current diagnostics:
docker compose --env-file docker\.env -f docker\compose.yaml ps
docker compose --env-file docker\.env -f docker\compose.yaml logs --tail 80
popd
exit /b 1

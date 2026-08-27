[CmdletBinding()]
param([Parameter(Mandatory)] [string]$BackupPath, [switch]$ConfirmRestore)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) { throw 'Restore overwrites the platform database and runtime volumes. Re-run with -ConfirmRestore after verifying the backup path.' }
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.yaml'
$envFile = Join-Path $root 'docker\.env'
$backupRoot = (Resolve-Path -LiteralPath $BackupPath).Path
$databaseBackup = Join-Path $backupRoot 'platform.sql'
if (-not (Test-Path -LiteralPath $databaseBackup)) { throw 'Backup must contain platform.sql.' }
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile." }

& docker compose --env-file $envFile -f $compose down
& docker compose --env-file $envFile -f $compose up -d postgres
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  & docker compose --env-file $envFile -f $compose exec -T postgres pg_isready -U dps_platform -d dps_platform | Out-Null
  if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1
}
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not become ready.' }
& docker cp $databaseBackup 'dps-platform-postgres:/tmp/platform.sql'
& docker compose --env-file $envFile -f $compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" && psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/platform.sql'
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL restore failed.' }
& docker compose --env-file $envFile -f $compose exec -T postgres rm -f /tmp/platform.sql | Out-Null

foreach ($volume in @('dps-dsh-home-01', 'dps-dsh-home-02', 'dps-dsh-home-03', 'dps-workspace-01', 'dps-workspace-02', 'dps-workspace-03')) {
  $archive = Join-Path $backupRoot "$volume.tar.gz"
  if (-not (Test-Path -LiteralPath $archive)) { continue }
  & docker volume create $volume | Out-Null
  & docker run --rm --mount "type=volume,src=$volume,dst=/target" alpine:3.20 sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  & docker run --rm --mount "type=volume,src=$volume,dst=/target" --mount "type=bind,src=$backupRoot,dst=/backup,readonly" alpine:3.20 sh -c "tar xzf /backup/$volume.tar.gz -C /target"
  if ($LASTEXITCODE -ne 0) { throw "Restore failed for $volume." }
}
& docker compose --env-file $envFile -f $compose up -d
if ($LASTEXITCODE -ne 0) { throw 'Restore completed, but the platform did not start.' }
& "$PSScriptRoot\health.ps1"

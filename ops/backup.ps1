[CmdletBinding()]
param([string]$Destination = (Join-Path $PSScriptRoot 'backups'))

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.yaml'
$envFile = Join-Path $root 'docker\.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile. Copy docker\\.env.example first." }
& docker info | Out-Null
& docker compose --env-file $envFile -f $compose config --quiet

$backupRoot = Join-Path $Destination ("dps-platform-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$databaseBackup = Join-Path $backupRoot 'platform.sql'
try {
  & docker compose --env-file $envFile -f $compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges > /tmp/platform.sql'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed.' }
  & docker cp 'dps-platform-postgres:/tmp/platform.sql' $databaseBackup
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy PostgreSQL backup.' }
} finally { & docker compose --env-file $envFile -f $compose exec -T postgres rm -f /tmp/platform.sql | Out-Null }

$resolved = (Resolve-Path -LiteralPath $backupRoot).Path
$hashes = @{ 'platform.sql' = (Get-FileHash -Algorithm SHA256 -LiteralPath $databaseBackup).Hash }
foreach ($volume in @('dps-dsh-home', 'dps-dsh-home-01', 'dps-dsh-home-02', 'dps-dsh-home-03', 'dps-workspace-01', 'dps-workspace-02', 'dps-workspace-03')) {
  if ((& docker volume inspect $volume 2>$null)) {
    $file = "$volume.tar.gz"
    & docker run --rm --mount "type=volume,src=$volume,dst=/source,readonly" --mount "type=bind,src=$resolved,dst=/backup" alpine:3.20 sh -c "tar czf /backup/$file -C /source ."
    if ($LASTEXITCODE -ne 0) { throw "Backup failed for $volume." }
    $hashes[$file] = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupRoot $file)).Hash
  }
}
$manifest = [ordered]@{ createdAt = (Get-Date).ToUniversalTime().ToString('o'); database = 'platform.sql'; sha256 = $hashes }
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backupRoot 'manifest.json') -Encoding utf8
Write-Host "Backup complete: $backupRoot"

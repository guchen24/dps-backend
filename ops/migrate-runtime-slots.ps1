[CmdletBinding()]
param([switch]$ConfirmMigration)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmMigration) { throw 'This copies the existing shared Harness state into runtime slot 01. Re-run with -ConfirmMigration after reviewing the current backup.' }
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.yaml'
$envFile = Join-Path $root 'docker\.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile." }

& "$PSScriptRoot\backup.ps1"
& docker inspect dsh-harness-backend | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The legacy dsh-harness-backend container is required for one-time migration.' }

foreach ($volume in @('dps-dsh-home-01', 'dps-dsh-home-02', 'dps-dsh-home-03', 'dps-workspace-01', 'dps-workspace-02', 'dps-workspace-03')) {
  & docker volume create $volume | Out-Null
}
foreach ($volume in @('dps-dsh-home-01', 'dps-workspace-01')) {
  $contents = (& docker run --rm --mount "type=volume,src=$volume,dst=/target" alpine:3.20 sh -c 'test -z "$(ls -A /target)" && echo empty || echo nonempty').Trim()
  if ($contents -ne 'empty') { throw "$volume is not empty; refusing to overwrite it." }
}

& docker run --rm --volumes-from dsh-harness-backend:ro --mount 'type=volume,src=dps-dsh-home-01,dst=/target' alpine:3.20 sh -c 'tar -C /home/dsh/.dsh -cf - . | tar -C /target -xf -'
if ($LASTEXITCODE -ne 0) { throw 'Could not copy legacy DSH_HOME into slot 01.' }
& docker run --rm --volumes-from dsh-harness-backend:ro --mount 'type=volume,src=dps-workspace-01,dst=/target' alpine:3.20 sh -c 'tar -C /workspace -cf - . | tar -C /target -xf -'
if ($LASTEXITCODE -ne 0) { throw 'Could not copy legacy workspace into slot 01.' }

& docker compose --env-file $envFile -f $compose up -d --build --remove-orphans
if ($LASTEXITCODE -ne 0) { throw 'Runtime data was copied, but the new platform stack did not start.' }
& "$PSScriptRoot\health.ps1"
Write-Host 'Migration complete. Slot 01 contains the legacy administrator data; the legacy dps-dsh-home volume remains unchanged.'

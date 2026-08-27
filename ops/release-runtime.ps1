[CmdletBinding()]
param([Parameter(Mandatory)][ValidateRange(1, 3)][int]$Slot, [switch]$ConfirmRelease)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRelease) { throw 'This permanently clears the selected user runtime and releases its slot. Re-run with -ConfirmRelease only after disabling the user.' }
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.yaml'
$envFile = Join-Path $root 'docker\.env'
$row = (& docker compose --env-file $envFile -f $compose exec -T postgres psql -U dps_platform -d dps_platform -Atc "SELECT u.id || ':' || u.active::text FROM user_runtimes r JOIN users u ON u.id=r.user_id WHERE r.slot=$Slot AND r.released_at IS NULL;").Trim()
if (-not $row) { throw "Runtime slot $Slot is already unassigned." }
$parts = $row.Split(':')
if ($parts[1] -ne 'f') { throw 'Disable the user in the administrator page before releasing its runtime.' }
foreach ($volume in @("dps-dsh-home-0$Slot", "dps-workspace-0$Slot")) {
  & docker run --rm --mount "type=volume,src=$volume,dst=/target" alpine:3.20 sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
  if ($LASTEXITCODE -ne 0) { throw "Could not clear $volume." }
}
& docker compose --env-file $envFile -f $compose exec -T postgres psql -U dps_platform -d dps_platform -c "UPDATE user_runtimes SET released_at=NOW() WHERE slot=$Slot AND released_at IS NULL;"
Write-Host "Runtime slot $Slot was cleared and released. Its disabled user remains in audit history."

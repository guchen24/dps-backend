[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root 'docker\compose.yaml'
$envFile = Join-Path $root 'docker\.env'
$gatewayUrl = 'http://127.0.0.1:3080/healthz'

if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile. Copy docker\\.env.example first." }
& docker info | Out-Null
& docker compose --env-file $envFile -f $compose config --quiet

$containers = @('dps-platform-postgres', 'dps-platform-portal', 'dps-model-gateway', 'dsh-harness-01', 'dsh-harness-02', 'dsh-harness-03', 'dps-platform-bff', 'dsh-harness-gateway')
foreach ($container in $containers) {
  $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $container).Trim()
  if ($LASTEXITCODE -ne 0 -or $status -ne 'healthy') { throw "$container is not healthy (status: $status)." }
  Write-Host "OK  $container ($status)"
}

$response = Invoke-WebRequest -UseBasicParsing -Uri $gatewayUrl -TimeoutSec 10
if (-not $response.StatusCode.ToString().StartsWith('2')) { throw "Gateway health endpoint returned HTTP $($response.StatusCode)." }
Write-Host "OK  gateway endpoint ($($response.StatusCode))"
Write-Host 'Platform health check passed.'

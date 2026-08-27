[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Email,
  [Parameter(Mandatory)][string]$Password
)

$ErrorActionPreference = 'Stop'
$baseUrl = 'http://127.0.0.1:3080'

function Assert-Status {
  param([int]$Actual, [int]$Expected, [string]$Name)
  if ($Actual -ne $Expected) { throw "$Name expected HTTP $Expected, received $Actual." }
}

& (Join-Path $PSScriptRoot 'health.ps1')

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try {
  $login = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/_platform/api/auth/login" -Method Post -WebSession $session -ContentType 'application/json' -Body (@{ email = $Email; password = $Password } | ConvertTo-Json) -ErrorAction Stop
  Assert-Status $login.StatusCode 200 'login'

  $rpc = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/host.describe" -Method Post -WebSession $session -ContentType 'application/json' -Body '{}' -ErrorAction Stop
  Assert-Status $rpc.StatusCode 200 'Harness RPC proxy'

  $blocked = Invoke-WebRequest -UseBasicParsing -SkipHttpErrorCheck -Uri "$baseUrl/api/credentials.set" -Method Post -WebSession $session -ContentType 'application/json' -Body '{}'
  Assert-Status $blocked.StatusCode 403 'credential mutation policy'

  $me = Invoke-RestMethod -Uri "$baseUrl/_platform/api/auth/me" -WebSession $session
  if (-not $me.user.runtimeSlot) { throw 'Authenticated user does not have an assigned Runtime slot.' }
  Write-Host "Smoke check passed. User is assigned to Runtime slot $($me.user.runtimeSlot)."
} finally {
  try { Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/_platform/api/auth/logout" -Method Post -WebSession $session -ErrorAction SilentlyContinue | Out-Null } catch {}
}

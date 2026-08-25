[CmdletBinding()]
param(
  [switch]$SkipTypecheck
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  if (-not $SkipTypecheck) {
    & pnpm run typecheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  & pnpm exec vitest run apps/cli packages/host
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}

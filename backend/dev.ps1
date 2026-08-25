[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  & pnpm dsh web --no-open
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}

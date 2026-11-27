param(
  [Parameter(Mandatory)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$cluster = Join-Path $env:LOCALAPPDATA 'SafeOps/postgres'
$controller = 'C:/Program Files/PostgreSQL/19/bin/pg_ctl.exe'
if ($env:SAFEOPS_PG_BIN) {
  $controller = Join-Path $env:SAFEOPS_PG_BIN 'pg_ctl.exe'
}
$data = Join-Path $cluster 'data'
if (!(Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) {
  throw "SafeOps PostgreSQL has not been initialized at $data. See the README."
}

switch ($Action) {
  'start' { & $controller -D $data -l (Join-Path $cluster 'server.log') -o '-h 127.0.0.1 -p 39188' -w start }
  'stop' { & $controller -D $data -m fast -w stop }
  'status' { & $controller -D $data status }
}
exit $LASTEXITCODE

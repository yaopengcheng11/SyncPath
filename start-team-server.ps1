# SyncPath - LAN team server (Windows)
#
# The repo's `npm run dev:lan` uses POSIX inline env syntax ("VAR=x cmd"),
# which cmd.exe cannot parse, so this script sets the same variables in
# PowerShell and then runs the standard `npm run dev`.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File .\start-team-server.ps1
#
# Returns as soon as both ports are listening; the dev servers keep running
# detached (see section 3).

$ErrorActionPreference = 'Stop'

$repo    = Split-Path -Parent $MyInvocation.MyCommand.Path
$pgBin   = 'G:\AITools\pg16\pgsql\bin'
$pgData  = 'G:\AITools\pg16\data'

# `Get-NetTCPConnection` costs ~7s per call on this box (CIM query in a
# constrained PowerShell session). `netstat -ano` answers the same question in
# ~0.05s, so every readiness probe below goes through netstat.
function Test-PortListening([int]$Port) {
    $hits = netstat -ano | Select-String -Pattern (":$Port\s+.*LISTENING")
    return [bool]$hits
}

# --- 1. PostgreSQL -----------------------------------------------------------
if (-not (Test-PortListening 5432)) {
    Write-Host '[syncpath] starting PostgreSQL...'
    Start-Process -FilePath "$pgBin\postgres.exe" `
        -ArgumentList '-D', $pgData `
        -WindowStyle Hidden `
        -RedirectStandardOutput 'G:\AITools\pg16\pg_out.log' `
        -RedirectStandardError  'G:\AITools\pg16\pg_err.log'
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if (Test-PortListening 5432) { break }
    }
}
if (-not (Test-PortListening 5432)) {
    throw 'PostgreSQL did not come up on port 5432 - check G:\AITools\pg16\pg_err.log'
}
Write-Host '[syncpath] PostgreSQL is up on 127.0.0.1:5432'

# --- 2. LAN environment ------------------------------------------------------
$env:API_HOST          = '0.0.0.0'
$env:API_PORT          = '3160'
$env:COOKIE_SECURE     = 'false'   # plain HTTP inside the LAN
$env:COOKIE_SAMESITE   = 'lax'
$env:VITE_HOST         = '0.0.0.0'
$env:VITE_STRICT_PORT  = 'true'
$env:VITE_PORT         = '5183'
$env:VITE_API_TARGET   = 'http://127.0.0.1:3160'

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' -and $_.PrefixOrigin -ne 'WellKnown' } |
       Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host '[syncpath] web  -> http://0.0.0.0:5183'
Write-Host "[syncpath] team -> http://${ip}:5183/"

Set-Location $repo

# --- 3. Dev servers (detached) ------------------------------------------------
# `npm run dev` is long-running. Run it through Start-Process so THIS script can
# exit: a caller that times out and kills its own process tree would otherwise
# take the dev servers down with it. Logs land outside the repo.
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { throw 'npm.cmd not found on PATH' }

Write-Host '[syncpath] starting dev servers (detached)...'
$proc = Start-Process -FilePath $npmCmd.Path `
    -ArgumentList 'run', 'dev' `
    -WorkingDirectory $repo `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput 'G:\AITools\pg16\server.log' `
    -RedirectStandardError  'G:\AITools\pg16\server.err.log'
Write-Host "[syncpath] npm run dev pid=$($proc.Id)"

# --- 4. Wait until both ports answer ------------------------------------------
$deadline = (Get-Date).AddSeconds(120)
$api = $false
$web = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (-not $api -and (Test-PortListening 3160)) { $api = $true; Write-Host '[syncpath] API is up on 0.0.0.0:3160' }
    if (-not $web -and (Test-PortListening 5183)) { $web = $true; Write-Host '[syncpath] web is up on 0.0.0.0:5183' }
    if ($api -and $web) { break }
}

if (-not ($api -and $web)) {
    Write-Host "[syncpath] WARNING: api=$api web=$web after 120s - check G:\AITools\pg16\server.err.log"
    exit 1
}
Write-Host '[syncpath] ready'

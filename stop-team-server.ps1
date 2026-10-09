# SyncPath - stop the LAN team server
#
# Matches only node processes whose ExecutablePath is the local Node install
# (never command-line text, which would match this script's own command line).
# Leave PostgreSQL running by default; pass -WithPostgres to stop it too.

param([switch]$WithPostgres)

$ErrorActionPreference = 'SilentlyContinue'

$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = 'C:\Program Files\nodejs\node.exe' }
$nodeDir = Split-Path -Parent $nodeExe

$killed = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
    $exe = $_.ExecutablePath
    if ($exe -and (Split-Path -Parent $exe) -eq $nodeDir) {
        Write-Host "[syncpath] stopping pid=$($_.ProcessId)"
        Stop-Process -Id $_.ProcessId -Force
        $killed++
    }
}
Write-Host "[syncpath] stopped $killed node process(es)"

if ($WithPostgres) {
    & 'G:\AITools\pg16\pgsql\bin\pg_ctl.exe' -D 'G:\AITools\pg16\data' -m fast stop
}

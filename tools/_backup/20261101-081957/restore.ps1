# Restores the files changed by tools/repair_site.py
# Backup: tools/_backup/20261101-081957
$ErrorActionPreference = 'Stop'
$backup = Join-Path $PSScriptRoot '20261101-081957'
$root   = 'H:\kerala-psc-suite\kerala-psc-suite'
Get-ChildItem -Path $backup -Recurse -File | ForEach-Object {
  $rel  = $_.FullName.Substring($backup.Length).TrimStart('\')
  $dest = Join-Path $root $rel
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  Write-Host "restored $rel"
}

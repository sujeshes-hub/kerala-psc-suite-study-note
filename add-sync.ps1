# add-sync.ps1
# Adds sync.js to every HTML file in the repo (skips files that already have it)

$repoRoot = (Get-Location).Path
$syncPath = "/kerala-psc-suite-study-note/assets/js/sync.js"
$syncTag  = '<script src="' + $syncPath + '"></script>'

Write-Host ""
Write-Host "Scanning HTML files in: $repoRoot" -ForegroundColor Cyan
Write-Host ""

$added = 0
$skipped = 0
$nobody = 0

Get-ChildItem -Path $repoRoot -Recurse -Filter *.html -File | ForEach-Object {
    $file = $_.FullName
    $rel  = $file.Substring($repoRoot.Length + 1)

    # Skip files inside assets or node_modules
    if ($rel -match '^assets\\' -or $rel -match 'node_modules') { return }

    try {
        $content = Get-Content -Raw -Path $file -Encoding UTF8

        if ($content -match 'assets/js/sync\.js') {
            Write-Host "  SKIP (already has sync)  $rel" -ForegroundColor DarkGray
            $skipped++
            return
        }

        if ($content -notmatch '(?i)</body>') {
            Write-Host "  NO BODY TAG            $rel" -ForegroundColor Yellow
            $nobody++
            return
        }

        $new = $content -replace '(?i)</body>', "$syncTag`r`n</body>"
        Set-Content -Path $file -Value $new -Encoding UTF8 -NoNewline
        Write-Host "  ADDED                  $rel" -ForegroundColor Green
        $added++

    } catch {
        Write-Host "  ERROR                  $rel  -- $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "===============================" -ForegroundColor Cyan
Write-Host "  Added   : $added file(s)" -ForegroundColor Green
Write-Host "  Skipped : $skipped file(s) (already had sync)" -ForegroundColor DarkGray
Write-Host "  No body : $nobody file(s)" -ForegroundColor Yellow
Write-Host "===============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now open GitHub Desktop and commit + push." -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to close"
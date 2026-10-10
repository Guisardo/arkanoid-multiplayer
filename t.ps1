& npx @args 2>&1 | Out-String -Width 300 | Write-Host
exit $LASTEXITCODE
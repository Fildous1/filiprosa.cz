<#
    Nahraje obsah ../../cdn-upload/ do R2 bucketu `filiprosa-cdn`.

    Používá rclone (S3 kompatibilní API R2) — wrangler umí jen jeden objekt
    na příkaz, což je u 1275 souborů nepoužitelné.

    Předpoklady:
      1. rclone nainstalované:   winget install Rclone.Rclone
      2. R2 API token vytvořený v Cloudflare dashboardu:
         R2 → API → Manage API Tokens → Create Token (Object Read & Write)
      3. Proměnné prostředí nastavené v aktuálním PowerShellu:
         $env:R2_ACCOUNT_ID  = "<account id z R2 přehledu>"
         $env:R2_ACCESS_KEY  = "<Access Key ID>"
         $env:R2_SECRET_KEY  = "<Secret Access Key>"

    Použití:
      .\sync-r2.ps1              # zkušební běh, nic nezapíše
      .\sync-r2.ps1 -Live        # skutečné nahrání

    POZOR: soubor musí zůstat uložený jako UTF-8 s BOM. PowerShell 5.1 jinak
    čte diakritiku v systémové ANSI kódové stránce a skript se nerozparsuje.
#>

param(
    [switch]$Live
)

$ErrorActionPreference = 'Stop'

foreach ($v in @('R2_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY')) {
    if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue)) {
        throw ('Chybí proměnná prostředí $env:' + $v + ' - viz komentář v hlavičce skriptu.')
    }
}

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    throw 'rclone nenalezeno. Nainstaluj: winget install Rclone.Rclone (a otevři nové okno PowerShellu).'
}

$source = Join-Path $PSScriptRoot '..\..\cdn-upload'
if (-not (Test-Path $source)) { throw "Zdrojová složka nenalezena: $source" }
$source = (Resolve-Path $source).Path

$rcloneArgs = @(
    'sync', $source, ':s3:filiprosa-cdn'
    '--s3-provider', 'Cloudflare'
    '--s3-access-key-id', $env:R2_ACCESS_KEY
    '--s3-secret-access-key', $env:R2_SECRET_KEY
    '--s3-endpoint', "https://$($env:R2_ACCOUNT_ID).r2.cloudflarestorage.com"
    '--s3-region', 'auto'
    # R2 nemá kontrolní součty jako AWS; bez tohoto rclone hlásí chyby
    '--s3-no-check-bucket'
    # Vše je předané flagy. Bez tohoto rclone píše na stderr NOTICE o chybějícím
    # config souboru a $ErrorActionPreference = 'Stop' z ní udělá fatální chybu.
    '--config', 'NUL'
    '--checksum'
    '--transfers', '16'
    '--checkers', '16'
    # PHP endpointy nahradil Worker, skryté soubory jsou zbytky Apache configu
    '--exclude', 'api/**'
    '--exclude', '.*'
    '--exclude', '**/.*'
    '--progress'
    '--stats', '5s'
)

if (-not $Live) {
    $rcloneArgs += '--dry-run'
    Write-Host ''
    Write-Host '=== ZKUSEBNI BEH - nic se nezapise. Spust s -Live pro skutecne nahrani. ===' -ForegroundColor Yellow
    Write-Host ''
}

Write-Host "Zdroj: $source"
Write-Host "Cil:   r2://filiprosa-cdn"
Write-Host ''

& rclone @rcloneArgs
if ($LASTEXITCODE -ne 0) { throw "rclone skoncil s kodem $LASTEXITCODE" }

Write-Host ''
Write-Host 'Hotovo.' -ForegroundColor Green

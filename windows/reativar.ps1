# reativar.ps1 - religa o serviço depois de uma hibernação.
#
# A hibernação não apaga nada: ela guarda uma cópia, tira a tarefa do login e
# encerra o processo. Voltar é só religar a tarefa — e, se o save tiver sumido
# junto com o jogo, restaurar a cópia guardada.
#
# Não precisa de administrador.

$ErrorActionPreference = 'Stop'
# Este script mora em windows\, e o projeto e a pasta acima dela.
$raiz = Split-Path $PSScriptRoot -Parent

Write-Host ''
Write-Host '  Reativando o acompanhamento de progresso' -ForegroundColor Cyan
Write-Host ''

# 1. O jogo voltou?
$estado = & node (Join-Path $raiz 'sync\instalacao.js')
$estado | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
if ($estado -match 'NÃO INSTALADO') {
    Write-Host ''
    Write-Host '  O Sekiro continua desinstalado.' -ForegroundColor Yellow
    Write-Host '  Dá para reativar mesmo assim, mas o serviço vai hibernar de novo em meia hora.'
    $r = Read-Host '  Reativar assim mesmo? (s/N)'
    if ($r -ne 's') { Write-Host '  Cancelado.'; exit 0 }
}

# 2. O save ainda está no lugar? Se não, oferecer a cópia mais recente.
$saveDir = Join-Path $env:APPDATA 'Sekiro'
$temSave = (Test-Path $saveDir) -and (Get-ChildItem $saveDir -Recurse -Filter 'S0000.sl2' -ErrorAction SilentlyContinue)
if (-not $temSave) {
    $copias = Get-ChildItem (Join-Path $raiz 'arquivo') -Directory -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending
    $comSave = $copias | Where-Object { Test-Path (Join-Path $_.FullName 'save\S0000.sl2') } | Select-Object -First 1
    if ($comSave) {
        Write-Host ''
        Write-Host '  O save não está mais em %APPDATA%\Sekiro.' -ForegroundColor Yellow
        Write-Host "  Há uma cópia guardada em: $($comSave.Name)"
        Write-Host '  Para restaurar, copie o arquivo para a pasta do seu Steam ID dentro de'
        Write-Host '  %APPDATA%\Sekiro. Não faço isso sozinho: sobrescrever save é irreversível,'
        Write-Host '  e se o jogo já criou um novo, o seu é que se perderia.'
        Write-Host "  Origem: $(Join-Path $comSave.FullName 'save\S0000.sl2')"
    }
}

# 3. Religar a tarefa, reaproveitando o instalador.
Write-Host ''
& powershell -ExecutionPolicy Bypass -File (Join-Path $raiz 'windows\install-sync-service.ps1')

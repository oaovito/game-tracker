<#
Registra o sincronizador do save do Sekiro como tarefa agendada, iniciando
oculto no logon do usuario atual. O servico fica no ar o tempo todo servindo a
pagina; a leitura do save so acontece enquanto o sekiro.exe estiver rodando.

NAO precisa de administrador: o programa so le arquivos do proprio usuario e
escuta numa porta alta. Se voce rodar isto elevado, a tarefa ficaria registrada
para o usuario errado.
#>

$ErrorActionPreference = 'Stop'

# O nome antigo fica listado porque o projeto mudou de nome: numa maquina onde
# o servico ja estava instalado, a tarefa continua registrada como
# 'SekiroProgressSync'. Reinstalar sem remove-la deixaria duas tarefas subindo
# dois servicos na mesma porta.
$taskName   = 'TrackeroaoSync'
$taskAntigo = 'SekiroProgressSync'
$mainScript = Join-Path $PSScriptRoot 'sync\main.js'
$nircmdPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'nircmd\nircmd.exe'

# --- node ---
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
    $candidato = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $candidato) { $node = $candidato }
}
if (-not $node) {
    Write-Host "node.exe nao encontrado. Instale em https://nodejs.org e rode de novo." -ForegroundColor Red
    exit 1
}
Write-Host "node   : $node" -ForegroundColor DarkGray
Write-Host "script : $mainScript" -ForegroundColor DarkGray

if (-not (Test-Path $mainScript)) {
    Write-Host "Nao achei $mainScript" -ForegroundColor Red
    exit 1
}

# node.exe abre janela de console propria; -WindowStyle nao se aplica a ele.
# nircmd exec hide resolve no nivel do Windows, mesmo padrao do game-priority-watcher.
if (Test-Path $nircmdPath) {
    $action = New-ScheduledTaskAction -Execute $nircmdPath `
        -Argument "exec hide `"$node`" `"$mainScript`"" `
        -WorkingDirectory $PSScriptRoot
    Write-Host "janela : oculta via nircmd" -ForegroundColor DarkGray
} else {
    $action = New-ScheduledTaskAction -Execute $node `
        -Argument "`"$mainScript`"" `
        -WorkingDirectory $PSScriptRoot
    Write-Host "janela : nircmd nao encontrado, a janela do node vai aparecer" -ForegroundColor Yellow
}

$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

# Encerra instancia anterior antes de re-registrar, senao ficam duas brigando
# pela porta 8777 e a segunda morre com EADDRINUSE.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('main.js') } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Instancia anterior (PID $($_.ProcessId)) encerrada." -ForegroundColor DarkGray
    }

foreach ($n in @($taskName, $taskAntigo)) {
    Unregister-ScheduledTask -TaskName $n -Confirm:$false -ErrorAction SilentlyContinue
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description `
    'Serve a pagina de progresso e le o save enquanto o jogo estiver aberto' | Out-Null

Write-Host "Tarefa agendada '$taskName' criada (inicia oculta no login)." -ForegroundColor Green

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3

# --- confere que subiu de verdade ---
$porta = 8777
$ok = $false
foreach ($tentativa in 1..5) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$porta/" -TimeoutSec 4 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}

if (-not $ok) {
    Write-Host "O servidor nao respondeu em localhost:$porta." -ForegroundColor Red
    Write-Host "Veja o log: $(Join-Path $PSScriptRoot 'sync\sekiro-sync.log')" -ForegroundColor Yellow
    exit 1
}

Write-Host "Servidor respondendo em localhost:$porta." -ForegroundColor Green

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -ExpandProperty IPAddress
foreach ($ip in $ips) {
    Write-Host "  celular: http://${ip}:$porta/sekiro-progresso.html" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "A partir de agora sobe sozinho no login. Nao precisa abrir nada." -ForegroundColor Green
Write-Host "QR atualizado em: $(Join-Path $PSScriptRoot 'qr-acesso.svg')" -ForegroundColor DarkGray
Write-Host "Para remover: .\uninstall-sync-service.ps1" -ForegroundColor Yellow

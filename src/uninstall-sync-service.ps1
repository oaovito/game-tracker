<#
Remove a tarefa agendada do sincronizador e encerra qualquer instancia em
execucao. Nao apaga progress.json nem o offsets.json.

Sao dois nomes porque o projeto mudou de nome: uma maquina onde o servico foi
instalado antes disso ainda tem a tarefa registrada como 'SekiroProgressSync'.
Remover so o nome novo deixaria a antiga de pe, voltando no proximo logon.
#>

$taskNames = @('TrackeroaoSync', 'SekiroProgressSync')

foreach ($taskName in $taskNames) {
    $tarefa = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($tarefa) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "Tarefa agendada '$taskName' removida." -ForegroundColor Green
    }
}

$achou = $false
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('main.js') } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "Processo do sincronizador (PID $($_.ProcessId)) encerrado." -ForegroundColor Green
        $achou = $true
    }

if (-not $achou) { Write-Host "Nenhuma instancia em execucao." -ForegroundColor DarkGray }
Write-Host "A pagina para de responder. Para voltar: .\install-sync-service.ps1" -ForegroundColor Yellow

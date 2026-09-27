<#
Remove a tarefa agendada do sincronizador do Sekiro e encerra qualquer
instancia em execucao. Nao apaga progress.json nem o offsets.json.
#>

$taskName = 'SekiroProgressSync'

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Tarefa agendada '$taskName' removida." -ForegroundColor Green

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

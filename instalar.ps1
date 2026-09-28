<#
Instala o trackeroao numa maquina qualquer, do zero.

A ideia e ser replicavel: rodar isto em qualquer PC com Windows deixa o
tracker funcionando igual, sem precisar carregar pasta nem lembrar de nada. O
projeto inteiro mora num repositorio publico, entao a instalacao e baixar a
versao atual dali e registrar o servico.

O que ele resolve sozinho:
  - Node.js, se nao houver (via winget)
  - baixar o projeto (sem exigir git: usa o zip que o GitHub publica)
  - registrar a tarefa agendada que sobe o servico oculto no logon
  - abrir a pagina no fim

O que ele NAO faz, de proposito:
  - nao apaga nada do que ja existir na pasta de destino que nao seja do
    projeto; se a pasta ja tem uma instalacao, ele atualiza em vez de zerar,
    preservando os arquivos de estado (contagens, calibracao do contador)
  - nao pede administrador para o servico: a tarefa e do usuario atual, e
    elevar registraria para o usuario errado
#>

# Os valores padrao aceitam vir do ambiente porque e assim que o
# trackeroao-instalador.exe repassa o que recebeu na linha de comando dele. A
# razao de nao repassar por argumento esta comentada no construir-exe.ps1.
param(
  [string]$Destino = $(if ($env:TRACKEROAO_DESTINO) { $env:TRACKEROAO_DESTINO }
                       else { Join-Path $env:LOCALAPPDATA 'trackeroao' }),
  [string]$Repo = $(if ($env:TRACKEROAO_REPO) { $env:TRACKEROAO_REPO }
                    else { 'https://github.com/oaovito/trackeroao' })
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Passo($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Nota($t)  { Write-Host "  $t" -ForegroundColor DarkGray }
function Ruim($t)  { Write-Host "  $t" -ForegroundColor Red }

Write-Host "trackeroao - instalacao" -ForegroundColor White
Nota "destino: $Destino"

# ---------------------------------------------------------------- 1. Node
Passo '1/4  Node.js'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) {
  $candidato = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $candidato) { $node = @{ Source = $candidato } }
}
if (-not $node) {
  Nota 'nao encontrado; instalando via winget'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Ruim 'winget nao existe nesta maquina. Instale o Node em https://nodejs.org e rode de novo.'
    return
  }
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue)
}
if (-not $node) { Ruim 'nao consegui deixar o Node disponivel nesta sessao. Feche e abra o terminal, e rode de novo.'; return }
Ok "node em $($node.Source)"

# --------------------------------------------------------------- 2. baixar
Passo '2/4  Projeto'
$tmp = Join-Path $env:TEMP ("trackeroao-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$zip = Join-Path $tmp 'fonte.zip'
try {
  Invoke-WebRequest -Uri "$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
} catch {
  Ruim "nao consegui baixar: $($_.Exception.Message)"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  return
}
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$raizBaixada = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

New-Item -ItemType Directory -Path $Destino -Force | Out-Null

# Os arquivos de estado sao desta maquina e nao vem no zip; se ja existirem,
# ficam onde estao. Copiar por cima do resto atualiza sem zerar o progresso.
Copy-Item -Path (Join-Path $raizBaixada '*') -Destination $Destino -Recurse -Force
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Ok "projeto em $Destino"

# ------------------------------------------------------------- 3. servico
Passo '3/4  Servico'
$instalador = Join-Path $Destino 'install-sync-service.ps1'
if (-not (Test-Path $instalador)) { Ruim 'o zip nao trouxe o instalador do servico'; return }
& $instalador

# -------------------------------------------------------------- 4. conferir
Passo '4/4  Conferindo'
Push-Location $Destino
& $node.Source 'sync/selftest.js'
$testes = $LASTEXITCODE
Pop-Location
if ($testes -eq 0) { Ok 'a suite passou inteira nesta maquina' }
else { Nota 'alguns testes falharam; se for a parte do save, o jogo talvez nao esteja instalado aqui' }

Start-Process 'http://localhost:8777/'
Write-Host "`nPronto." -ForegroundColor Green
Nota 'local  : http://localhost:8777/'
Nota 'publico: https://oaovito.github.io/trackeroao/'
Nota "para remover: $Destino\uninstall-sync-service.ps1"

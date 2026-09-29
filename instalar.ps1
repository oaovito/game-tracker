<#
Instala o trackeroao numa maquina qualquer, do zero.

A ideia e ser replicavel: rodar isto em qualquer PC com Windows deixa o
tracker funcionando igual, sem precisar carregar pasta nem lembrar de nada. O
projeto inteiro mora num repositorio publico, entao a instalacao e baixar a
versao atual dali e registrar o servico.

O principio e que o instalador resolve TUDO que a aplicacao precisa e que seja
tecnica e legalmente possivel resolver sozinho. Nao existe "depois voce
instala" nem "depois voce libera": cada coisa que ficaria a cargo da pessoa e
uma chance de a instalacao terminar parecendo pronta e nao funcionar.

O que ele resolve sozinho:
  - Node.js, por tres caminhos em ordem de preferencia: o que ja existe na
    maquina, o winget, e -- se nenhum dos dois -- o zip oficial do nodejs.org
    descompactado dentro da propria pasta do projeto, com o hash conferido
  - o projeto, baixado do repositorio publico (sem exigir git: usa o zip que o
    GitHub publica)
  - a tarefa agendada que sobe o servico oculto no logon
  - a regra de firewall da porta 8777, para o celular alcancar a pagina --
    unico passo que pede elevacao, e so ele
  - a primeira leitura do save, para a pagina nao abrir vazia
  - a conferencia final, rodando a suite nesta maquina

O que ele NAO faz, e por que:
  - nao instala o jogo nem a Steam. Nao e software nosso para redistribuir, e
    a aplicacao funciona sem eles (ver a secao "A Steam e opcional" do README)
  - nao apaga nada do que ja existir na pasta de destino que nao seja do
    projeto; se a pasta ja tem uma instalacao, ele atualiza em vez de zerar,
    preservando os arquivos de estado (contagens, calibracao do contador)
  - nao roda como administrador. A tarefa agendada e do usuario atual, e
    elevar o processo inteiro registraria para o usuario errado. So a regra de
    firewall sobe elevada, num processo separado e de vida curta.
#>

# Os valores padrao aceitam vir do ambiente porque e assim que o
# trackeroao-instalador.exe repassa o que recebeu na linha de comando dele. A
# razao de nao repassar por argumento esta comentada no construir-exe.ps1.
param(
  [string]$Destino = $(if ($env:TRACKEROAO_DESTINO) { $env:TRACKEROAO_DESTINO }
                       else { Join-Path $env:LOCALAPPDATA 'trackeroao' }),
  [string]$Repo = $(if ($env:TRACKEROAO_REPO) { $env:TRACKEROAO_REPO }
                    else { 'https://github.com/oaovito/trackeroao' }),
  # Para quem prefere abrir a porta a mao. O padrao e abrir, porque deixar
  # para depois e o motivo numero um de o celular nao achar a pagina.
  [switch]$SemFirewall
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Passo($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Nota($t)  { Write-Host "  $t" -ForegroundColor DarkGray }
function Ruim($t)  { Write-Host "  $t" -ForegroundColor Red }

# O que ficou por fazer, para o relatorio do fim. Instalacao que termina com
# pendencia silenciosa e pior que instalacao que falha.
$pendencias = @()

Write-Host "trackeroao - instalacao" -ForegroundColor White
Nota "destino: $Destino"

# ================================================================== 1. Node
Passo '1/5  Node.js'

function Node-Portatil($raiz) {
  <#
    Ultimo recurso: o zip oficial do nodejs.org, descompactado dentro da pasta
    do projeto.

    Isto existe porque winget nao esta em toda maquina -- some em Windows LTSC,
    em instalacao antiga sem App Installer, e em conta sem loja. Antes, sem
    winget, o instalador desistia e mandava a pessoa instalar o Node a mao, que
    e exatamente o tipo de "depois voce faz" que nao pode existir aqui.

    O zip e a distribuicao oficial do proprio projeto Node (MIT), entao nao ha
    nada a pedir a ninguem. Nao mexe no PATH e nao precisa de administrador: o
    runtime fica em runtime\node dentro do destino, e a tarefa agendada aponta
    para o caminho absoluto dele.

    O hash e conferido contra o SHASUMS256.txt que o nodejs.org publica ao lado
    do arquivo. Baixar binario e executa-lo sem conferir seria o unico ponto do
    projeto em que se confia numa transferencia sem prova.
  #>
  $arq = switch ($env:PROCESSOR_ARCHITECTURE) {
    'ARM64' { 'win-arm64' }
    'AMD64' { 'win-x64' }
    default { 'win-x86' }
  }

  Nota "baixando o Node oficial ($arq) -- winget nao esta disponivel aqui"
  $indice = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $indice | Where-Object { $_.lts -and $_.files -contains "$arq-zip" } | Select-Object -First 1
  if (-not $lts) { throw "o nodejs.org nao publica zip de $arq" }

  $nome = "node-$($lts.version)-$arq.zip"
  $url  = "https://nodejs.org/dist/$($lts.version)/$nome"
  $tmp  = Join-Path $env:TEMP ("node-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp $nome

  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

  $somas = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$($lts.version)/SHASUMS256.txt" -UseBasicParsing).Content
  $esperado = ($somas -split "`n" | Where-Object { $_ -match [regex]::Escape($nome) + '\s*$' }) -split '\s+' | Select-Object -First 1
  $obtido = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if (-not $esperado) { throw "o SHASUMS256.txt nao lista $nome" }
  if ($obtido -ne $esperado.ToLower()) {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    throw "o hash do Node baixado nao confere (esperado $esperado, obtido $obtido)"
  }
  Nota "hash conferido: $($esperado.Substring(0,16))..."

  $runtime = Join-Path $raiz 'runtime'
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $pasta = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName
  $alvo = Join-Path $runtime 'node'
  if (Test-Path $alvo) { Remove-Item -Recurse -Force $alvo }
  Move-Item -Path $pasta -Destination $alvo
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

  return (Join-Path $alvo 'node.exe')
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $candidato = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $candidato) { $node = $candidato }
}
# O runtime portatil de uma instalacao anterior conta como Node achado.
if (-not $node) {
  $candidato = Join-Path $Destino 'runtime\node\node.exe'
  if (Test-Path $candidato) { $node = $candidato }
}
if (-not $node -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Nota 'nao encontrado; instalando via winget'
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
  New-Item -ItemType Directory -Path $Destino -Force | Out-Null
  try { $node = Node-Portatil $Destino }
  catch {
    Ruim "nao consegui obter o Node: $($_.Exception.Message)"
    Ruim 'sem ele nao ha o que instalar. Instale em https://nodejs.org e rode de novo.'
    return
  }
}
if (-not (Test-Path $node)) { Ruim "o Node apontado nao existe: $node"; return }
Ok "node em $node  ($(& $node -v))"

# =============================================================== 2. projeto
Passo '2/5  Projeto'
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

# Conferir o que chegou, e nao so que o comando nao deu erro: zip truncado
# descompacta sem reclamar e deixa a instalacao pela metade.
$exigidos = @('trackeroao.html', 'package.json', 'sync\main.js', 'sync\offsets.json',
              'sync\conquistas.json', 'install-sync-service.ps1', 'docs\index.html')
$faltando = $exigidos | Where-Object { -not (Test-Path (Join-Path $Destino $_)) }
if ($faltando) { Ruim "o download veio incompleto, faltou: $($faltando -join ', ')"; return }
$artes = @(Get-ChildItem (Join-Path $Destino 'docs\icones') -Recurse -File -ErrorAction SilentlyContinue).Count
Ok "projeto em $Destino  ($artes imagens)"

# =============================================================== 3. servico
Passo '3/5  Servico'
$instalador = Join-Path $Destino 'install-sync-service.ps1'
& $instalador -NodePath $node

# ================================================================== 4. rede
Passo '4/5  Rede'
if ($SemFirewall) {
  Nota 'pulado a pedido (-SemFirewall)'
  $pendencias += 'a porta 8777 nao foi liberada: o celular nao vai achar a pagina'
} else {
  <#
    A regra de firewall da porta 8777.

    Sem ela a pagina responde no proprio PC e nao responde no celular, que e a
    reclamacao numero um registrada no README. E o unico passo que precisa de
    administrador, entao sobe num processo separado e de vida curta, em vez de
    elevar a instalacao inteira -- elevar tudo registraria a tarefa agendada
    para o usuario errado.

    O escopo e o minimo que resolve: entrada, TCP, porta 8777, e so no perfil
    Private. No perfil Public (cafe, aeroporto) a porta continua fechada.
  #>
  $nomeRegra = 'trackeroao (8777)'
  $jaTem = $false
  try { $jaTem = [bool](Get-NetFirewallRule -DisplayName $nomeRegra -ErrorAction SilentlyContinue) } catch { }

  if ($jaTem) {
    Ok 'a porta 8777 ja estava liberada para a rede local'
  } else {
    $souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
                 ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $cmd = "New-NetFirewallRule -DisplayName '$nomeRegra' -Direction Inbound -Protocol TCP " +
           "-LocalPort 8777 -Action Allow -Profile Private " +
           "-Description 'Pagina de progresso do trackeroao na rede local' | Out-Null"
    try {
      if ($souAdmin) {
        Invoke-Expression $cmd
      } else {
        Nota 'pedindo elevacao so para liberar a porta 8777 na rede local'
        $p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
               -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd
        if ($p.ExitCode -ne 0) { throw "o processo elevado saiu com codigo $($p.ExitCode)" }
      }
      Ok 'porta 8777 liberada para a rede local (perfil Private)'
    } catch {
      Nota "nao liberei a porta: $($_.Exception.Message)"
      $pendencias += 'liberar a porta 8777 no Firewall do Windows para redes privadas, senao o celular nao acha a pagina'
    }
  }
}

# ============================================================= 5. conferir
Passo '5/5  Conferindo'
Push-Location $Destino
# Uma leitura antes da suite: assim a pagina ja abre com numero em vez de
# tracinho, e a propria suite tem o que conferir.
& $node 'sync/parse.js' 2>&1 | Select-Object -Last 1 | ForEach-Object { Nota $_ }
# E publicar logo depois, para o docs/ desta maquina refletir a leitura dela em
# vez do retrato que veio no zip. Sem isto a pasta publicada fica com o
# progresso de outra pessoa ate o servico completar o primeiro ciclo.
& $node 'sync/publish.js' 2>&1 | Select-Object -Last 1 | ForEach-Object { Nota $_ }
& $node 'sync/selftest.js'
$testes = $LASTEXITCODE
Pop-Location
if ($testes -eq 0) { Ok 'a suite passou inteira nesta maquina' }
else {
  Nota 'alguns testes falharam; se for a parte do save, o jogo talvez nao esteja instalado aqui'
  $pendencias += "a suite terminou com falha (codigo $testes) -- rode 'npm run selftest' em $Destino para ver quais"
}

Start-Process 'http://localhost:8777/'
Write-Host "`nPronto." -ForegroundColor Green
Nota 'local  : http://localhost:8777/'
Nota 'publico: https://oaovito.github.io/trackeroao/'
Nota "para remover: $Destino\uninstall-sync-service.ps1"

if ($pendencias) {
  Write-Host "`nFicou para voce:" -ForegroundColor Yellow
  foreach ($p in $pendencias) { Write-Host "  - $p" -ForegroundColor Yellow }
}

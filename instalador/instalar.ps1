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
  - o projeto, na versao da ultima release, baixado do repositorio publico
    (sem exigir git: usa o zip que o GitHub publica)
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
  [switch]$SemFirewall,
  # Preenchidos pela propria instalacao quando ela se relanca elevada. Nao sao
  # para uso manual: dizem quem pediu a instalacao, e nao quem a esta rodando.
  # A diferenca importa quando a elevacao troca de conta -- ver o bloco logo
  # abaixo.
  [string]$UsuarioOriginal,
  [switch]$JaElevado,
  # O proprio trackeroao-instalador.exe, que vira o desinstalador dentro da
  # pasta. Vem do ambiente na primeira execucao e por argumento na elevada,
  # porque o processo elevado nao herda o ambiente de quem o pediu.
  [string]$Exe = $env:TRACKEROAO_EXE
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Passo($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Nota($t)  { Write-Host "  $t" -ForegroundColor DarkGray }
function Ruim($t)  { Write-Host "  $t" -ForegroundColor Red }

<#
  Rodando pela janela do trackeroao-instalador.exe (TRACKEROAO_GUI), este
  script nao tem console visivel: ele conta o que esta fazendo por linhas que
  comecam com @@, que a janela transforma em texto e barra de progresso (o
  protocolo esta descrito no construir-exe.ps1). O resto da saida vai para o
  registro em %TEMP%\trackeroao-instalar.log. Pela linha de comando, sem a
  janela, nada disso aparece e o script fala no console como sempre falou.

  Os textos da janela tem acento: o .exe grava este script como UTF-8 com BOM,
  e a saida vai em UTF-8.
#>
$gui = [bool]$env:TRACKEROAO_GUI
# Um erro que ninguem tratou nao pode sumir: pela janela, ele vira a mensagem
# de erro que a pessoa le, com a linha onde aconteceu. Pelo console, segue
# como sempre (break devolve o erro ao PowerShell).
trap {
  # Pelo console, a pasta do download sai junto com o erro.
  if ($tmp -and (Test-Path $tmp)) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  if ($gui) {
    [Console]::Out.WriteLine("@@ERRO #unexpected|$($_.InvocationInfo.ScriptLineNumber)|$($_.Exception.Message)")
    [Console]::Out.Flush()
    exit 1
  }
  break
}
if ($gui) {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  # A barra de progresso do proprio PowerShell nao aparece em lugar nenhum, e
  # desenha-la deixa o Invoke-WebRequest varias vezes mais lento.
  $ProgressPreference = 'SilentlyContinue'
  if ($env:TRACKEROAO_USUARIO) { $UsuarioOriginal = $env:TRACKEROAO_USUARIO }
}
function Tela($tipo, $texto) {
  if ($gui) { [Console]::Out.WriteLine("@@$tipo $texto"); [Console]::Out.Flush() }
}
function Etapa($pct, $texto) { Tela 'PASSO' "$pct $texto" }
function Detalhe($texto) { Tela 'DETALHE' $texto }
# Parar de vez: diz o motivo na janela e sai com erro, para ela saber.
function Falhar($texto, $janela) {
  Ruim $texto
  Tela 'ERRO' $(if ($janela) { $janela } else { $texto })
  exit 1
}
<#
  Programas de fora (node, winget) escrevem avisos na saida de erro. No
  Windows PowerShell 5.1, com $ErrorActionPreference = 'Stop', cada linha
  dessas vira um erro fatal quando essa saida e redirecionada, e pela janela
  ela sempre e: foi assim que a instalacao parava em 84%, quando o parse.js
  avisava que nao achou o save. Dentro desta funcao a preferencia volta a
  Continue, so para eles; quem diz se deu certo e o codigo de saida.
#>
# Pela janela, as pastas temporarias ficam dentro da pasta do proprio .exe,
# que ele apaga no fim, de qualquer jeito que o script termine: nada fica
# para tras em %TEMP%, nem numa instalacao que falhou.
$baseTemp = if ($gui -and $PSScriptRoot) { $PSScriptRoot } else { $env:TEMP }
function Nativo([scriptblock]$bloco) {
  $ErrorActionPreference = 'Continue'
  & $bloco
}
Etapa 2 '#prep_inst'

# O que ficou por fazer, para o relatorio do fim. Instalacao que termina com
# pendencia silenciosa e pior que instalacao que falha.
$pendencias = @()

<#
  A instalacao inteira sobe elevada, e quem decide e a pessoa.

  A versao anterior elevava so a regra de firewall, num processo separado, para
  o resto continuar rodando como o usuario comum. O motivo era concreto: uma
  tarefa agendada registrada dentro de um processo elevado com OUTRA conta
  ficaria no usuario errado, e o servico nunca subiria no logon de quem joga.

  Elevar tudo e a decisao do dono do projeto, e resolve o incomodo de ver dois
  prompts. O cuidado que ela exige esta aqui: antes de elevar, a instalacao
  anota QUEM pediu, e passa esse nome adiante. A tarefa agendada e registrada
  para essa pessoa, e nao para quem o Windows devolveu depois do prompt.

  Os dois casos, para o leitor futuro entender por que ha tanto cuidado com uma
  linha so:

    - a pessoa e administradora da propria maquina. O prompt e de consentimento
      e a conta nao muda; anotar o usuario nao custa nada e nao muda nada.
    - a pessoa NAO e administradora e alguem digita outra credencial. Aí o
      processo elevado e de outro usuario, com outro perfil, outro
      %LOCALAPPDATA% e outro %APPDATA%. Sem anotar quem pediu, a instalacao
      inteira iria para a pasta da conta errada e o servico subiria para
      alguem que nao joga.

  Recusar o prompt nao cancela a instalacao: ela segue sem elevacao e faz tudo
  que nao precisa de administrador, deixando a porta 8777 como pendencia escrita
  no fim. Nao ter firewall aberto custa o acesso pelo celular; nao ter a
  instalacao custa tudo.
#>
$souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$elevacaoNegada = $false

if (-not $gui -and -not $souAdmin -and -not $JaElevado -and -not $SemFirewall) {
  $quemPediu = "$env:USERDOMAIN\$env:USERNAME"
  Nota 'pedindo administrador para a instalacao inteira'
  # Nao chamar de $args: e variavel automatica do PowerShell, e sobrescreve-la
  # dentro de um script funciona mas confunde quem le.
  $argsElevado = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
            '-Destino', "`"$Destino`"", '-Repo', "`"$Repo`"",
            '-UsuarioOriginal', "`"$quemPediu`"", '-JaElevado')
  if ($Exe) { $argsElevado += @('-Exe', "`"$Exe`"") }
  try {
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList $argsElevado
    exit $p.ExitCode
  } catch {
    Nota 'administrador recusado; seguindo sem ele'
    Nota 'tudo que nao depende de administrador vai ser feito normalmente'
    # Uma bandeira propria, e nao $SemFirewall: reusar a do parametro fazia o
    # passo 4 anunciar "pulado a pedido", quando ninguem pediu -- o prompt e
    # que foi negado. Relatorio que descreve errado o proprio estado e pior que
    # relatorio que nao descreve.
    $elevacaoNegada = $true
  }
}

# Pela janela, quem pede administrador e o .exe, antes de o script existir.
if ($gui) {
  $JaElevado = $souAdmin
  $elevacaoNegada = -not $souAdmin
}

# Quem joga e quem pediu a instalacao, nao necessariamente quem a esta rodando.
if (-not $UsuarioOriginal) { $UsuarioOriginal = "$env:USERDOMAIN\$env:USERNAME" }
if ($JaElevado -and $UsuarioOriginal -ne "$env:USERDOMAIN\$env:USERNAME") {
  Nota "elevado como $env:USERNAME, mas instalando para $UsuarioOriginal"
}

Write-Host "trackeroao - instalacao" -ForegroundColor White
Nota "destino: $Destino"

# ================================================================== 1. Node
Passo '1/6  Node.js'
Etapa 6 '#node_check'

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
  Etapa 10 '#node_dl'
  Detalhe '#node_dl_d'
  $indice = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = $indice | Where-Object { $_.lts -and $_.files -contains "$arq-zip" } | Select-Object -First 1
  if (-not $lts) { throw "o nodejs.org nao publica zip de $arq" }

  $nome = "node-$($lts.version)-$arq.zip"
  $url  = "https://nodejs.org/dist/$($lts.version)/$nome"
  $tmp  = Join-Path $baseTemp ("trackeroao-node-" + [guid]::NewGuid().ToString('N'))
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
  Etapa 10 '#node_inst'
  Detalhe '#node_inst_d'
  Nativo { winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null }
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
  New-Item -ItemType Directory -Path $Destino -Force | Out-Null
  try { $node = Node-Portatil $Destino }
  catch {
    Ruim "nao consegui obter o Node: $($_.Exception.Message)"
    Falhar 'sem ele nao ha o que instalar. Instale em https://nodejs.org e rode de novo.' '#node_fail'
  }
}
if (-not (Test-Path $node)) { Falhar "o Node apontado nao existe: $node" '#node_broken' }
Ok "node em $node  ($(Nativo { & $node -v 2>&1 }))"

# =============================================================== 2. projeto
Passo '2/6  Projeto'
Etapa 28 '#dl'
Detalhe '#dl_d'
$tmp = Join-Path $baseTemp ("trackeroao-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$zip = Join-Path $tmp 'fonte.zip'
<#
  A versao instalada e a ultima release, e nao a main.

  E a mesma unidade que a atualizacao automatica usa: cada release marca um
  ciclo terminado, e a main entre duas releases pode estar no meio de uma
  mudanca. Instalar pela release tambem da a atualizacao um ponto de partida
  conhecido -- a tag fica gravada em versao.json. Sem release alcancavel (API
  fora do ar, limite de pedidos), cai para a main, que e melhor que nao
  instalar.
#>
$tag = 'main'
$origem = "$Repo/archive/refs/heads/main.zip"
try {
  $apiRepo = $Repo -replace '^https://github\.com/', 'https://api.github.com/repos/'
  $rel = Invoke-RestMethod -Uri "$apiRepo/releases/latest" -UseBasicParsing -Headers @{ 'User-Agent' = 'trackeroao' }
  if ($rel.tag_name) { $tag = $rel.tag_name; $origem = "$Repo/archive/refs/tags/$tag.zip" }
} catch {
  <#
    A API tem cota por endereco, e uma rede compartilhada a gasta sem culpa de
    ninguem. A pagina da release nao tem essa cota: ela redireciona para a tag,
    e o nome vem no endereco.
  #>
  try {
    $pedido = [System.Net.WebRequest]::Create("$Repo/releases/latest")
    $pedido.AllowAutoRedirect = $false
    $pedido.UserAgent = 'trackeroao'
    $resposta = $pedido.GetResponse()
    $local = $resposta.Headers['Location']
    $resposta.Close()
    if ($local -match '/releases/tag/([^/?#]+)') { $tag = [uri]::UnescapeDataString($Matches[1]); $origem = "$Repo/archive/refs/tags/$tag.zip" }
  } catch { }
  if ($tag -eq 'main') { Nota 'nao consegui consultar a ultima release; instalando a main' }
}
try {
  Invoke-WebRequest -Uri $origem -OutFile $zip -UseBasicParsing
} catch {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Falhar "nao consegui baixar: $($_.Exception.Message)" '#dl_fail'
}
Etapa 42 '#copy'
Detalhe "#version|$tag"
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$raizBaixada = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

New-Item -ItemType Directory -Path $Destino -Force | Out-Null

<#
  A copia e a mesma da atualizacao automatica: sync\atualizar.js, rodado da
  pasta baixada. Ele confere se o zip veio inteiro antes de copiar (zip
  truncado descompacta sem reclamar), preserva o estado desta maquina, tira da
  raiz o que versoes antigas deixavam la e grava em versao.json o que foi
  instalado. Duas rotinas para a mesma copia acabariam discordando.
#>
Nativo { & $node (Join-Path $raizBaixada 'sync\atualizar.js') --aplicar $raizBaixada $tag $Destino 2>&1 |
  ForEach-Object { Nota "$_" } }
$copiou = $LASTEXITCODE
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
if ($copiou -ne 0) { Falhar 'a copia do projeto falhou; nada foi instalado' '#copy_fail' }
$artes = @(Get-ChildItem (Join-Path $Destino 'docs\icones') -Recurse -File -ErrorAction SilentlyContinue).Count
Ok "projeto $tag em $Destino  ($artes imagens)"

<#
  O desinstalador.

  E o proprio .exe que esta rodando agora, copiado para dentro da pasta com
  outro nome: com "desinstal" no nome, ele desinstala (ver construir-exe.ps1).
  A release carrega um arquivo so, e quem instalou tem como remover sem voltar
  a pagina de download.

  O registro em "Aplicativos instalados" e o lugar onde o Windows ensina a
  procurar como remover um programa. Fica em HKCU, que e da conta de quem
  instalou e nao pede administrador -- e por isso so e feito quando quem roda
  e quem pediu: elevado com outra conta, o HKCU seria o do administrador.
#>
Etapa 56 '#register'
Detalhe '#register_d'
if ($Exe -and (Test-Path $Exe)) {
  $desinstalador = Join-Path $Destino 'trackeroao-desinstalador.exe'
  try {
    Copy-Item -Path $Exe -Destination $desinstalador -Force
    if ($UsuarioOriginal -eq "$env:USERDOMAIN\$env:USERNAME") {
      $chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\trackeroao'
      New-Item -Path $chave -Force | Out-Null
      $valores = @{
        DisplayName = 'trackeroao'; DisplayVersion = ($tag -replace '^v', ''); Publisher = 'oaovito'
        InstallLocation = $Destino; UninstallString = "`"$desinstalador`""
        DisplayIcon = "$desinstalador,0"; URLInfoAbout = $Repo
      }
      foreach ($k in $valores.Keys) { Set-ItemProperty -Path $chave -Name $k -Value $valores[$k] }
      Set-ItemProperty -Path $chave -Name NoModify -Value 1 -Type DWord
      Set-ItemProperty -Path $chave -Name NoRepair -Value 1 -Type DWord
      Ok 'desinstalador em Aplicativos instalados'
    } else {
      Ok "desinstalador em $desinstalador"
    }
  } catch {
    Nota "nao registrei o desinstalador: $($_.Exception.Message)"
  }
} else {
  Nota 'rodando sem o .exe: sem desinstalador; para remover, instalador\desinstalar.ps1'
}

# =============================================================== 3. servico
Passo '3/6  Servico'
Etapa 62 '#service'
Detalhe '#service_d'
$instalador = Join-Path $Destino 'windows\install-sync-service.ps1'
& $instalador -NodePath $node -Usuario $UsuarioOriginal

<#
  A janela do Trackeroao (app\Trackeroao.exe), que o .exe do instalador traz
  dentro dele e entrega aqui por TRACKEROAO_APP. Ela substitui a anterior no
  lugar: a pasta app e trocada inteira, e uma janela aberta e fechada antes.
  Pela linha de comando, num clone, ela nao existe, e o atalho abre a pagina
  local como antes.
#>
$janela = $null
if ($env:TRACKEROAO_APP -and (Test-Path (Join-Path $env:TRACKEROAO_APP 'Trackeroao.exe'))) {
  Etapa 70 '#window'
  $pastaApp = Join-Path $Destino 'app'
  # O servico recem-religado acende o icone da bandeja, que e este mesmo
  # .exe; se ele voltar entre o fechar e a copia, o arquivo fica preso. Entao
  # fecha e copia de novo, algumas vezes, ate a copia passar.
  for ($tentativa = 1; ; $tentativa++) {
    Get-Process -Name 'Trackeroao' -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and $_.Path.StartsWith($pastaApp, [StringComparison]::OrdinalIgnoreCase) } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    try {
      if (Test-Path $pastaApp) { Remove-Item -Recurse -Force $pastaApp -ErrorAction Stop }
      New-Item -ItemType Directory -Path $pastaApp -Force | Out-Null
      Copy-Item (Join-Path $env:TRACKEROAO_APP '*') $pastaApp -Force -ErrorAction Stop
      break
    } catch {
      if ($tentativa -ge 10) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
  $janela = Join-Path $pastaApp 'Trackeroao.exe'
  Ok "janela em $janela"
}

# =============================================================== 4. atalho
Passo '4/6  Atalho'
Etapa 74 '#shortcut'
<#
  O atalho na area de trabalho.

  E o que cumpre a primeira metade do pedido: a aplicacao pode ser aberta
  livremente, quando a pessoa quiser. A outra metade -- abrir sozinha, em
  silencio, so quando o jogo escolhido comeca -- e da bandeja, e nao depende
  deste atalho.

  Ele aponta para o wscript com o abrir.vbs, e nao para a URL direto, por tres
  motivos que um atalho de internet nao resolveria: o servico pode estar
  parado e precisa subir antes; a chama precisa acender na bandeja; e a espera
  pelo servidor evita abrir o navegador numa pagina de erro.

  O icone e o do proprio wscript por enquanto; um .ico proprio seria mais um
  arquivo para sumir no caminho, e o desenho ja vive na bandeja.
#>
$atalhoVbs = Join-Path $Destino 'sync\abrir.vbs'
if (-not (Test-Path $atalhoVbs)) {
  Nota 'abrir.vbs nao veio no download; sem atalho'
  $pendencias += $(if ($gui) { '#shortcut_fail' } else { 'criar um atalho para o trackeroao: nao consegui' })
} else {
  try {
    <#
      A area de trabalho e a de QUEM PEDIU a instalacao, e nao a do processo.
      Elevado com outra conta, [Environment]::GetFolderPath('Desktop') devolve
      a pasta do administrador -- e o atalho nasceria onde ninguem olha.
    #>
    $desktop = $null
    if ($UsuarioOriginal -and $UsuarioOriginal -ne "$env:USERDOMAIN\$env:USERNAME") {
      $apenasNome = ($UsuarioOriginal -split '\\')[-1]
      $tentativa = Join-Path (Join-Path (Split-Path $env:PUBLIC -Parent) $apenasNome) 'Desktop'
      if (Test-Path $tentativa) { $desktop = $tentativa }
    }
    if (-not $desktop) { $desktop = [Environment]::GetFolderPath('Desktop') }

    # Um atalho so: o de versoes anteriores e trocado por este, no mesmo lugar.
    $lnk = Join-Path $desktop 'Trackeroao.lnk'
    Get-ChildItem $desktop -Filter 'trackeroao.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    $ws = New-Object -ComObject WScript.Shell
    $atalho = $ws.CreateShortcut($lnk)
    if ($janela) {
      $atalho.TargetPath = $janela
      $atalho.Arguments = ''
      $atalho.WorkingDirectory = Split-Path $janela -Parent
      # O icone fica na raiz, fora de app: o Explorer segura o arquivo que
      # esta mostrando, e dentro de app isso travaria a troca da janela.
      $ico = Join-Path $Destino 'trackeroao.ico'
      $doApp = Join-Path (Split-Path $janela -Parent) 'trackeroao.ico'
      if (Test-Path $doApp) { Copy-Item $doApp $ico -Force -ErrorAction SilentlyContinue }
      $atalho.IconLocation = $(if (Test-Path $ico) { "$ico,0" } else { "$janela,0" })
    } else {
      $atalho.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
      $atalho.Arguments = "`"$atalhoVbs`""
      $atalho.WorkingDirectory = $Destino
      $atalho.IconLocation = "$(Join-Path $env:WINDIR 'System32\wscript.exe'),0"
    }
    $atalho.Description = 'Trackeroao'
    $atalho.Save()
    Ok "atalho em $lnk"
  } catch {
    Nota "nao criei o atalho: $($_.Exception.Message)"
    $pendencias += $(if ($gui) { '#shortcut_fail' } else { 'criar um atalho para o trackeroao na area de trabalho' })
  }
}

# ================================================================== 4. rede
Passo '5/6  Rede'
Etapa 78 '#net'
Detalhe '#net_d'
<#
  A porta 8777 na rede local.

  O trabalho todo mora em windows\liberar-porta.ps1, e nao aqui, por dois motivos. Ele
  precisa existir sozinho para quem recusou o administrador resolver depois com
  uma acao em vez de um roteiro pelo Firewall do Windows; e o perfil da rede
  muda com o lugar, entao a mesma maquina volta a precisar disso sem
  reinstalar nada.

  O que aquele script corrige em relacao a versao que ficou para tras: ele cria
  a regra para os perfis EM USO, e nao para um perfil escolhido no escuro. A
  versao anterior criava so para Private, e numa maquina cuja rede esteja
  classificada como Public a regra existia sem servir para nada -- que e o pior
  resultado possivel, porque parece resolvido.
#>
if ($gui -and $elevacaoNegada -and -not $SemFirewall) {
  # Sem administrador, liberar a porta abriria um segundo pedido e uma segunda
  # janela; pela janela do instalador, fica como pendencia escrita no fim.
  Nota 'sem administrador: a porta fica fechada'
  $pendencias += '#net_pending'
} elseif ($SemFirewall) {
  Nota 'pulado a pedido (-SemFirewall)'
  $pendencias += 'a porta 8777 nao foi liberada, a pedido: o celular nao vai achar a pagina'
} else {
  $liberar = Join-Path $Destino 'windows\liberar-porta.ps1'
  if (-not (Test-Path $liberar)) {
    Nota 'liberar-porta.ps1 nao veio no download'
    $pendencias += 'liberar a porta 8777 na rede local'
  } else {
    # Ja estando elevado, o script nao pede nada e so cria a regra. Se a
    # elevacao foi negada la em cima, ele pede de novo -- e ai e a segunda
    # chance de quem mudou de ideia, em vez de uma pendencia seca.
    & $liberar
    if ($LASTEXITCODE -ne 0) {
      $pendencias += "liberar a porta 8777: rode $Destino\windows\liberar-porta.ps1 e aceite o pedido de administrador"
    }
  }
}

# ============================================================= 5. conferir
Passo '6/6  Conferindo'
Etapa 84 '#read'
Push-Location $Destino
# Uma leitura antes da suite: assim a pagina ja abre com numero em vez de
# tracinho, e a propria suite tem o que conferir.
Nativo { & $node 'sync/parse.js' 2>&1 | Select-Object -Last 1 | ForEach-Object { Nota "$_" } }
Etapa 90 '#check'
Detalhe '#check_d'
Nativo { & $node 'sync/selftest.js' 2>&1 | ForEach-Object { Write-Host "$_" } }
$testes = $LASTEXITCODE
Pop-Location
if ($testes -eq 0) { Ok 'a suite passou inteira nesta maquina' }
else {
  Nota 'alguns testes falharam; se for a parte do save, o jogo talvez nao esteja instalado aqui'
  # Na janela, isto fica so no registro: sem o jogo instalado alguns testes
  # falham por definicao, e isso nao e algo que a pessoa precise resolver.
  if (-not $gui) { $pendencias += "a suite terminou com falha (codigo $testes) -- rode 'npm run selftest' em $Destino para ver quais" }
}

# Pela janela do instalador, o Trackeroao abre no botao "Abrir o Trackeroao";
# pelo console, a janela dele abre aqui. Nunca num navegador.
if (-not $gui -and $janela) { Start-Process $janela }
Write-Host "`nPronto." -ForegroundColor Green
Nota 'para abrir: o icone Trackeroao na area de trabalho, ou dois cliques na chama da bandeja'
Nota 'atualizacoes: automaticas e silenciosas, a cada nova release'
Nota 'para remover: Aplicativos instalados do Windows, ou trackeroao-desinstalador.exe na pasta'

if ($pendencias) {
  Write-Host "`nFicou para voce:" -ForegroundColor Yellow
  foreach ($p in $pendencias) { Write-Host "  - $p" -ForegroundColor Yellow; Tela 'PENDENCIA' $p }
}
Detalhe '#done_d'
if ($janela) { Tela 'APP' $janela }
Tela 'PRONTO' '#installed'

# Rodando elevada, a janela e uma nova e fecha sozinha no fim, levando junto
# tudo que foi escrito. Esperar uma tecla e o que permite ler o relatorio --
# inclusive as pendencias, que sao a parte que mais importa ler.
if ($JaElevado -and -not $gui) {
  Write-Host "`nTecle algo para fechar." -ForegroundColor DarkGray
  [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}

# O codigo de saida e o que a janela confere: o do ultimo programa de fora
# (a suite, que pode falhar sem o jogo instalado) nao pode vazar para ca.
if ($gui) { exit 0 }

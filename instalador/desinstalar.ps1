<#
Remove o trackeroao desta maquina: o oposto exato do instalar.ps1.

Quem roda isto normalmente e o trackeroao-desinstalador.exe, que o instalador
deixa dentro da pasta e registra em "Aplicativos instalados" do Windows.

O que ele desfaz, na ordem em que o instalador fez:
  - a tarefa agendada (e a de nome antigo, 'SekiroProgressSync', se existir)
  - os processos do servico e o icone da bandeja
  - o atalho da area de trabalho e o registro em "Aplicativos instalados"
  - a regra de firewall da porta 8777 -- unico passo que pede administrador
  - a pasta da instalacao, com o runtime portatil do Node se ele foi baixado

O que ele NAO desfaz, e por que:
  - o Node.js instalado pelo winget ou ja presente na maquina. Pode estar
    servindo a outros programas, e nao e nosso para remover.
  - o save do jogo. O trackeroao nunca escreveu nele, e continua sem escrever.

Antes de apagar a pasta, pergunta se deve guardar o progresso desta maquina
(contagens, efeitos, escolha de jogos e as copias da hibernacao, que contem o
save). A resposta padrao e guardar: o que se perde aqui nao volta, e uma pasta
a mais nos Documentos custa pouco. Para rodar sem pergunta, -GuardarProgresso
ou -ApagarProgresso.
#>

# Como no instalar.ps1, os padroes aceitam vir do ambiente: e assim que o
# trackeroao-desinstalador.exe repassa o que recebeu.
param(
  [string]$Destino = $(if ($env:TRACKEROAO_DESTINO) { $env:TRACKEROAO_DESTINO }
                       else { Join-Path $env:LOCALAPPDATA 'trackeroao' }),
  [switch]$GuardarProgresso,
  [switch]$ApagarProgresso,
  # Preenchidos pelo proprio script quando ele se relanca elevado.
  [string]$UsuarioOriginal,
  [switch]$JaElevado
)

$ErrorActionPreference = 'Stop'

function Passo($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "  $t" -ForegroundColor Green }
function Nota($t)  { Write-Host "  $t" -ForegroundColor DarkGray }
function Ruim($t)  { Write-Host "  $t" -ForegroundColor Red }

<#
  Pela janela do desinstalador (TRACKEROAO_GUI), como no instalar.ps1: sem
  console, contando o que faz por linhas @@, sem perguntas e sem pedir nada.
  O administrador ja foi pedido pelo .exe; o progresso e guardado, que e a
  resposta padrao da pergunta que o console faria.
#>
$gui = [bool]$env:TRACKEROAO_GUI
if ($gui) {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $ProgressPreference = 'SilentlyContinue'
  if ($env:TRACKEROAO_USUARIO) { $UsuarioOriginal = $env:TRACKEROAO_USUARIO }
  if (-not $ApagarProgresso) { $GuardarProgresso = $true }
}
function Tela($tipo, $texto) {
  if ($gui) { [Console]::Out.WriteLine("@@$tipo $texto"); [Console]::Out.Flush() }
}
function Etapa($pct, $texto) { Tela 'PASSO' "$pct $texto" }
function Detalhe($texto) { Tela 'DETALHE' $texto }
$fraseDaCopia = $null
Etapa 3 'Preparando a remoção'

$pendencias = @()

<#
  Elevacao, pelo mesmo raciocinio do instalador: pede uma vez, no comeco, e
  anota quem pediu antes. So a regra de firewall precisa dela; recusar nao
  cancela nada, e a regra fica como pendencia escrita no fim.

  Anotar quem pediu importa mais aqui do que la. Elevado com outra conta, o
  %LOCALAPPDATA% do processo e o do administrador -- e o padrao de $Destino
  apontaria para uma pasta que nao e a da instalacao. Por isso o destino e
  resolvido ANTES de elevar e passado adiante.
#>
$souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$elevacaoNegada = $false

if (-not $gui -and -not $souAdmin -and -not $JaElevado) {
  $quemPediu = "$env:USERDOMAIN\$env:USERNAME"
  Nota 'pedindo administrador para remover a regra de firewall'
  $argsElevado = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
            '-Destino', "`"$Destino`"", '-UsuarioOriginal', "`"$quemPediu`"", '-JaElevado')
  if ($GuardarProgresso) { $argsElevado += '-GuardarProgresso' }
  if ($ApagarProgresso)  { $argsElevado += '-ApagarProgresso' }
  try {
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList $argsElevado
    exit $p.ExitCode
  } catch {
    Nota 'administrador recusado; seguindo sem ele'
    $elevacaoNegada = $true
  }
}

if ($gui) { $JaElevado = $souAdmin }
if (-not $UsuarioOriginal) { $UsuarioOriginal = "$env:USERDOMAIN\$env:USERNAME" }

# A pasta pessoal de quem pediu, e nao a do processo -- ver o bloco acima.
function Pasta-DeQuemPediu($qual) {
  if ($UsuarioOriginal -ne "$env:USERDOMAIN\$env:USERNAME") {
    $apenasNome = ($UsuarioOriginal -split '\\')[-1]
    $tentativa = Join-Path (Join-Path (Split-Path $env:PUBLIC -Parent) $apenasNome) $qual
    if (Test-Path $tentativa) { return $tentativa }
  }
  if ($qual -eq 'Desktop') { return [Environment]::GetFolderPath('Desktop') }
  return [Environment]::GetFolderPath('MyDocuments')
}

Write-Host "trackeroao - desinstalacao" -ForegroundColor White
Nota "pasta: $Destino"

# ============================================================== 1. servico
Passo '1/5  Servico'
Etapa 12 'Encerrando o Trackeroao'
Detalhe 'O serviço em segundo plano e o ícone da bandeja'
foreach ($nome in @('TrackeroaoSync', 'SekiroProgressSync')) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
    Ok "tarefa '$nome' removida"
  }
}

# So os processos desta instalacao: o servico, o wscript que o sobe e o icone
# da bandeja rodam todos de dentro de sync\, e esse caminho esta na linha de
# comando de cada um. Um node qualquer rodando um main.js de outro projeto nao
# e nosso -- e este proprio script, relancado elevado, carrega o destino nos
# argumentos, mas nao o sync\.
$encerrados = 0
$marca = $Destino.TrimEnd('\') + '\sync\'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'powershell.exe' OR Name = 'wscript.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($marca, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
                 $_.ProcessId -ne $PID } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $encerrados++
  }
if ($encerrados) { Ok "$encerrados processo(s) encerrado(s)" } else { Nota 'nada rodando' }

# ================================================================ 2. atalho
Passo '2/5  Atalho'
Etapa 34 'Removendo o atalho'
$lnk = Join-Path (Pasta-DeQuemPediu 'Desktop') 'trackeroao.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; Ok "removido: $lnk" } else { Nota 'nao havia atalho' }

# ================================================================== 3. rede
Passo '3/5  Rede'
Etapa 46 'Fechando a porta do celular'
if ($souAdmin -or $JaElevado) {
  $regras = @(Get-NetFirewallRule -DisplayName 'trackeroao (*)' -ErrorAction SilentlyContinue)
  if ($regras.Count) {
    $regras | Remove-NetFirewallRule
    Ok "$($regras.Count) regra(s) de firewall removida(s)"
  } else { Nota 'nao havia regra de firewall' }
} else {
  Nota 'sem administrador, a regra de firewall fica'
  $pendencias += $(if ($gui) { 'A regra da porta 8777 continua no Firewall do Windows. Ela só libera essa porta na rede local.' }
                   else { "a regra 'trackeroao (8777)' continua no Firewall do Windows; ela so libera a porta 8777 na rede local" })
}

# ============================================================= 4. progresso
Passo '4/5  Progresso'
Etapa 60 'Guardando uma cópia do seu progresso'
# Tudo que nasce nesta maquina e nao vem de release nenhuma.
$estado = @('progress.json', 'deaths.json', 'deaths-mem.json', 'bosskills.json', 'efeitos.json',
            'selecao.json', 'sync\.state.json', 'arquivo')
$existentes = @($estado | Where-Object { Test-Path (Join-Path $Destino $_) })

if (-not (Test-Path $Destino)) {
  Nota 'a pasta da instalacao nao existe'
} elseif (-not $existentes.Count) {
  Nota 'nao ha progresso gravado nesta maquina'
} else {
  $guardar = $true
  if ($ApagarProgresso) { $guardar = $false }
  elseif (-not $GuardarProgresso) {
    $r = Read-Host '  Guardar uma copia do progresso desta maquina nos Documentos? (S/n)'
    if ($r -match '^\s*n') { $guardar = $false }
  }
  if ($guardar) {
    $copia = Join-Path (Pasta-DeQuemPediu 'Documents') ("trackeroao-progresso-" + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
    New-Item -ItemType Directory -Path $copia -Force | Out-Null
    foreach ($rel in $existentes) {
      $alvo = Join-Path $copia $rel
      New-Item -ItemType Directory -Path (Split-Path $alvo -Parent) -Force | Out-Null
      Copy-Item -Path (Join-Path $Destino $rel) -Destination $alvo -Recurse -Force
    }
    Ok "copia em $copia"
    $fraseDaCopia = "Seu progresso ficou guardado em Documentos\$(Split-Path $copia -Leaf)."
  } else {
    Nota 'o progresso sai junto com a pasta'
  }
}

# O registro em "Aplicativos instalados", feito pelo instalador em HKCU.
$chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\trackeroao'
if ($UsuarioOriginal -eq "$env:USERDOMAIN\$env:USERNAME" -and (Test-Path $chave)) {
  Remove-Item -Path $chave -Recurse -Force -ErrorAction SilentlyContinue
}

# ================================================================= 5. pasta
Passo '5/5  Pasta'
Etapa 78 'Removendo os arquivos'
if (Test-Path $Destino) {
  # Um processo recem-encerrado pode segurar um arquivo por um instante.
  $removida = $false
  foreach ($tentativa in 1..5) {
    try { Remove-Item -Path $Destino -Recurse -Force; $removida = $true; break }
    catch { Start-Sleep -Seconds 1 }
  }
  if ($removida) { Ok "removida: $Destino" }
  else {
    Ruim "nao consegui remover tudo de $Destino"
    $pendencias += $(if ($gui) { "Alguns arquivos estavam em uso e ficaram em $Destino. Pode apagar essa pasta depois." }
                     else { "apagar a pasta $Destino (algum arquivo estava em uso)" })
  }
} else {
  Nota 'nada a remover'
}

Write-Host "`nPronto. O trackeroao nao esta mais nesta maquina." -ForegroundColor Green
Nota 'o Node.js, se foi instalado fora da pasta, continua: pode servir a outros programas'

if ($pendencias) {
  Write-Host "`nFicou para voce:" -ForegroundColor Yellow
  foreach ($p in $pendencias) { Write-Host "  - $p" -ForegroundColor Yellow; Tela 'PENDENCIA' $p }
}
if ($fraseDaCopia) { Detalhe $fraseDaCopia }
Tela 'PRONTO' 'Trackeroao removido'

# A janela fecha sozinha no fim -- a elevada sempre, e a do .exe tambem, que
# ja saiu antes para a pasta poder ser apagada. O relatorio iria junto.
if (-not $gui -and ($JaElevado -or $env:TRACKEROAO_EXE)) {
  Write-Host "`nTecle algo para fechar." -ForegroundColor DarkGray
  [void]$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}

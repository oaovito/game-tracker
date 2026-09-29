<#
Libera a porta 8777 para a rede local, que e o que faz a pagina responder no
celular alem de responder no proprio PC.

Isto vive num script proprio, e nao so dentro do instalador, por dois motivos.
O primeiro e que quem recusou o pedido de administrador na instalacao precisa
de um caminho de uma acao para resolver depois -- "abra o Firewall do Windows,
va em Regras de Entrada, Nova Regra..." nao e um caminho, e uma desistencia. O
segundo e que o perfil da rede muda: a mesma maquina que estava em Private no
escritorio aparece em Public na casa, e ai a regra antiga para de valer.

O que ele faz de diferente da versao que ficou para tras:

  - cria a regra para os perfis que estao EM USO, e nao para um perfil
    escolhido no escuro. A versao anterior criava so para Private, e nesta
    maquina a rede esta classificada como Public -- a regra existia e nao
    servia para nada, que e o pior resultado possivel: parece resolvido.

  - restringe a origem ao LocalSubnet. Isso e o que torna aceitavel valer
    tambem no perfil Public: so alcanca quem esta no mesmo segmento de rede, ou
    seja o celular na mesma casa, e nao a rede inteira de um cafe.

  - e escopo minimo: TCP, porta 8777, entrada. O Windows costuma deixar para
    tras regras de "Node.js JavaScript Runtime" que liberam QUALQUER porta para
    o node, de qualquer origem, criadas quando alguem clicou "Permitir" num
    aviso. Esta regra e mais estreita que aquelas, e existir nao depende de o
    node continuar instalado no mesmo lugar.

Roda sozinho: se nao estiver elevado, ele pede administrador e refaz o proprio
trabalho do outro lado. Recusar nao quebra nada, so nao libera.
#>

param(
  [int]$Porta = 8777,
  [switch]$JaElevado
)

$ErrorActionPreference = 'Stop'
$nomeRegra = "trackeroao ($Porta)"

function Nota($t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Ok($t)   { Write-Host "  $t" -ForegroundColor Green }

<#
  Conferir se a regra existe NAO precisa de administrador quando se pergunta
  pelo netsh; o Get-NetFirewallRule precisa. Isso importa porque e o que
  permite o instalador e a pagina saberem o estado sem elevar nada.
#>
function Regra-Existe($nome) {
  <#
    A conferencia e pela presenca do NOME na saida, e nao pela frase de erro.

    A primeira versao procurava por "No rules match", com "Nenhuma regra" ao
    lado para o Windows em portugues. Isso so funciona nos dois idiomas em que
    alguem lembrou de pensar: num Windows em alemao, espanhol ou japones a
    frase e outra, a conferencia sempre daria "existe", e a regra nunca seria
    criada -- numa maquina em que ela e justamente o que falta.

    O nome da regra e nosso e nao e traduzido por ninguem. Procurar por ele
    funciona em qualquer idioma do sistema.
  #>
  $saida = & netsh advfirewall firewall show rule name="$nome" 2>&1 | Out-String
  return ($saida -match [regex]::Escape($nome))
}

# Os perfis em uso agora. Sem isto a regra nasce apontando para o perfil errado
# e nao vale nada -- foi exatamente o que aconteceu antes.
function Perfis-Em-Uso {
  try {
    $cats = @(Get-NetConnectionProfile -ErrorAction Stop |
              Select-Object -ExpandProperty NetworkCategory -Unique)
  } catch {
    # Sem conseguir perguntar, cobre os tres. Restringir a Private aqui seria
    # escolher no escuro de novo, e o LocalSubnet ja e o que limita o alcance.
    return @('Domain', 'Private', 'Public')
  }
  if (-not $cats -or $cats.Count -eq 0) { return @('Domain', 'Private', 'Public') }
  $perfis = @()
  foreach ($c in $cats) {
    switch ("$c") {
      'Private'       { $perfis += 'Private' }
      'DomainAuthenticated' { $perfis += 'Domain' }
      'Public'        { $perfis += 'Public' }
    }
  }
  # Private entra sempre: se a rede for reclassificada depois, a regra continua
  # valendo sem precisar rodar isto de novo.
  if ($perfis -notcontains 'Private') { $perfis += 'Private' }
  return ($perfis | Select-Object -Unique)
}

if (Regra-Existe $nomeRegra) {
  Ok "a porta $Porta ja estava liberada para a rede local"
  return
}

$souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
             ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $souAdmin) {
  if ($JaElevado) { Write-Host "  nao consegui elevar" -ForegroundColor Red; exit 1 }
  Nota "pedindo administrador para liberar a porta $Porta"
  try {
    $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"",
      '-Porta', $Porta, '-JaElevado')
    if ($p.ExitCode -eq 0) { Ok "a porta $Porta foi liberada" } else { exit $p.ExitCode }
  } catch {
    Write-Host "  administrador recusado; a porta $Porta continua fechada" -ForegroundColor Yellow
    Write-Host "  o celular nao vai achar a pagina ate isso ser feito" -ForegroundColor Yellow
    exit 2
  }
  return
}

$perfis = Perfis-Em-Uso
Nota "perfis de rede em uso: $($perfis -join ', ')"

New-NetFirewallRule -DisplayName $nomeRegra `
  -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow `
  -Profile ($perfis -join ',') `
  -RemoteAddress LocalSubnet `
  -Description 'Pagina de progresso do trackeroao, so para quem esta na mesma rede' | Out-Null

Ok "porta $Porta liberada para $($perfis -join ', '), so do LocalSubnet"
if ($perfis -contains 'Public') {
  Nota 'a rede desta maquina esta classificada como Public; por isso a regra cobre'
  Nota 'esse perfil tambem, e por isso ela se limita a quem esta no mesmo segmento'
}

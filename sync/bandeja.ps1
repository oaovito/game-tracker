<#
bandeja.ps1 - o icone na area de notificacao.

Este e o unico sinal visivel de que a aplicacao esta aberta. O pedido e
explicito: quando o jogo escolhido comeca, a aplicacao abre sozinha e aparece
so aqui -- sem janela, sem navegador, sem nada roubando o foco de quem acabou
de entrar no jogo.

Por que PowerShell e nao Node: Node nao tem bandeja sem pacote nativo, e o
projeto nao tem dependencia nenhuma e nao vai ganhar uma por causa de um
icone. O NotifyIcon do System.Windows.Forms ja vem no Windows desde sempre e
faz exatamente isto.

O icone e desenhado aqui, e nao carregado de um .ico: um arquivo a mais seria
uma coisa a mais para sumir no caminho, e o desenho cabe em vinte linhas. E a
chama azul do Idolo do Escultor, a mesma que a pagina usa a esquerda do numero
de mortes -- o mesmo simbolo nos dois lugares, para quem ve um reconhecer o
outro.

O processo morre junto com quem o abriu: o -ProcessoPai e vigiado, e sem ele o
icone sai da bandeja. Icone orfao seria pior que icone nenhum, porque prometeria
uma aplicacao que nao esta mais la.
#>

param(
  [int]$Porta = 8777,
  [int]$ProcessoPai = 0,
  [string]$Titulo = 'trackeroao'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

<#
  A chama, desenhada em memoria.

  32x32 porque e o tamanho que o Windows pede em tela comum; em tela de alta
  densidade ele reduz de 32 melhor do que amplia de 16.
#>
function Nova-Chama {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  # O corpo da chama: mesma silhueta do desenho da pagina, em curva fechada.
  $corpo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pontos = @(
    (New-Object System.Drawing.Point 16, 2),
    (New-Object System.Drawing.Point 25, 13),
    (New-Object System.Drawing.Point 24, 22),
    (New-Object System.Drawing.Point 16, 30),
    (New-Object System.Drawing.Point 8, 22),
    (New-Object System.Drawing.Point 7, 13)
  )
  $corpo.AddClosedCurve($pontos, 0.6)

  # Degrade de baixo para cima: azul fundo na base, turquesa no meio. O branco
  # do nucleo entra depois, por cima, para nao ser lavado pelo degrade.
  $pincel = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point 0, 32),
    (New-Object System.Drawing.Point 0, 0),
    [System.Drawing.Color]::FromArgb(210, 29, 95, 138),
    [System.Drawing.Color]::FromArgb(255, 200, 244, 255))
  $g.FillPath($pincel, $corpo)

  $nucleo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $nucleo.AddEllipse(12, 14, 8, 12)
  $brancoDentro = New-Object System.Drawing.Drawing2D.PathGradientBrush($nucleo)
  $brancoDentro.CenterColor = [System.Drawing.Color]::FromArgb(235, 255, 255, 255)
  $brancoDentro.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 165, 233, 255))
  $g.FillPath($brancoDentro, $nucleo)

  $g.Dispose()
  $icone = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  return $icone
}

$icone = New-Object System.Windows.Forms.NotifyIcon
$icone.Icon = Nova-Chama
$icone.Text = $Titulo          # o balao do hover; o Windows corta em 63 caracteres
$icone.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$abrir = $menu.Items.Add('Abrir a pagina')
$abrir.add_Click({ Start-Process "http://localhost:$Porta/" })

$copiar = $menu.Items.Add('Copiar o link do celular')
$copiar.add_Click({
  <#
    O endereco da maquina na rede, pego na hora e nao guardado: o roteador
    troca o IP num reinicio, e um link copiado de um valor velho leva a lugar
    nenhum.
  #>
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { Set-Clipboard "http://${ip}:$Porta/" }
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$sair = $menu.Items.Add('Tirar da bandeja')
$sair.add_Click({
  # So o icone sai. O servico continua: ele e quem le o save, e encerra-lo
  # daqui faria a pessoa perder a leitura da sessao sem pedir por isso.
  $icone.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$icone.ContextMenuStrip = $menu
$icone.add_MouseDoubleClick({ Start-Process "http://localhost:$Porta/" })

<#
  A vigia do processo que abriu este icone.

  Sem ela, encerrar o servico deixaria a chama acesa na bandeja prometendo uma
  aplicacao que nao existe mais. Dois segundos e frequencia de sobra para algo
  que so precisa perceber um encerramento.
#>
if ($ProcessoPai -gt 0) {
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 2000
  $timer.add_Tick({
    if (-not (Get-Process -Id $ProcessoPai -ErrorAction SilentlyContinue)) {
      $icone.Visible = $false
      [System.Windows.Forms.Application]::Exit()
    }
  })
  $timer.Start()
}

[System.Windows.Forms.Application]::Run()
$icone.Dispose()

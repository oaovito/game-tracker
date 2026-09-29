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

<#
  O idioma do menu: o escolhido no globo da pagina (sync\idioma.json) ou, sem
  escolha, o do Windows. Os textos vao em escape de unicode e sao decodificados
  aqui: este arquivo fica em ASCII, que o PowerShell 5.1 le igual em qualquer
  maquina.
#>
$textos = @{
  'en' = @('Force update', 'Close', 'You are on the latest version ({0}).')
  'pt-BR' = @('For\u00e7ar atualiza\u00e7\u00e3o', 'Fechar', 'Voc\u00ea j\u00e1 est\u00e1 na vers\u00e3o mais recente ({0}).')
  'es' = @('Forzar actualizaci\u00f3n', 'Cerrar', 'Ya tienes la versi\u00f3n m\u00e1s reciente ({0}).')
  'fr' = @('Forcer la mise \u00e0 jour', 'Fermer', 'Vous avez d\u00e9j\u00e0 la derni\u00e8re version ({0}).')
  'de' = @('Update erzwingen', 'Schlie\u00dfen', 'Du hast bereits die neueste Version ({0}).')
  'it' = @('Forza aggiornamento', 'Chiudi', 'Hai gi\u00e0 la versione pi\u00f9 recente ({0}).')
  'ru' = @('\u041f\u0440\u0438\u043d\u0443\u0434\u0438\u0442\u0435\u043b\u044c\u043d\u043e \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c', '\u0417\u0430\u043a\u0440\u044b\u0442\u044c', '\u0423 \u0432\u0430\u0441 \u0443\u0436\u0435 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0432\u0435\u0440\u0441\u0438\u044f ({0}).')
  'pl' = @('Wymu\u015b aktualizacj\u0119', 'Zamknij', 'Masz ju\u017c najnowsz\u0105 wersj\u0119 ({0}).')
  'tr' = @('G\u00fcncellemeyi zorla', 'Kapat', 'Zaten en g\u00fcncel s\u00fcr\u00fcmdesiniz ({0}).')
  'ja' = @('\u4eca\u3059\u3050\u66f4\u65b0', '\u9589\u3058\u308b', '\u6700\u65b0\u30d0\u30fc\u30b8\u30e7\u30f3\u3067\u3059\uff08{0}\uff09\u3002')
  'ko' = @('\uac15\uc81c \uc5c5\ub370\uc774\ud2b8', '\ub2eb\uae30', '\uc774\ubbf8 \ucd5c\uc2e0 \ubc84\uc804\uc785\ub2c8\ub2e4({0}).')
  'zh-CN' = @('\u5f3a\u5236\u66f4\u65b0', '\u5173\u95ed', '\u5df2\u662f\u6700\u65b0\u7248\u672c\uff08{0}\uff09\u3002')
}
function Idioma-Atual {
  try {
    $v = (Get-Content (Join-Path $PSScriptRoot 'idioma.json') -Raw -Encoding UTF8 | ConvertFrom-Json).idioma
    if ($v -and $textos.ContainsKey($v)) { return $v }
  } catch { }
  $sistema = [System.Globalization.CultureInfo]::CurrentUICulture.Name
  if ($textos.ContainsKey($sistema)) { return $sistema }
  $base = $sistema.Split('-')[0]
  if ($base -eq 'pt') { return 'pt-BR' }
  if ($base -eq 'zh') { return 'zh-CN' }
  if ($textos.ContainsKey($base)) { return $base }
  return 'en'
}
$t = $textos[(Idioma-Atual)] | ForEach-Object { [regex]::Unescape($_) }

<#
  Abrir e so com dois cliques: na chama, ou no icone da area de trabalho. A
  janela do Trackeroao, quando instalada; sem ela, a pagina local.
#>
function Abrir-Trackeroao {
  $janela = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\Trackeroao.exe'
  if (Test-Path $janela) { Start-Process $janela }
  else { Start-Process "http://localhost:$Porta/" }
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$atualizar = $menu.Items.Add($t[0])
$atualizar.add_Click({
  <#
    O servico confere a release agora. Ja na ultima versao, um aviso pequeno
    sai ao lado desta chama e some sozinho. Havendo versao nova, ela e
    aplicada em silencio: o servico se reinicia e esta chama volta junto.
  #>
  try {
    $wc = New-Object Net.WebClient
    $wc.Encoding = [Text.Encoding]::UTF8
    $r = $wc.UploadString("http://127.0.0.1:$Porta/atualizar", '') | ConvertFrom-Json
    if ($r.atual) {
      $icone.ShowBalloonTip(4000, 'Trackeroao', ($t[2] -f $r.instalada), [System.Windows.Forms.ToolTipIcon]::None)
    }
  } catch { }
})

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$fechar = $menu.Items.Add($t[1])
$fechar.add_Click({
  <#
    Fecha tudo de verdade: a janela do Trackeroao, esta chama e o servico.
    Nada disso volta sozinho -- nem no logon, nem com o jogo -- ate a pessoa
    abrir o Trackeroao pelo atalho.
  #>
  [System.Threading.EventWaitHandle]$sinal = $null
  if ([System.Threading.EventWaitHandle]::TryOpenExisting('Local\TrackeroaoFechar', [ref]$sinal)) { [void]$sinal.Set() }
  # O servico tambem sai, e marca que so volta aberto a mao (nem no logon).
  # A marca e escrita aqui tambem, para valer mesmo com o servico sem responder.
  try { Set-Content -Path (Join-Path $PSScriptRoot 'fechado.flag') -Value (Get-Date -Format o) } catch { }
  try { (New-Object Net.WebClient).UploadString("http://127.0.0.1:$Porta/encerrar", '') | Out-Null } catch { }
  $icone.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$icone.ContextMenuStrip = $menu
$icone.add_MouseDoubleClick({ Abrir-Trackeroao })

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

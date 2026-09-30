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

O icone e o do Trackeroao: o mesmo instalador\icone\trackeroao.ico que vai
na janela e no instalador, para quem ve um reconhecer o outro. Se o arquivo
faltar, o mesmo desenho (anel de progresso e um T) e feito aqui em memoria --
icone nenhum na bandeja seria pior que um icone desenhado a mao.

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
  O icone do Trackeroao, no tamanho que o Windows usa na bandeja.

  O .ico traz de 16 a 256; pedir o SmallIconSize faz o Windows receber o
  desenho feito para aquele tamanho, e nao um reduzido de outro.
#>
function Novo-Icone {
  $tam = [System.Windows.Forms.SystemInformation]::SmallIconSize
  $arquivo = Join-Path (Split-Path $PSScriptRoot -Parent) 'instalador\icone\trackeroao.ico'
  if (Test-Path $arquivo) {
    try { return (New-Object System.Drawing.Icon -ArgumentList $arquivo, $tam.Width, $tam.Height) } catch { }
  }
  return (Desenhar-Icone)
}

<#
  A reserva: o mesmo desenho, feito em memoria.

  Quadrado escuro de cantos redondos, tres quartos de anel verde-limao e um T
  branco no meio. 32x32 porque e o tamanho que o Windows pede em tela comum;
  em tela de alta densidade ele reduz de 32 melhor do que amplia de 16.
#>
function Desenhar-Icone {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  # O fundo: quadrado de cantos redondos, no escuro da pagina.
  $fundo = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 14
  $fundo.AddArc(0, 0, $r, $r, 180, 90)
  $fundo.AddArc(31 - $r, 0, $r, $r, 270, 90)
  $fundo.AddArc(31 - $r, 31 - $r, $r, $r, 0, 90)
  $fundo.AddArc(0, 31 - $r, $r, $r, 90, 90)
  $fundo.CloseFigure()
  $escuro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 13, 18))
  $g.FillPath($escuro, $fundo)

  # O anel fechado, como no icone do Trackeroao.
  $limao = [System.Drawing.Color]::FromArgb(255, 216, 255, 60)
  $caneta = New-Object System.Drawing.Pen($limao, [single]3.5)
  $g.DrawEllipse($caneta, [single]6.5, [single]6.5, [single]19, [single]19)

  # O T: barra de cima e haste, retangulos cheios.
  $branco = [System.Drawing.Brushes]::White
  $g.FillRectangle($branco, 11, 11, 10, 3)
  $g.FillRectangle($branco, 14, 11, 4, 10)

  $caneta.Dispose(); $escuro.Dispose(); $fundo.Dispose()
  $g.Dispose()
  $icone = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  return $icone
}

$icone = New-Object System.Windows.Forms.NotifyIcon
$icone.Icon = Novo-Icone
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
  Abrir e so com dois cliques: no icone da bandeja, ou no da area de trabalho. A
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
    sai ao lado deste icone e some sozinho. Havendo versao nova, ela e
    aplicada em silencio: o servico se reinicia e este icone volta junto.
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
    Fecha tudo de verdade: a janela do Trackeroao, este icone e o servico.
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

  Sem ela, encerrar o servico deixaria o icone aceso na bandeja prometendo uma
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

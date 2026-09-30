<#
Gera a janela do Trackeroao (app\Trackeroao.exe) a partir de
instalador\janela\Trackeroao.cs.

Roda no Windows, a cada release, antes do construir-exe.ps1: o instalador leva
a janela dentro dele e a poe em <instalacao>\app. A release continua tendo um
arquivo so, o instalador.

A janela usa o WebView2, o componente de pagina que o Windows 10 e 11 ja
trazem. Para compilar contra ele e rodar, ela precisa de tres arquivos do SDK
publico da Microsoft (licenca BSD, que permite redistribuir desde que o texto
da licenca va junto -- e vai, em app\LICENSE-WebView2.txt). O pacote e baixado
do NuGet numa versao fixa e conferido pelo SHA-256 antes de qualquer uso: um
pacote diferente do esperado para a construcao aqui.

32 bits de proposito: roda igual num Windows de 32 ou de 64, com um carregador
so.
#>

param([string]$Saida = (Join-Path $PSScriptRoot 'app'))

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$projeto = Split-Path $raiz -Parent

$versaoSdk = '1.0.4258.31'
$shaSdk = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64" -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -Last 1
if (-not $csc) { throw 'csc.exe do .NET Framework nao encontrado' }

$tmp = Join-Path $env:TEMP ("trackeroao-janela-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $pacote = Join-Path $tmp 'webview2.zip'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -OutFile $pacote `
    -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$versaoSdk/microsoft.web.webview2.$versaoSdk.nupkg"
  $obtido = (Get-FileHash $pacote -Algorithm SHA256).Hash.ToLower()
  if ($obtido -ne $shaSdk) { throw "o pacote do WebView2 nao confere: $obtido" }
  Expand-Archive -Path $pacote -DestinationPath (Join-Path $tmp 'sdk') -Force
  $sdk = Join-Path $tmp 'sdk'

  if (Test-Path $Saida) { Remove-Item -Recurse -Force $Saida }
  New-Item -ItemType Directory -Path $Saida -Force | Out-Null
  $core = Join-Path $Saida 'Microsoft.Web.WebView2.Core.dll'
  $forms = Join-Path $Saida 'Microsoft.Web.WebView2.WinForms.dll'
  Copy-Item (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll') $core
  Copy-Item (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll') $forms
  Copy-Item (Join-Path $sdk 'runtimes\win-x86\native\WebView2Loader.dll') (Join-Path $Saida 'WebView2Loader.dll')
  Copy-Item (Join-Path $sdk 'LICENSE.txt') (Join-Path $Saida 'LICENSE-WebView2.txt')

  # O icone: o do Trackeroao, ja em .ico com todos os tamanhos (16 a 256).
  $icone = Join-Path $projeto 'instalador\icone\trackeroao.ico'
  if (-not (Test-Path $icone)) { throw "faltou o icone: $icone" }

  $exe = Join-Path $Saida 'Trackeroao.exe'
  & $csc.FullName /nologo /target:winexe /platform:x86 /optimize+ "/out:$exe" "/win32icon:$icone" `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll "/r:$core" "/r:$forms" `
    (Join-Path $raiz 'janela\Trackeroao.cs')
  if ($LASTEXITCODE -ne 0) { throw "csc falhou com codigo $LASTEXITCODE" }
  Write-Host "janela gerada em $Saida" -ForegroundColor Green
  Get-ChildItem $Saida | ForEach-Object { Write-Host ("  {0,-40} {1,8:N0} bytes" -f $_.Name, $_.Length) }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

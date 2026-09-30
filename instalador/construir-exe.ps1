<#
Gera o trackeroao-instalador.exe a partir do instalar.ps1 e do
desinstalar.ps1 -- o mesmo .exe faz os dois papeis, como explicado abaixo.

Roda no Windows, e roda sozinho a cada release: a Action de release chama este
script num runner Windows e anexa o .exe. Com -Saida, grava noutra pasta; com
-Versao, carimba a versao da release nas propriedades do arquivo.

Por que compilar em vez de so distribuir o .ps1: um .ps1 aberto por duplo
clique abre o editor em vez de executar, e mesmo pela linha de comando esbarra
na politica de execucao. Um .exe roda em qualquer maquina com duplo clique,
que e o que se quer de um instalador.

Por que nao o ps2exe: ele vem da PowerShell Gallery e exige instalar um
provider, o que nem sempre da certo em maquina alheia. O compilador C# do
.NET Framework ja vem com o Windows desde sempre, entao este script depende
so do que a maquina ja tem. Esse compilador so entende C# 5: nada de cifrao
antes de aspas, => em membro, ?. ou nameof no codigo abaixo. E o codigo mora
numa here-string do PowerShell, entao tambem nada de cifrao nem de crase nele,
e acento so em escape de unicode (barra, u, quatro digitos).

A janela. O .exe e um programa de janela (winexe), e nao de console: quem
instala ve uma caixa pequena com o passo atual, uma barra de progresso e uma
linha de detalhe, e nada mais. O PowerShell roda escondido e conta o que esta
fazendo por linhas "@@" na saida padrao (o protocolo esta descrito na classe
Janela). O pedido de administrador tambem saiu do script e veio para ca: o
.exe se relanca elevado uma vez, e o script nunca abre uma segunda janela.

Desinstalando, a mesma janela. O desinstalador mora dentro da pasta que ele
apaga, e um .exe aberto nao pode ser apagado; por isso ele se copia para a
pasta temporaria e passa a vez para a copia, que mostra a janela ate o fim.

Por que o script e gravado em disco e chamado com -File, e NAO passado por
-EncodedCommand: -EncodedCommand seria mais curto e foi assim que isto nasceu,
e o Windows Defender mata o processo antes de ele existir, reportando
Trojan:Win32/ClickFix.PM!MTB. A assinatura nao e do nosso script -- e da forma
"um .exe qualquer abre o powershell com um blob codificado", o padrao das
campanhas em que a pessoa e convencida a colar um comando codificado no
Executar. O sintoma engana: vem como "Access is denied" do CreateProcess. Um
.ps1 legivel em disco e o caminho que o Windows considera normal. Pelo mesmo
motivo a politica de execucao vai pela variavel PSExecutionPolicyPreference, e
nao por -ExecutionPolicy Bypass na linha de comando.

O que mais ajuda o antivirus a reconhecer um instalador comum esta aqui: o
manifesto (roda como o usuario, declara as versoes do Windows e a escala de
tela), as propriedades do arquivo (produto, descricao, versao, autor) e o
icone. O aviso azul do SmartScreen ("O Windows protegeu o computador") e outra
coisa: ele vale para todo .exe baixado sem assinatura digital de codigo, e so
some com um certificado de assinatura. Isso nao se resolve no codigo.

O modo de ensaio (/ensaio=<script.ps1> /fechar) roda outro script no lugar do
embutido e fecha sozinho no fim, devolvendo 0 ou 1. E como a Action confere,
num Windows de verdade, que a janela abre, le o protocolo e termina.
#>

<#
  -App: a pasta com a janela do Trackeroao (o que o construir-janela.ps1
  gera). Cada arquivo dela vai dentro do .exe como recurso "app/<nome>", e o
  instalador os entrega ao script, que os poe em <instalacao>\app.
#>
param([string]$Saida = $PSScriptRoot, [string]$Versao = '', [string]$App = '')

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$projeto = Split-Path $raiz -Parent
New-Item -ItemType Directory -Path $Saida -Force | Out-Null

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64" -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -Last 1
if (-not $csc) { throw 'csc.exe do .NET Framework nao encontrado' }

# UTF-8 em base64, e lido como UTF-8 de proposito: sem o -Encoding, o
# PowerShell 5.1 le arquivo sem BOM como ANSI e o acento chegaria trocado
# dentro do .exe. Do outro lado ele e regravado como UTF-8 com BOM, pelo mesmo
# motivo.
function Embutir($nome) {
  $fonte = Join-Path $raiz $nome
  if (-not (Test-Path $fonte)) { throw "nao achei $fonte" }
  $texto = Get-Content $fonte -Raw -Encoding UTF8
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($texto))
}
$b64Instalar = Embutir 'instalar.ps1'
$b64Desinstalar = Embutir 'desinstalar.ps1'
$exe = Join-Path $Saida 'trackeroao-instalador.exe'

# A versao numerica que o Windows mostra nas propriedades: v1.6.4 -> 1.6.4.0.
$versaoNum = '0.0.0.0'
if ($Versao -match '(\d+)\.(\d+)\.(\d+)') { $versaoNum = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0" }

$tmp = Join-Path $env:TEMP ("trackeroao-exe-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

<#
  O icone: o do Trackeroao, ja pronto em instalador/icone/trackeroao.ico, com
  todos os tamanhos que o Windows pede (16 a 256). O desenho vive em SVG na
  mesma pasta; o .ico e so a forma que o compilador aceita.
#>
$icone = Join-Path $projeto 'instalador\icone\trackeroao.ico'
if (-not (Test-Path $icone)) { throw "faltou o icone: $icone" }

$manifesto = Join-Path $tmp 'trackeroao.manifest'
@'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="1.0.0.0" name="Trackeroao.Instalador" type="win32"/>
  <description>Instalador do Trackeroao</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
    </windowsSettings>
  </application>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0"
        processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>
</assembly>
'@ | Set-Content -Path $manifesto -Encoding UTF8

$cs = @"
using System;
using System.Collections.Generic;
using System.Globalization;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

[assembly: AssemblyTitle("Trackeroao")]
[assembly: AssemblyDescription("Instalador do Trackeroao")]
[assembly: AssemblyCompany("oaovito")]
[assembly: AssemblyProduct("Trackeroao")]
[assembly: AssemblyCopyright("oaovito")]
[assembly: AssemblyVersion("$versaoNum")]
[assembly: AssemblyFileVersion("$versaoNum")]
[assembly: AssemblyInformationalVersion("$versaoNum")]

/*
 * Os textos da janela e dos passos, em doze idiomas. O idioma e o escolhido
 * no globo da pagina (sync\\idioma.json, de uma instalacao anterior) ou, sem
 * escolha, o do Windows. O script manda "#id|arg|arg" no lugar do texto, e e
 * aqui que ele vira frase; texto sem # passa como veio. O nome Trackeroao
 * nunca e traduzido.
 */
static class Textos {
  static readonly string[] Idiomas = { "en", "pt-BR", "es", "fr", "de", "it", "ru", "pl", "tr", "ja", "ko", "zh-CN" };
  static readonly Dictionary<string, string[]> Tabela = new Dictionary<string, string[]> {
    { "prep_inst", new string[] { "Preparing the installation", "Preparando a instala\u00e7\u00e3o", "Preparando la instalaci\u00f3n", "Pr\u00e9paration de l\u2019installation", "Installation wird vorbereitet", "Preparazione dell\u2019installazione", "\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043a \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0435", "Przygotowywanie instalacji", "Kurulum haz\u0131rlan\u0131yor", "\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059", "\uc124\uce58 \uc900\ube44 \uc911", "\u6b63\u5728\u51c6\u5907\u5b89\u88c5" } },
    { "prep_rem", new string[] { "Preparing the removal", "Preparando a remo\u00e7\u00e3o", "Preparando la desinstalaci\u00f3n", "Pr\u00e9paration de la d\u00e9sinstallation", "Deinstallation wird vorbereitet", "Preparazione della rimozione", "\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043a \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044e", "Przygotowywanie usuwania", "Kald\u0131rma haz\u0131rlan\u0131yor", "\u524a\u9664\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059", "\uc81c\uac70 \uc900\ube44 \uc911", "\u6b63\u5728\u51c6\u5907\u5378\u8f7d" } },
    { "node_check", new string[] { "Checking Node.js", "Verificando o Node.js", "Comprobando Node.js", "V\u00e9rification de Node.js", "Node.js wird gepr\u00fcft", "Verifica di Node.js", "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 Node.js", "Sprawdzanie Node.js", "Node.js denetleniyor", "Node.js \u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059", "Node.js \ud655\uc778 \uc911", "\u6b63\u5728\u68c0\u67e5 Node.js" } },
    { "node_dl", new string[] { "Downloading Node.js", "Baixando o Node.js", "Descargando Node.js", "T\u00e9l\u00e9chargement de Node.js", "Node.js wird heruntergeladen", "Download di Node.js", "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 Node.js", "Pobieranie Node.js", "Node.js indiriliyor", "Node.js \u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3057\u3066\u3044\u307e\u3059", "Node.js \ub2e4\uc6b4\ub85c\ub4dc \uc911", "\u6b63\u5728\u4e0b\u8f7d Node.js" } },
    { "node_dl_d", new string[] { "Straight from nodejs.org, with the signature checked", "Direto do nodejs.org, com a assinatura conferida", "Directamente de nodejs.org, con la firma verificada", "Directement depuis nodejs.org, signature v\u00e9rifi\u00e9e", "Direkt von nodejs.org, Signatur gepr\u00fcft", "Direttamente da nodejs.org, con la firma verificata", "\u041f\u0440\u044f\u043c\u043e \u0441 nodejs.org, \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u0430", "Prosto z nodejs.org, z weryfikacj\u0105 podpisu", "Do\u011frudan nodejs.org\u2019dan, imzas\u0131 do\u011frulanarak", "nodejs.org \u304b\u3089\u76f4\u63a5\u3001\u7f72\u540d\u3092\u78ba\u8a8d\u3057\u3066", "nodejs.org\uc5d0\uc11c \uc9c1\uc811, \uc11c\uba85 \ud655\uc778 \uc644\ub8cc", "\u76f4\u63a5\u6765\u81ea nodejs.org\uff0c\u5df2\u6821\u9a8c\u7b7e\u540d" } },
    { "node_inst", new string[] { "Installing Node.js", "Instalando o Node.js", "Instalando Node.js", "Installation de Node.js", "Node.js wird installiert", "Installazione di Node.js", "\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430 Node.js", "Instalowanie Node.js", "Node.js kuruluyor", "Node.js \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u3044\u307e\u3059", "Node.js \uc124\uce58 \uc911", "\u6b63\u5728\u5b89\u88c5 Node.js" } },
    { "node_inst_d", new string[] { "Through winget, the Windows package installer", "Pelo winget, o instalador de programas do Windows", "Mediante winget, el instalador de programas de Windows", "Via winget, le gestionnaire de paquets de Windows", "\u00dcber winget, den Paketinstaller von Windows", "Tramite winget, il gestore di pacchetti di Windows", "\u0427\u0435\u0440\u0435\u0437 winget, \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0449\u0438\u043a \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c Windows", "Przez winget, instalator program\u00f3w Windows", "Windows paket y\u00fckleyicisi winget ile", "Windows \u306e\u30d1\u30c3\u30b1\u30fc\u30b8 \u30a4\u30f3\u30b9\u30c8\u30fc\u30e9\u30fc winget \u3067", "Windows \ud328\ud0a4\uc9c0 \uc124\uce58 \ub3c4\uad6c winget\uc73c\ub85c", "\u901a\u8fc7 Windows \u7a0b\u5e8f\u5b89\u88c5\u5de5\u5177 winget" } },
    { "node_fail", new string[] { "Couldn\u2019t get Node.js, which Trackeroao needs to run. Check your internet connection and try again.", "N\u00e3o consegui obter o Node.js, que o Trackeroao precisa para rodar. Confira a internet e tente de novo.", "No se pudo obtener Node.js, que Trackeroao necesita para funcionar. Revisa tu conexi\u00f3n y vuelve a intentarlo.", "Impossible d\u2019obtenir Node.js, n\u00e9cessaire au fonctionnement de Trackeroao. V\u00e9rifiez votre connexion et r\u00e9essayez.", "Node.js, das Trackeroao zum Laufen braucht, konnte nicht geladen werden. Pr\u00fcfe die Internetverbindung und versuche es erneut.", "Impossibile ottenere Node.js, necessario per Trackeroao. Controlla la connessione e riprova.", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c Node.js, \u043d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u044b\u0439 \u0434\u043b\u044f \u0440\u0430\u0431\u043e\u0442\u044b Trackeroao. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043a \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0443 \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.", "Nie uda\u0142o si\u0119 pobra\u0107 Node.js, kt\u00f3rego Trackeroao potrzebuje do dzia\u0142ania. Sprawd\u017a po\u0142\u0105czenie i spr\u00f3buj ponownie.", "Trackeroao\u2019nun \u00e7al\u0131\u015fmas\u0131 i\u00e7in gereken Node.js al\u0131namad\u0131. \u0130nternet ba\u011flant\u0131n\u0131z\u0131 kontrol edip tekrar deneyin.", "Trackeroao \u306e\u5b9f\u884c\u306b\u5fc5\u8981\u306a Node.js \u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u30a4\u30f3\u30bf\u30fc\u30cd\u30c3\u30c8\u63a5\u7d9a\u3092\u78ba\u8a8d\u3057\u3066\u3001\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002", "Trackeroao \uc2e4\ud589\uc5d0 \ud544\uc694\ud55c Node.js\ub97c \uac00\uc838\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc778\ud130\ub137 \uc5f0\uacb0\uc744 \ud655\uc778\ud558\uace0 \ub2e4\uc2dc \uc2dc\ub3c4\ud558\uc138\uc694.", "\u65e0\u6cd5\u83b7\u53d6 Trackeroao \u8fd0\u884c\u6240\u9700\u7684 Node.js\u3002\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5\u540e\u91cd\u8bd5\u3002" } },
    { "node_broken", new string[] { "The Node.js found on this computer isn\u2019t working.", "O Node.js encontrado nesta m\u00e1quina n\u00e3o est\u00e1 funcionando.", "El Node.js encontrado en este equipo no funciona.", "Le Node.js trouv\u00e9 sur cet ordinateur ne fonctionne pas.", "Das auf diesem Computer gefundene Node.js funktioniert nicht.", "Il Node.js trovato su questo computer non funziona.", "\u041d\u0430\u0439\u0434\u0435\u043d\u043d\u044b\u0439 \u043d\u0430 \u044d\u0442\u043e\u043c \u043a\u043e\u043c\u043f\u044c\u044e\u0442\u0435\u0440\u0435 Node.js \u043d\u0435 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442.", "Node.js znaleziony na tym komputerze nie dzia\u0142a.", "Bu bilgisayarda bulunan Node.js \u00e7al\u0131\u015fm\u0131yor.", "\u3053\u306e\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u30fc\u306e Node.js \u304c\u52d5\u4f5c\u3057\u3066\u3044\u307e\u305b\u3093\u3002", "\uc774 \ucef4\ud4e8\ud130\uc5d0\uc11c \ucc3e\uc740 Node.js\uac00 \uc791\ub3d9\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.", "\u6b64\u7535\u8111\u4e0a\u627e\u5230\u7684 Node.js \u65e0\u6cd5\u8fd0\u884c\u3002" } },
    { "dl", new string[] { "Downloading Trackeroao", "Baixando o Trackeroao", "Descargando Trackeroao", "T\u00e9l\u00e9chargement de Trackeroao", "Trackeroao wird heruntergeladen", "Download di Trackeroao", "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 Trackeroao", "Pobieranie Trackeroao", "Trackeroao indiriliyor", "Trackeroao \u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3057\u3066\u3044\u307e\u3059", "Trackeroao \ub2e4\uc6b4\ub85c\ub4dc \uc911", "\u6b63\u5728\u4e0b\u8f7d Trackeroao" } },
    { "dl_d", new string[] { "The latest version, from the official repository", "A vers\u00e3o mais recente, do reposit\u00f3rio oficial", "La versi\u00f3n m\u00e1s reciente, del repositorio oficial", "La derni\u00e8re version, depuis le d\u00e9p\u00f4t officiel", "Die neueste Version aus dem offiziellen Repository", "L\u2019ultima versione, dal repository ufficiale", "\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0432\u0435\u0440\u0441\u0438\u044f \u0438\u0437 \u043e\u0444\u0438\u0446\u0438\u0430\u043b\u044c\u043d\u043e\u0433\u043e \u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0438\u044f", "Najnowsza wersja z oficjalnego repozytorium", "Resm\u00ee depodan en son s\u00fcr\u00fcm", "\u516c\u5f0f\u30ea\u30dd\u30b8\u30c8\u30ea\u306e\u6700\u65b0\u30d0\u30fc\u30b8\u30e7\u30f3", "\uacf5\uc2dd \uc800\uc7a5\uc18c\uc758 \ucd5c\uc2e0 \ubc84\uc804", "\u6765\u81ea\u5b98\u65b9\u4ed3\u5e93\u7684\u6700\u65b0\u7248\u672c" } },
    { "dl_fail", new string[] { "Couldn\u2019t download Trackeroao. Check your internet connection and try again.", "N\u00e3o consegui baixar o Trackeroao. Confira a internet e tente de novo.", "No se pudo descargar Trackeroao. Revisa tu conexi\u00f3n y vuelve a intentarlo.", "Impossible de t\u00e9l\u00e9charger Trackeroao. V\u00e9rifiez votre connexion et r\u00e9essayez.", "Trackeroao konnte nicht heruntergeladen werden. Pr\u00fcfe die Internetverbindung und versuche es erneut.", "Impossibile scaricare Trackeroao. Controlla la connessione e riprova.", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c Trackeroao. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043a \u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442\u0443 \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u043f\u044b\u0442\u043a\u0443.", "Nie uda\u0142o si\u0119 pobra\u0107 Trackeroao. Sprawd\u017a po\u0142\u0105czenie i spr\u00f3buj ponownie.", "Trackeroao indirilemedi. \u0130nternet ba\u011flant\u0131n\u0131z\u0131 kontrol edip tekrar deneyin.", "Trackeroao \u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u30a4\u30f3\u30bf\u30fc\u30cd\u30c3\u30c8\u63a5\u7d9a\u3092\u78ba\u8a8d\u3057\u3066\u3001\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002", "Trackeroao\ub97c \ub2e4\uc6b4\ub85c\ub4dc\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc778\ud130\ub137 \uc5f0\uacb0\uc744 \ud655\uc778\ud558\uace0 \ub2e4\uc2dc \uc2dc\ub3c4\ud558\uc138\uc694.", "\u65e0\u6cd5\u4e0b\u8f7d Trackeroao\u3002\u8bf7\u68c0\u67e5\u7f51\u7edc\u8fde\u63a5\u540e\u91cd\u8bd5\u3002" } },
    { "copy", new string[] { "Copying the files", "Copiando os arquivos", "Copiando los archivos", "Copie des fichiers", "Dateien werden kopiert", "Copia dei file", "\u041a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0444\u0430\u0439\u043b\u043e\u0432", "Kopiowanie plik\u00f3w", "Dosyalar kopyalan\u0131yor", "\u30d5\u30a1\u30a4\u30eb\u3092\u30b3\u30d4\u30fc\u3057\u3066\u3044\u307e\u3059", "\ud30c\uc77c \ubcf5\uc0ac \uc911", "\u6b63\u5728\u590d\u5236\u6587\u4ef6" } },
    { "version", new string[] { "Version {0}", "Vers\u00e3o {0}", "Versi\u00f3n {0}", "Version {0}", "Version {0}", "Versione {0}", "\u0412\u0435\u0440\u0441\u0438\u044f {0}", "Wersja {0}", "S\u00fcr\u00fcm {0}", "\u30d0\u30fc\u30b8\u30e7\u30f3 {0}", "\ubc84\uc804 {0}", "\u7248\u672c {0}" } },
    { "copy_fail", new string[] { "Copying the files failed, and nothing was installed.", "A c\u00f3pia dos arquivos falhou, e nada foi instalado.", "La copia de los archivos fall\u00f3 y no se instal\u00f3 nada.", "La copie des fichiers a \u00e9chou\u00e9, rien n\u2019a \u00e9t\u00e9 install\u00e9.", "Das Kopieren der Dateien ist fehlgeschlagen, es wurde nichts installiert.", "La copia dei file non \u00e8 riuscita e non \u00e8 stato installato nulla.", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0444\u0430\u0439\u043b\u044b, \u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043e.", "Kopiowanie plik\u00f3w nie powiod\u0142o si\u0119 i nic nie zosta\u0142o zainstalowane.", "Dosyalar kopyalanamad\u0131, hi\u00e7bir \u015fey kurulmad\u0131.", "\u30d5\u30a1\u30a4\u30eb\u306e\u30b3\u30d4\u30fc\u306b\u5931\u6557\u3057\u305f\u305f\u3081\u3001\u4f55\u3082\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002", "\ud30c\uc77c \ubcf5\uc0ac\uc5d0 \uc2e4\ud328\ud558\uc5ec \uc544\ubb34\uac83\ub3c4 \uc124\uce58\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.", "\u6587\u4ef6\u590d\u5236\u5931\u8d25\uff0c\u672a\u5b89\u88c5\u4efb\u4f55\u5185\u5bb9\u3002" } },
    { "register", new string[] { "Registering with Windows", "Registrando no Windows", "Registrando en Windows", "Enregistrement dans Windows", "Registrierung in Windows", "Registrazione in Windows", "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u0432 Windows", "Rejestrowanie w systemie Windows", "Windows\u2019a kaydediliyor", "Windows \u306b\u767b\u9332\u3057\u3066\u3044\u307e\u3059", "Windows\uc5d0 \ub4f1\ub85d \uc911", "\u6b63\u5728\u5411 Windows \u6ce8\u518c" } },
    { "register_d", new string[] { "In Installed apps, so it can be removed later", "Em Aplicativos instalados, para poder remover depois", "En Aplicaciones instaladas, para poder quitarlo despu\u00e9s", "Dans Applications install\u00e9es, pour pouvoir le supprimer plus tard", "Unter \u201eInstallierte Apps\u201c, damit es sp\u00e4ter entfernt werden kann", "In App installate, per poterlo rimuovere in seguito", "\u0412 \u00ab\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043d\u044b\u0445 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u0445\u00bb, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0442\u043e\u043c \u043c\u043e\u0436\u043d\u043e \u0431\u044b\u043b\u043e \u0443\u0434\u0430\u043b\u0438\u0442\u044c", "W Zainstalowanych aplikacjach, aby mo\u017cna by\u0142o go p\u00f3\u017aniej usun\u0105\u0107", "Daha sonra kald\u0131r\u0131labilmesi i\u00e7in Y\u00fckl\u00fc uygulamalar\u2019a", "\u5f8c\u3067\u524a\u9664\u3067\u304d\u308b\u3088\u3046\u300c\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3055\u308c\u3066\u3044\u308b\u30a2\u30d7\u30ea\u300d\u306b", "\ub098\uc911\uc5d0 \uc81c\uac70\ud560 \uc218 \uc788\ub3c4\ub85d \uc124\uce58\ub41c \uc571\uc5d0", "\u6dfb\u52a0\u5230\u201c\u5df2\u5b89\u88c5\u7684\u5e94\u7528\u201d\uff0c\u4ee5\u4fbf\u65e5\u540e\u5378\u8f7d" } },
    { "service", new string[] { "Setting up the background service", "Preparando o servi\u00e7o em segundo plano", "Preparando el servicio en segundo plano", "Configuration du service en arri\u00e8re-plan", "Hintergrunddienst wird eingerichtet", "Configurazione del servizio in background", "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430 \u0444\u043e\u043d\u043e\u0432\u043e\u0439 \u0441\u043b\u0443\u0436\u0431\u044b", "Konfigurowanie us\u0142ugi w tle", "Arka plan hizmeti haz\u0131rlan\u0131yor", "\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u30c9 \u30b5\u30fc\u30d3\u30b9\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059", "\ubc31\uadf8\ub77c\uc6b4\ub4dc \uc11c\ube44\uc2a4 \uc900\ube44 \uc911", "\u6b63\u5728\u8bbe\u7f6e\u540e\u53f0\u670d\u52a1" } },
    { "service_d", new string[] { "It follows the game without opening any window", "Ele acompanha o jogo sem abrir janela nenhuma", "Sigue el juego sin abrir ninguna ventana", "Il suit le jeu sans ouvrir aucune fen\u00eatre", "Er verfolgt das Spiel, ohne ein Fenster zu \u00f6ffnen", "Segue il gioco senza aprire alcuna finestra", "\u0421\u043b\u0435\u0434\u0438\u0442 \u0437\u0430 \u0438\u0433\u0440\u043e\u0439, \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u044f \u043e\u043a\u043e\u043d", "\u015aledzi gr\u0119 bez otwierania \u017cadnego okna", "Hi\u00e7bir pencere a\u00e7madan oyunu takip eder", "\u30a6\u30a3\u30f3\u30c9\u30a6\u3092\u958b\u304b\u305a\u306b\u30b2\u30fc\u30e0\u3092\u8ffd\u8de1\u3057\u307e\u3059", "\ucc3d\uc744 \uc5f4\uc9c0 \uc54a\uace0 \uac8c\uc784\uc744 \ub530\ub77c\uac11\ub2c8\ub2e4", "\u5728\u4e0d\u6253\u5f00\u4efb\u4f55\u7a97\u53e3\u7684\u60c5\u51b5\u4e0b\u8ddf\u8e2a\u6e38\u620f" } },
    { "window", new string[] { "Installing the Trackeroao window", "Instalando a janela do Trackeroao", "Instalando la ventana de Trackeroao", "Installation de la fen\u00eatre Trackeroao", "Trackeroao-Fenster wird installiert", "Installazione della finestra di Trackeroao", "\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430 \u043e\u043a\u043d\u0430 Trackeroao", "Instalowanie okna Trackeroao", "Trackeroao penceresi kuruluyor", "Trackeroao \u306e\u30a6\u30a3\u30f3\u30c9\u30a6\u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3066\u3044\u307e\u3059", "Trackeroao \ucc3d \uc124\uce58 \uc911", "\u6b63\u5728\u5b89\u88c5 Trackeroao \u7a97\u53e3" } },
    { "shortcut", new string[] { "Creating the desktop shortcut", "Criando o atalho na \u00e1rea de trabalho", "Creando el acceso directo en el escritorio", "Cr\u00e9ation du raccourci sur le bureau", "Desktopverkn\u00fcpfung wird erstellt", "Creazione del collegamento sul desktop", "\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u044f\u0440\u043b\u044b\u043a\u0430 \u043d\u0430 \u0440\u0430\u0431\u043e\u0447\u0435\u043c \u0441\u0442\u043e\u043b\u0435", "Tworzenie skr\u00f3tu na pulpicie", "Masa\u00fcst\u00fc k\u0131sayolu olu\u015fturuluyor", "\u30c7\u30b9\u30af\u30c8\u30c3\u30d7\u306b\u30b7\u30e7\u30fc\u30c8\u30ab\u30c3\u30c8\u3092\u4f5c\u6210\u3057\u3066\u3044\u307e\u3059", "\ubc14\ud0d5 \ud654\uba74 \ubc14\ub85c \uac00\uae30 \ub9cc\ub4dc\ub294 \uc911", "\u6b63\u5728\u521b\u5efa\u684c\u9762\u5feb\u6377\u65b9\u5f0f" } },
    { "shortcut_fail", new string[] { "The desktop shortcut couldn\u2019t be created.", "N\u00e3o consegui criar o atalho na \u00e1rea de trabalho.", "No se pudo crear el acceso directo en el escritorio.", "Impossible de cr\u00e9er le raccourci sur le bureau.", "Die Desktopverkn\u00fcpfung konnte nicht erstellt werden.", "Impossibile creare il collegamento sul desktop.", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u044f\u0440\u043b\u044b\u043a \u043d\u0430 \u0440\u0430\u0431\u043e\u0447\u0435\u043c \u0441\u0442\u043e\u043b\u0435.", "Nie uda\u0142o si\u0119 utworzy\u0107 skr\u00f3tu na pulpicie.", "Masa\u00fcst\u00fc k\u0131sayolu olu\u015fturulamad\u0131.", "\u30c7\u30b9\u30af\u30c8\u30c3\u30d7\u306e\u30b7\u30e7\u30fc\u30c8\u30ab\u30c3\u30c8\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002", "\ubc14\ud0d5 \ud654\uba74 \ubc14\ub85c \uac00\uae30\ub97c \ub9cc\ub4e4\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.", "\u65e0\u6cd5\u521b\u5efa\u684c\u9762\u5feb\u6377\u65b9\u5f0f\u3002" } },
    { "net", new string[] { "Allowing access from your phone", "Liberando o acesso pelo celular", "Permitiendo el acceso desde el m\u00f3vil", "Autorisation de l\u2019acc\u00e8s depuis le t\u00e9l\u00e9phone", "Zugriff vom Handy wird erlaubt", "Abilitazione dell\u2019accesso dal telefono", "\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u0441 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430", "Zezwalanie na dost\u0119p z telefonu", "Telefondan eri\u015fime izin veriliyor", "\u30b9\u30de\u30fc\u30c8\u30d5\u30a9\u30f3\u304b\u3089\u306e\u30a2\u30af\u30bb\u30b9\u3092\u8a31\u53ef\u3057\u3066\u3044\u307e\u3059", "\ud734\ub300\ud3f0 \uc811\uadfc \ud5c8\uc6a9 \uc911", "\u6b63\u5728\u5141\u8bb8\u624b\u673a\u8bbf\u95ee" } },
    { "net_d", new string[] { "Port 8777, on your home network only", "A porta 8777, s\u00f3 na rede de casa", "El puerto 8777, solo en la red de casa", "Le port 8777, uniquement sur le r\u00e9seau local", "Port 8777, nur im Heimnetz", "La porta 8777, solo sulla rete di casa", "\u041f\u043e\u0440\u0442 8777, \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u0434\u043e\u043c\u0430\u0448\u043d\u0435\u0439 \u0441\u0435\u0442\u0438", "Port 8777, tylko w sieci domowej", "8777 numaral\u0131 ba\u011flant\u0131 noktas\u0131, yaln\u0131zca ev a\u011f\u0131nda", "\u30dd\u30fc\u30c8 8777\u3001\u81ea\u5b85\u306e\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u5185\u306e\u307f", "\ud3ec\ud2b8 8777, \uc9d1 \ub124\ud2b8\uc6cc\ud06c\uc5d0\uc11c\ub9cc", "\u7aef\u53e3 8777\uff0c\u4ec5\u9650\u5bb6\u5ead\u7f51\u7edc" } },
    { "net_pending", new string[] { "Port 8777 wasn\u2019t opened, so your phone can\u2019t find Trackeroao yet. To open it, install again and accept the administrator prompt.", "A porta 8777 n\u00e3o foi liberada, ent\u00e3o o celular ainda n\u00e3o acha o Trackeroao. Para liberar, instale de novo e aceite o pedido de administrador.", "El puerto 8777 no se abri\u00f3, as\u00ed que el m\u00f3vil a\u00fan no encuentra Trackeroao. Para abrirlo, vuelve a instalar y acepta la solicitud de administrador.", "Le port 8777 n\u2019a pas \u00e9t\u00e9 ouvert : le t\u00e9l\u00e9phone ne trouve pas encore Trackeroao. Pour l\u2019ouvrir, r\u00e9installez et acceptez la demande d\u2019administrateur.", "Port 8777 wurde nicht freigegeben, daher findet das Handy Trackeroao noch nicht. Installiere erneut und best\u00e4tige die Administratoranfrage.", "La porta 8777 non \u00e8 stata aperta, quindi il telefono non trova ancora Trackeroao. Per aprirla, reinstalla e accetta la richiesta di amministratore.", "\u041f\u043e\u0440\u0442 8777 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u0442, \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u0442\u0435\u043b\u0435\u0444\u043e\u043d \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0445\u043e\u0434\u0438\u0442 Trackeroao. \u0427\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0435\u0433\u043e, \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u043d\u043e\u0432\u0430 \u0438 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0437\u0430\u043f\u0440\u043e\u0441 \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430.", "Port 8777 nie zosta\u0142 otwarty, wi\u0119c telefon jeszcze nie znajdzie Trackeroao. Aby go otworzy\u0107, zainstaluj ponownie i zaakceptuj pro\u015bb\u0119 administratora.", "8777 numaral\u0131 ba\u011flant\u0131 noktas\u0131 a\u00e7\u0131lmad\u0131, bu y\u00fczden telefon Trackeroao\u2019yu hen\u00fcz bulam\u0131yor. A\u00e7mak i\u00e7in yeniden kurun ve y\u00f6netici iste\u011fini onaylay\u0131n.", "\u30dd\u30fc\u30c8 8777 \u304c\u958b\u304b\u308c\u3066\u3044\u306a\u3044\u305f\u3081\u3001\u30b9\u30de\u30fc\u30c8\u30d5\u30a9\u30f3\u304b\u3089\u307e\u3060 Trackeroao \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002\u3082\u3046\u4e00\u5ea6\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u3001\u7ba1\u7406\u8005\u306e\u78ba\u8a8d\u3092\u8a31\u53ef\u3057\u3066\u304f\u3060\u3055\u3044\u3002", "\ud3ec\ud2b8 8777\uc774 \uc5f4\ub9ac\uc9c0 \uc54a\uc544 \ud734\ub300\ud3f0\uc5d0\uc11c \uc544\uc9c1 Trackeroao\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc124\uce58\ud558\uace0 \uad00\ub9ac\uc790 \uc694\uccad\uc744 \uc218\ub77d\ud558\uc138\uc694.", "\u7aef\u53e3 8777 \u672a\u5f00\u653e\uff0c\u624b\u673a\u6682\u65f6\u627e\u4e0d\u5230 Trackeroao\u3002\u8bf7\u91cd\u65b0\u5b89\u88c5\u5e76\u63a5\u53d7\u7ba1\u7406\u5458\u8bf7\u6c42\u3002" } },
    { "read", new string[] { "Reading your progress", "Lendo o seu progresso", "Leyendo tu progreso", "Lecture de votre progression", "Dein Fortschritt wird gelesen", "Lettura dei tuoi progressi", "\u0427\u0442\u0435\u043d\u0438\u0435 \u0432\u0430\u0448\u0435\u0433\u043e \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441\u0430", "Odczytywanie post\u0119pu", "\u0130lerlemeniz okunuyor", "\u9032\u884c\u72b6\u6cc1\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u3059", "\uc9c4\ud589 \uc0c1\ud669\uc744 \uc77d\ub294 \uc911", "\u6b63\u5728\u8bfb\u53d6\u4f60\u7684\u8fdb\u5ea6" } },
    { "check", new string[] { "Checking the installation", "Conferindo a instala\u00e7\u00e3o", "Comprobando la instalaci\u00f3n", "V\u00e9rification de l\u2019installation", "Installation wird gepr\u00fcft", "Verifica dell\u2019installazione", "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0438", "Sprawdzanie instalacji", "Kurulum denetleniyor", "\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059", "\uc124\uce58 \ud655\uc778 \uc911", "\u6b63\u5728\u68c0\u67e5\u5b89\u88c5" } },
    { "check_d", new string[] { "Running Trackeroao\u2019s tests on this computer", "Rodando os testes do Trackeroao nesta m\u00e1quina", "Ejecutando las pruebas de Trackeroao en este equipo", "Ex\u00e9cution des tests de Trackeroao sur cet ordinateur", "Trackeroao-Tests laufen auf diesem Computer", "Esecuzione dei test di Trackeroao su questo computer", "\u0417\u0430\u043f\u0443\u0441\u043a \u0442\u0435\u0441\u0442\u043e\u0432 Trackeroao \u043d\u0430 \u044d\u0442\u043e\u043c \u043a\u043e\u043c\u043f\u044c\u044e\u0442\u0435\u0440\u0435", "Uruchamianie test\u00f3w Trackeroao na tym komputerze", "Trackeroao testleri bu bilgisayarda \u00e7al\u0131\u015ft\u0131r\u0131l\u0131yor", "\u3053\u306e\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u30fc\u3067 Trackeroao \u306e\u30c6\u30b9\u30c8\u3092\u5b9f\u884c\u3057\u3066\u3044\u307e\u3059", "\uc774 \ucef4\ud4e8\ud130\uc5d0\uc11c Trackeroao \ud14c\uc2a4\ud2b8 \uc2e4\ud589 \uc911", "\u6b63\u5728\u6b64\u7535\u8111\u4e0a\u8fd0\u884c Trackeroao \u7684\u6d4b\u8bd5" } },
    { "done_d", new string[] { "It opens by itself when you start playing.", "Ele abre sozinho quando voc\u00ea come\u00e7ar a jogar.", "Se abre solo cuando empiezas a jugar.", "Il s\u2019ouvre tout seul quand vous commencez \u00e0 jouer.", "Es \u00f6ffnet sich von selbst, wenn du zu spielen beginnst.", "Si apre da solo quando inizi a giocare.", "\u041e\u043d \u043e\u0442\u043a\u0440\u043e\u0435\u0442\u0441\u044f \u0441\u0430\u043c, \u043a\u043e\u0433\u0434\u0430 \u0432\u044b \u043d\u0430\u0447\u043d\u0451\u0442\u0435 \u0438\u0433\u0440\u0430\u0442\u044c.", "Otworzy si\u0119 sam, gdy zaczniesz gra\u0107.", "Oynamaya ba\u015flad\u0131\u011f\u0131n\u0131zda kendili\u011finden a\u00e7\u0131l\u0131r.", "\u30d7\u30ec\u30a4\u3092\u59cb\u3081\u308b\u3068\u81ea\u52d5\u3067\u958b\u304d\u307e\u3059\u3002", "\ud50c\ub808\uc774\ub97c \uc2dc\uc791\ud558\uba74 \uc790\ub3d9\uc73c\ub85c \uc5f4\ub9bd\ub2c8\ub2e4.", "\u5f00\u59cb\u6e38\u620f\u65f6\u4f1a\u81ea\u52a8\u6253\u5f00\u3002" } },
    { "installed", new string[] { "Trackeroao installed", "Trackeroao instalado", "Trackeroao instalado", "Trackeroao install\u00e9", "Trackeroao installiert", "Trackeroao installato", "Trackeroao \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d", "Trackeroao zainstalowany", "Trackeroao kuruldu", "Trackeroao \u3092\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u307e\u3057\u305f", "Trackeroao \uc124\uce58 \uc644\ub8cc", "Trackeroao \u5df2\u5b89\u88c5" } },
    { "unexpected", new string[] { "Unexpected error on line {0}: {1}", "Erro inesperado na linha {0}: {1}", "Error inesperado en la l\u00ednea {0}: {1}", "Erreur inattendue \u00e0 la ligne {0} : {1}", "Unerwarteter Fehler in Zeile {0}: {1}", "Errore imprevisto alla riga {0}: {1}", "\u041d\u0435\u043f\u0440\u0435\u0434\u0432\u0438\u0434\u0435\u043d\u043d\u0430\u044f \u043e\u0448\u0438\u0431\u043a\u0430 \u0432 \u0441\u0442\u0440\u043e\u043a\u0435 {0}: {1}", "Nieoczekiwany b\u0142\u0105d w wierszu {0}: {1}", "{0}. sat\u0131rda beklenmeyen hata: {1}", "{0} \u884c\u76ee\u3067\u4e88\u671f\u3057\u306a\u3044\u30a8\u30e9\u30fc: {1}", "{0}\ubc88\uc9f8 \uc904\uc5d0\uc11c \uc608\uae30\uce58 \uc54a\uc740 \uc624\ub958: {1}", "\u7b2c {0} \u884c\u51fa\u73b0\u610f\u5916\u9519\u8bef\uff1a{1}" } },
    { "r_stop", new string[] { "Closing Trackeroao", "Encerrando o Trackeroao", "Cerrando Trackeroao", "Fermeture de Trackeroao", "Trackeroao wird beendet", "Chiusura di Trackeroao", "\u0417\u0430\u043a\u0440\u044b\u0442\u0438\u0435 Trackeroao", "Zamykanie Trackeroao", "Trackeroao kapat\u0131l\u0131yor", "Trackeroao \u3092\u7d42\u4e86\u3057\u3066\u3044\u307e\u3059", "Trackeroao \uc885\ub8cc \uc911", "\u6b63\u5728\u5173\u95ed Trackeroao" } },
    { "r_stop_d", new string[] { "The background service and the tray icon", "O servi\u00e7o em segundo plano e o \u00edcone da bandeja", "El servicio en segundo plano y el icono de la bandeja", "Le service en arri\u00e8re-plan et l\u2019ic\u00f4ne de la zone de notification", "Der Hintergrunddienst und das Infobereichssymbol", "Il servizio in background e l\u2019icona nell\u2019area di notifica", "\u0424\u043e\u043d\u043e\u0432\u0430\u044f \u0441\u043b\u0443\u0436\u0431\u0430 \u0438 \u0437\u043d\u0430\u0447\u043e\u043a \u0432 \u0442\u0440\u0435\u0435", "Us\u0142uga w tle i ikona w zasobniku", "Arka plan hizmeti ve tepsi simgesi", "\u30d0\u30c3\u30af\u30b0\u30e9\u30a6\u30f3\u30c9 \u30b5\u30fc\u30d3\u30b9\u3068\u30c8\u30ec\u30a4 \u30a2\u30a4\u30b3\u30f3", "\ubc31\uadf8\ub77c\uc6b4\ub4dc \uc11c\ube44\uc2a4\uc640 \ud2b8\ub808\uc774 \uc544\uc774\ucf58", "\u540e\u53f0\u670d\u52a1\u548c\u6258\u76d8\u56fe\u6807" } },
    { "r_shortcut", new string[] { "Removing the shortcut", "Removendo o atalho", "Quitando el acceso directo", "Suppression du raccourci", "Verkn\u00fcpfung wird entfernt", "Rimozione del collegamento", "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u044f\u0440\u043b\u044b\u043a\u0430", "Usuwanie skr\u00f3tu", "K\u0131sayol kald\u0131r\u0131l\u0131yor", "\u30b7\u30e7\u30fc\u30c8\u30ab\u30c3\u30c8\u3092\u524a\u9664\u3057\u3066\u3044\u307e\u3059", "\ubc14\ub85c \uac00\uae30 \uc81c\uac70 \uc911", "\u6b63\u5728\u5220\u9664\u5feb\u6377\u65b9\u5f0f" } },
    { "r_port", new string[] { "Closing the phone port", "Fechando a porta do celular", "Cerrando el puerto del m\u00f3vil", "Fermeture du port du t\u00e9l\u00e9phone", "Handy-Port wird geschlossen", "Chiusura della porta del telefono", "\u0417\u0430\u043a\u0440\u044b\u0442\u0438\u0435 \u043f\u043e\u0440\u0442\u0430 \u0434\u043b\u044f \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430", "Zamykanie portu dla telefonu", "Telefon ba\u011flant\u0131 noktas\u0131 kapat\u0131l\u0131yor", "\u30b9\u30de\u30fc\u30c8\u30d5\u30a9\u30f3\u7528\u306e\u30dd\u30fc\u30c8\u3092\u9589\u3058\u3066\u3044\u307e\u3059", "\ud734\ub300\ud3f0 \ud3ec\ud2b8 \ub2eb\ub294 \uc911", "\u6b63\u5728\u5173\u95ed\u624b\u673a\u7aef\u53e3" } },
    { "r_port_pending", new string[] { "The port 8777 rule is still in Windows Firewall. It only opens that port on your local network.", "A regra da porta 8777 continua no Firewall do Windows. Ela s\u00f3 libera essa porta na rede local.", "La regla del puerto 8777 sigue en el Firewall de Windows. Solo abre ese puerto en la red local.", "La r\u00e8gle du port 8777 reste dans le pare-feu Windows. Elle n\u2019ouvre ce port que sur le r\u00e9seau local.", "Die Regel f\u00fcr Port 8777 bleibt in der Windows-Firewall. Sie \u00f6ffnet den Port nur im lokalen Netz.", "La regola della porta 8777 resta nel Firewall di Windows. Apre quella porta solo sulla rete locale.", "\u041f\u0440\u0430\u0432\u0438\u043b\u043e \u0434\u043b\u044f \u043f\u043e\u0440\u0442\u0430 8777 \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u0432 \u0431\u0440\u0430\u043d\u0434\u043c\u0430\u0443\u044d\u0440\u0435 Windows. \u041e\u043d\u043e \u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u043f\u043e\u0440\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e\u0439 \u0441\u0435\u0442\u0438.", "Regu\u0142a portu 8777 pozostaje w Zaporze systemu Windows. Otwiera ten port tylko w sieci lokalnej.", "8777 ba\u011flant\u0131 noktas\u0131 kural\u0131 Windows G\u00fcvenlik Duvar\u0131\u2019nda duruyor. Bu kural yaln\u0131zca yerel a\u011fda a\u00e7ar.", "\u30dd\u30fc\u30c8 8777 \u306e\u30eb\u30fc\u30eb\u306f Windows \u30d5\u30a1\u30a4\u30a2\u30a6\u30a9\u30fc\u30eb\u306b\u6b8b\u3063\u3066\u3044\u307e\u3059\u3002\u3053\u306e\u30dd\u30fc\u30c8\u306f\u30ed\u30fc\u30ab\u30eb \u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u5185\u3067\u306e\u307f\u958b\u304b\u308c\u307e\u3059\u3002", "\ud3ec\ud2b8 8777 \uaddc\uce59\uc774 Windows \ubc29\ud654\ubcbd\uc5d0 \ub0a8\uc544 \uc788\uc2b5\ub2c8\ub2e4. \uc774 \uaddc\uce59\uc740 \ub85c\uceec \ub124\ud2b8\uc6cc\ud06c\uc5d0\uc11c\ub9cc \ud3ec\ud2b8\ub97c \uc5fd\ub2c8\ub2e4.", "\u7aef\u53e3 8777 \u7684\u89c4\u5219\u4ecd\u5728 Windows \u9632\u706b\u5899\u4e2d\uff0c\u5b83\u53ea\u5728\u672c\u5730\u7f51\u7edc\u5f00\u653e\u8be5\u7aef\u53e3\u3002" } },
    { "r_save", new string[] { "Saving a copy of your progress", "Guardando uma c\u00f3pia do seu progresso", "Guardando una copia de tu progreso", "Sauvegarde d\u2019une copie de votre progression", "Eine Kopie deines Fortschritts wird gesichert", "Salvataggio di una copia dei tuoi progressi", "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435 \u043a\u043e\u043f\u0438\u0438 \u0432\u0430\u0448\u0435\u0433\u043e \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441\u0430", "Zapisywanie kopii post\u0119pu", "\u0130lerlemenizin bir kopyas\u0131 kaydediliyor", "\u9032\u884c\u72b6\u6cc1\u306e\u30b3\u30d4\u30fc\u3092\u4fdd\u5b58\u3057\u3066\u3044\u307e\u3059", "\uc9c4\ud589 \uc0c1\ud669 \uc0ac\ubcf8 \uc800\uc7a5 \uc911", "\u6b63\u5728\u4fdd\u5b58\u4f60\u7684\u8fdb\u5ea6\u526f\u672c" } },
    { "r_saved", new string[] { "Your progress was saved in Documents\\{0}.", "Seu progresso ficou guardado em Documentos\\{0}.", "Tu progreso se guard\u00f3 en Documentos\\{0}.", "Votre progression a \u00e9t\u00e9 enregistr\u00e9e dans Documents\\{0}.", "Dein Fortschritt wurde unter Dokumente\\{0} gesichert.", "I tuoi progressi sono stati salvati in Documenti\\{0}.", "\u0412\u0430\u0448 \u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0432 \u00ab\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b\\{0}\u00bb.", "Post\u0119p zapisano w Dokumenty\\{0}.", "\u0130lerlemeniz Belgeler\\{0} konumuna kaydedildi.", "\u9032\u884c\u72b6\u6cc1\u3092\u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\\{0} \u306b\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002", "\uc9c4\ud589 \uc0c1\ud669\uc774 \ubb38\uc11c\\{0}\uc5d0 \uc800\uc7a5\ub418\uc5c8\uc2b5\ub2c8\ub2e4.", "\u4f60\u7684\u8fdb\u5ea6\u5df2\u4fdd\u5b58\u5230\u201c\u6587\u6863\\{0}\u201d\u3002" } },
    { "r_files", new string[] { "Removing the files", "Removendo os arquivos", "Quitando los archivos", "Suppression des fichiers", "Dateien werden entfernt", "Rimozione dei file", "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0444\u0430\u0439\u043b\u043e\u0432", "Usuwanie plik\u00f3w", "Dosyalar kald\u0131r\u0131l\u0131yor", "\u30d5\u30a1\u30a4\u30eb\u3092\u524a\u9664\u3057\u3066\u3044\u307e\u3059", "\ud30c\uc77c \uc81c\uac70 \uc911", "\u6b63\u5728\u5220\u9664\u6587\u4ef6" } },
    { "r_inuse", new string[] { "Some files were in use and stayed in {0}. You can delete that folder later.", "Alguns arquivos estavam em uso e ficaram em {0}. Pode apagar essa pasta depois.", "Algunos archivos estaban en uso y quedaron en {0}. Puedes borrar esa carpeta despu\u00e9s.", "Certains fichiers \u00e9taient utilis\u00e9s et sont rest\u00e9s dans {0}. Vous pourrez supprimer ce dossier plus tard.", "Einige Dateien waren in Benutzung und liegen noch in {0}. Du kannst den Ordner sp\u00e4ter l\u00f6schen.", "Alcuni file erano in uso e sono rimasti in {0}. Puoi eliminare la cartella in seguito.", "\u041d\u0435\u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u0444\u0430\u0439\u043b\u044b \u0431\u044b\u043b\u0438 \u0437\u0430\u043d\u044f\u0442\u044b \u0438 \u043e\u0441\u0442\u0430\u043b\u0438\u0441\u044c \u0432 {0}. \u042d\u0442\u0443 \u043f\u0430\u043f\u043a\u0443 \u043c\u043e\u0436\u043d\u043e \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u043f\u043e\u0437\u0436\u0435.", "Niekt\u00f3re pliki by\u0142y u\u017cywane i zosta\u0142y w {0}. Mo\u017cesz p\u00f3\u017aniej usun\u0105\u0107 ten folder.", "Baz\u0131 dosyalar kullan\u0131mdayd\u0131 ve {0} i\u00e7inde kald\u0131. Bu klas\u00f6r\u00fc daha sonra silebilirsiniz.", "\u4f7f\u7528\u4e2d\u306e\u30d5\u30a1\u30a4\u30eb\u304c {0} \u306b\u6b8b\u3063\u3066\u3044\u307e\u3059\u3002\u3053\u306e\u30d5\u30a9\u30eb\u30c0\u30fc\u306f\u5f8c\u3067\u524a\u9664\u3067\u304d\u307e\u3059\u3002", "\uc77c\ubd80 \ud30c\uc77c\uc774 \uc0ac\uc6a9 \uc911\uc774\uc5b4\uc11c {0}\uc5d0 \ub0a8\uc558\uc2b5\ub2c8\ub2e4. \ub098\uc911\uc5d0 \uc774 \ud3f4\ub354\ub97c \uc0ad\uc81c\ud574\ub3c4 \ub429\ub2c8\ub2e4.", "\u90e8\u5206\u6587\u4ef6\u6b63\u5728\u4f7f\u7528\uff0c\u4ecd\u7559\u5728 {0} \u4e2d\u3002\u4f60\u53ef\u4ee5\u7a0d\u540e\u5220\u9664\u8be5\u6587\u4ef6\u5939\u3002" } },
    { "removed", new string[] { "Trackeroao removed", "Trackeroao removido", "Trackeroao eliminado", "Trackeroao supprim\u00e9", "Trackeroao entfernt", "Trackeroao rimosso", "Trackeroao \u0443\u0434\u0430\u043b\u0451\u043d", "Trackeroao usuni\u0119ty", "Trackeroao kald\u0131r\u0131ld\u0131", "Trackeroao \u3092\u524a\u9664\u3057\u307e\u3057\u305f", "Trackeroao \uc81c\uac70 \uc644\ub8cc", "Trackeroao \u5df2\u5378\u8f7d" } },
    { "w_ps_fail", new string[] { "Couldn\u2019t start PowerShell: {0}", "N\u00e3o consegui iniciar o PowerShell: {0}", "No se pudo iniciar PowerShell: {0}", "Impossible de d\u00e9marrer PowerShell : {0}", "PowerShell konnte nicht gestartet werden: {0}", "Impossibile avviare PowerShell: {0}", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c PowerShell: {0}", "Nie uda\u0142o si\u0119 uruchomi\u0107 PowerShell: {0}", "PowerShell ba\u015flat\u0131lamad\u0131: {0}", "PowerShell \u3092\u8d77\u52d5\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f: {0}", "PowerShell\uc744 \uc2dc\uc791\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4: {0}", "\u65e0\u6cd5\u542f\u52a8 PowerShell\uff1a{0}" } },
    { "w_stopped_inst", new string[] { "The installation stopped before finishing.", "A instala\u00e7\u00e3o parou antes do fim.", "La instalaci\u00f3n se detuvo antes de terminar.", "L\u2019installation s\u2019est arr\u00eat\u00e9e avant la fin.", "Die Installation wurde vorzeitig beendet.", "L\u2019installazione si \u00e8 interrotta prima della fine.", "\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u0430\u0441\u044c, \u043d\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0432\u0448\u0438\u0441\u044c.", "Instalacja zatrzyma\u0142a si\u0119 przed ko\u0144cem.", "Kurulum bitmeden durdu.", "\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u304c\u9014\u4e2d\u3067\u6b62\u307e\u308a\u307e\u3057\u305f\u3002", "\uc124\uce58\uac00 \ub05d\ub098\uae30 \uc804\uc5d0 \uc911\ub2e8\ub418\uc5c8\uc2b5\ub2c8\ub2e4.", "\u5b89\u88c5\u5728\u5b8c\u6210\u524d\u4e2d\u65ad\u4e86\u3002" } },
    { "w_stopped_rem", new string[] { "The removal stopped before finishing.", "A remo\u00e7\u00e3o parou antes do fim.", "La desinstalaci\u00f3n se detuvo antes de terminar.", "La d\u00e9sinstallation s\u2019est arr\u00eat\u00e9e avant la fin.", "Die Deinstallation wurde vorzeitig beendet.", "La rimozione si \u00e8 interrotta prima della fine.", "\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u043e\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043b\u043e\u0441\u044c, \u043d\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0432\u0448\u0438\u0441\u044c.", "Usuwanie zatrzyma\u0142o si\u0119 przed ko\u0144cem.", "Kald\u0131rma bitmeden durdu.", "\u524a\u9664\u304c\u9014\u4e2d\u3067\u6b62\u307e\u308a\u307e\u3057\u305f\u3002", "\uc81c\uac70\uac00 \ub05d\ub098\uae30 \uc804\uc5d0 \uc911\ub2e8\ub418\uc5c8\uc2b5\ub2c8\ub2e4.", "\u5378\u8f7d\u5728\u5b8c\u6210\u524d\u4e2d\u65ad\u4e86\u3002" } },
    { "w_fail_inst", new string[] { "Couldn\u2019t install", "N\u00e3o foi poss\u00edvel instalar", "No se pudo instalar", "Installation impossible", "Installation nicht m\u00f6glich", "Impossibile installare", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c", "Nie uda\u0142o si\u0119 zainstalowa\u0107", "Kurulamad\u0131", "\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f", "\uc124\uce58\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4", "\u65e0\u6cd5\u5b89\u88c5" } },
    { "w_fail_rem", new string[] { "Couldn\u2019t remove", "N\u00e3o foi poss\u00edvel remover", "No se pudo desinstalar", "D\u00e9sinstallation impossible", "Entfernen nicht m\u00f6glich", "Impossibile rimuovere", "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0434\u0430\u043b\u0438\u0442\u044c", "Nie uda\u0142o si\u0119 usun\u0105\u0107", "Kald\u0131r\u0131lamad\u0131", "\u524a\u9664\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f", "\uc81c\uac70\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4", "\u65e0\u6cd5\u5378\u8f7d" } },
    { "w_open", new string[] { "Open Trackeroao", "Abrir o Trackeroao", "Abrir Trackeroao", "Ouvrir Trackeroao", "Trackeroao \u00f6ffnen", "Apri Trackeroao", "\u041e\u0442\u043a\u0440\u044b\u0442\u044c Trackeroao", "Otw\u00f3rz Trackeroao", "Trackeroao\u2019yu a\u00e7", "Trackeroao \u3092\u958b\u304f", "Trackeroao \uc5f4\uae30", "\u6253\u5f00 Trackeroao" } },
    { "w_close", new string[] { "Close", "Fechar", "Cerrar", "Fermer", "Schlie\u00dfen", "Chiudi", "\u0417\u0430\u043a\u0440\u044b\u0442\u044c", "Zamknij", "Kapat", "\u9589\u3058\u308b", "\ub2eb\uae30", "\u5173\u95ed" } },
    { "w_log", new string[] { "View log", "Ver registro", "Ver registro", "Voir le journal", "Protokoll anzeigen", "Vedi registro", "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0436\u0443\u0440\u043d\u0430\u043b", "Poka\u017c dziennik", "G\u00fcnl\u00fc\u011f\u00fc g\u00f6ster", "\u30ed\u30b0\u3092\u8868\u793a", "\ub85c\uadf8 \ubcf4\uae30", "\u67e5\u770b\u65e5\u5fd7" } },
  };
  static readonly int indice = Escolher();

  static int Escolher() {
    string escolhido = null;
    try {
      string arq = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "trackeroao\\sync\\idioma.json");
      if (File.Exists(arq)) {
        Match m = Regex.Match(File.ReadAllText(arq), "\"idioma\"\\s*:\\s*\"([^\"]+)\"");
        if (m.Success) escolhido = m.Groups[1].Value;
      }
    } catch { }
    if (escolhido == null) escolhido = CultureInfo.CurrentUICulture.Name;
    int i = Array.IndexOf(Idiomas, escolhido);
    if (i >= 0) return i;
    string b = escolhido.Split('-')[0].ToLowerInvariant();
    if (b == "pt") return 1;
    if (b == "zh") return 11;
    i = Array.IndexOf(Idiomas, b);
    return i >= 0 ? i : 0;
  }

  internal static string T(string id, params object[] args) {
    string[] modelo;
    if (!Tabela.TryGetValue(id, out modelo)) return id;
    return args.Length == 0 ? modelo[indice] : string.Format(modelo[indice], args);
  }

  internal static string DoScript(string s) {
    if (s == null || !s.StartsWith("#")) return s;
    int barra = s.IndexOf('|');
    string id = barra < 0 ? s.Substring(1) : s.Substring(1, barra - 1);
    string[] modelo;
    if (!Tabela.TryGetValue(id, out modelo)) return s;
    int n = 0;
    foreach (Match m in Regex.Matches(modelo[indice], "\\{(\\d)\\}")) n = Math.Max(n, int.Parse(m.Groups[1].Value) + 1);
    string[] partes = barra < 0 ? new string[0] : s.Substring(barra + 1).Split(new char[] { '|' }, Math.Max(1, n));
    object[] a = new object[n];
    for (int k = 0; k < n; k++) a[k] = k < partes.Length ? partes[k] : "";
    return string.Format(modelo[indice], a);
  }
}

static class Programa {
  const string Instalar = "$b64Instalar";
  const string Desinstalar = "$b64Desinstalar";

  [STAThread]
  static int Main(string[] args) {
    string proprio = Application.ExecutablePath;
    string pastaPropria = Path.GetDirectoryName(proprio);
    bool desinstalando = Path.GetFileName(proprio).ToLowerInvariant().Contains("desinstal");
    bool elevado = false, semElevar = false, fechar = false, soJanela = false;
    string usuario = null, destino = null, exeOriginal = null, ensaio = null;
    StringBuilder repassar = new StringBuilder();
    foreach (string a in args) {
      if (a == "/desinstalar") desinstalando = true;
      else if (a == "/elevado") elevado = true;
      else if (a == "/sem-elevar") semElevar = true;
      else if (a == "/fechar") fechar = true;
      else if (a.StartsWith("/usuario=")) usuario = a.Substring(9);
      else if (a.StartsWith("/destino=")) destino = a.Substring(9);
      else if (a.StartsWith("/exe=")) exeOriginal = a.Substring(5);
      else if (a.StartsWith("/ensaio=")) ensaio = a.Substring(8);
      else if (a == "/so-janela") soJanela = true;
      else repassar.Append(" ").Append(Aspas(a));
    }
    if (usuario == null) usuario = UsuarioAtual();
    if (exeOriginal == null) exeOriginal = proprio;
    Limpar(proprio);
    if (soJanela) return TrocarJanela(destino);
    if (desinstalando && destino == null && File.Exists(Path.Combine(pastaPropria, "sync\\main.js"))) {
      destino = pastaPropria;
    }

    /*
     * Desinstalando de dentro da pasta, o .exe se copia para a pasta
     * temporaria e passa a vez para a copia. A janela precisa ficar aberta ate
     * o fim, e um .exe aberto nao pode ser apagado: rodando da pasta, ela
     * nunca sairia inteira.
     */
    if (desinstalando && ensaio == null && destino != null && Dentro(proprio, destino)) {
      string copia = Path.Combine(Path.GetTempPath(),
        "trackeroao-desinstalador-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
      File.Copy(proprio, copia, true);
      string resto = "/desinstalar " + Aspas("/destino=" + destino) + " " + Aspas("/usuario=" + usuario) + repassar;
      Relancar(copia, resto, EhAdmin());
      return 0;
    }

    /*
     * Administrador, uma vez so, pedido pelo proprio .exe.
     *
     * O PowerShell ja nao pede nada: se pedisse, abriria uma segunda janela de
     * console, que e o que esta versao existe para evitar. O .exe se relanca
     * elevado e a copia elevada mostra a janela; recusado o pedido, segue
     * aqui mesmo, sem administrador, e o script deixa a porta 8777 como
     * pendencia. Quem pediu vai junto (/usuario), porque elevar pode trocar
     * de conta.
     */
    if (!desinstalando && ensaio == null && !elevado && !semElevar && !EhAdmin()) {
      string resto = Aspas("/usuario=" + usuario) + " " + Aspas("/exe=" + exeOriginal) + repassar;
      if (destino != null) resto += " " + Aspas("/destino=" + destino);
      try {
        ProcessStartInfo psi = new ProcessStartInfo(proprio, resto + " /elevado");
        psi.UseShellExecute = true;
        psi.Verb = "runas";
        Process.Start(psi);
        return 0;
      } catch (Win32Exception) {
        semElevar = true;
      }
    }

    string texto;
    if (ensaio != null) {
      texto = File.ReadAllText(ensaio, Encoding.UTF8);
    } else if (desinstalando) {
      texto = null;
      string local = destino == null ? null : Path.Combine(destino, "instalador\\desinstalar.ps1");
      // O desinstalar.ps1 da propria instalacao e o da versao instalada. So
      // serve se ja souber falar com esta janela; senao, o embutido.
      if (local != null && File.Exists(local)) {
        string t = File.ReadAllText(local, Encoding.UTF8);
        if (t.Contains("TRACKEROAO_GUI")) texto = t;
      }
      if (texto == null) texto = Encoding.UTF8.GetString(Convert.FromBase64String(Desinstalar));
    } else {
      texto = Encoding.UTF8.GetString(Convert.FromBase64String(Instalar));
    }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Janela j = new Janela(desinstalando, fechar);
    j.Preparar(texto, usuario, destino, exeOriginal, semElevar || !EhAdmin(), repassar.ToString());
    Application.Run(j);
    int codigo = j.Codigo;
    // Deu certo: o registro nao serve a mais ninguem. So fica quando falha,
    // para o botao "Ver registro" (e no ensaio, que a Action le).
    if (codigo == 0 && ensaio == null) j.ApagarRegistro();
    // A copia do desinstalador na pasta temporaria nao pode se apagar
    // enquanto roda; o Windows a apaga no proximo reinicio (precisa de
    // administrador; sem ele, a proxima execucao do instalador apaga).
    if (desinstalando && Path.GetFileName(proprio).StartsWith("trackeroao-desinstalador-")) {
      MoveFileEx(proprio, null, 4);
    }
    return codigo;
  }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool MoveFileEx(string de, string para, int opcoes);

  /*
   * /so-janela /destino=<instalacao>: troca so a janela do Trackeroao
   * (<instalacao>\app) pela que vem dentro deste .exe, sem janela nenhuma e
   * sem rodar script. E o que a atualizacao automatica chama quando a versao
   * nova traz uma janela nova: o codigo ela copia do zip, e a janela, que e
   * binaria, vem daqui. Com a janela aberta nada e trocado (sai com 3), para
   * nao fecha-la debaixo de quem esta olhando; a proxima conferencia tenta
   * de novo.
   */
  static bool JanelaAberta() {
    System.Threading.Mutex m;
    if (!System.Threading.Mutex.TryOpenExisting("Local\\TrackeroaoJanela", out m)) return false;
    m.Close();
    return true;
  }

  static int TrocarJanela(string destino) {
    if (destino == null || !File.Exists(Path.Combine(destino, "sync\\main.js"))) return 2;
    string app = Path.Combine(destino, "app");
    /*
     * Janela aberta: ela e fechada pelo mesmo sinal do "Fechar" da bandeja,
     * a pasta e trocada, e ela abre de novo, ja na versao nova. Assim a
     * atualizacao nao depende de ninguem fechar nada. Se nao fechar a tempo,
     * nada e trocado e a proxima conferencia tenta de novo.
     */
    bool estavaAberta = JanelaAberta();
    if (estavaAberta) {
      System.Threading.EventWaitHandle sinal;
      if (System.Threading.EventWaitHandle.TryOpenExisting("Local\\TrackeroaoFechar", out sinal)) { sinal.Set(); sinal.Close(); }
      for (int i = 0; i < 40 && JanelaAberta(); i++) System.Threading.Thread.Sleep(500);
      if (JanelaAberta()) return 3;
      System.Threading.Thread.Sleep(1000);
    }
    // O resto do mesmo .exe e o icone da bandeja, que o servico acende de
    // novo depois da troca: sai agora para largar o arquivo.
    foreach (Process p in Process.GetProcessesByName("Trackeroao")) {
      try {
        if (p.MainModule.FileName.StartsWith(app, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
      } catch { }
    }
    string novo = app + "-novo";
    try {
      if (Directory.Exists(novo)) Directory.Delete(novo, true);
      if (!ExtrairJanela(novo)) return 4;
      if (Directory.Exists(app)) Directory.Delete(app, true);
      Directory.Move(novo, app);
      // Pelo shell: a janela nao herda a saida de quem chamou o instalador,
      // e o servico nao fica esperando por ela.
      AcertarAtalhos(app);
      if (estavaAberta) {
        try { Process.Start(new ProcessStartInfo(Path.Combine(app, "Trackeroao.exe")) { UseShellExecute = true }); } catch { }
      }
      return 0;
    } catch {
      try { Directory.Delete(novo, true); } catch { }
      return 5;
    }
  }

  /*
   * Os atalhos da janela (area de trabalho e menu Iniciar) passam a usar o
   * trackeroao.ico ao lado do .exe. O Windows guarda o icone de cada caminho
   * em cache; apontar o atalho para o .exe trocado continuaria mostrando o
   * icone antigo. Com o caminho novo e o aviso ao shell, ele le de novo.
   */
  [DllImport("shell32.dll")]
  static extern void SHChangeNotify(int evento, uint opcoes, IntPtr a, IntPtr b);

  static void AcertarAtalhos(string app) {
    string ico = Path.Combine(app, "trackeroao.ico");
    string exe = Path.Combine(app, "Trackeroao.exe");
    if (!File.Exists(ico)) return;
    try {
      Type tipo = Type.GetTypeFromProgID("WScript.Shell");
      object ws = Activator.CreateInstance(tipo);
      string[] pastas = {
        Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Environment.GetFolderPath(Environment.SpecialFolder.Programs),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
          "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"),
      };
      foreach (string pasta in pastas) {
        if (String.IsNullOrEmpty(pasta) || !Directory.Exists(pasta)) continue;
        foreach (string lnk in Directory.GetFiles(pasta, "Trackeroao*.lnk")) {
          try {
            object at = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, ws, new object[] { lnk });
            Type t = at.GetType();
            string alvo = (string)t.InvokeMember("TargetPath", BindingFlags.GetProperty, null, at, null);
            if (!String.Equals(alvo, exe, StringComparison.OrdinalIgnoreCase)) continue;
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, at, new object[] { ico + ",0" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, at, null);
          } catch { }
        }
      }
    } catch { }
    // SHCNE_ASSOCCHANGED: o shell recarrega os icones.
    try { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); } catch { }
  }

  // Os arquivos da janela, dos recursos deste .exe, mais a versao dela.
  internal static bool ExtrairJanela(string pasta) {
    bool algum = false;
    Assembly eu = Assembly.GetExecutingAssembly();
    foreach (string r in eu.GetManifestResourceNames()) {
      if (!r.StartsWith("app/")) continue;
      if (!algum) { Directory.CreateDirectory(pasta); algum = true; }
      using (Stream de = eu.GetManifestResourceStream(r))
      using (FileStream para = File.Create(Path.Combine(pasta, r.Substring(4)))) de.CopyTo(para);
    }
    if (algum) File.WriteAllText(Path.Combine(pasta, "versao.txt"), eu.GetName().Version.ToString());
    return algum;
  }

  /*
   * Nada se acumula entre uma execucao e outra. Sobras de execucoes que nao
   * terminaram (o PC desligado no meio, o processo morto) saem aqui: as
   * pastas de trabalho da janela e as copias antigas do desinstalador. Uma
   * pasta ainda em uso por outra janela nao pode ser renomeada, e e assim que
   * ela e reconhecida e deixada em paz.
   */
  static void Limpar(string proprio) {
    string temp = Path.GetTempPath();
    try {
      foreach (string d in Directory.GetDirectories(temp, "trackeroao-*")) {
        if (Path.GetFileName(d).Length != 43) continue;
        string fora = d + "-apagando";
        try { Directory.Move(d, fora); } catch { continue; }
        try { Directory.Delete(fora, true); } catch { }
      }
      foreach (string a in Directory.GetFiles(temp, "trackeroao-desinstalador-*.exe")) {
        if (string.Equals(Path.GetFullPath(a), Path.GetFullPath(proprio), StringComparison.OrdinalIgnoreCase)) continue;
        try { File.Delete(a); } catch { }
      }
      foreach (string d in Directory.GetDirectories(temp, "trackeroao-*-apagando")) {
        try { Directory.Delete(d, true); } catch { }
      }
    } catch { }
  }

  static void Relancar(string exe, string resto, bool jaAdmin) {
    if (!jaAdmin) {
      try {
        ProcessStartInfo psi = new ProcessStartInfo(exe, resto + " /elevado");
        psi.UseShellExecute = true;
        psi.Verb = "runas";
        Process.Start(psi);
        return;
      } catch (Win32Exception) { }
      Process.Start(new ProcessStartInfo(exe, resto + " /sem-elevar") { UseShellExecute = true });
      return;
    }
    Process.Start(new ProcessStartInfo(exe, resto + " /elevado") { UseShellExecute = true });
  }

  static bool Dentro(string arquivo, string pasta) {
    string a = Path.GetFullPath(arquivo).TrimEnd('\\') + "\\";
    string p = Path.GetFullPath(pasta).TrimEnd('\\') + "\\";
    return a.StartsWith(p, StringComparison.OrdinalIgnoreCase);
  }

  static bool EhAdmin() {
    return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
  }

  static string UsuarioAtual() {
    return Environment.UserDomainName + "\\" + Environment.UserName;
  }

  internal static string Aspas(string a) {
    return a.IndexOf(' ') >= 0 ? "\"" + a + "\"" : a;
  }
}

/*
 * A janela: uma caixa pequena, escura, com o nome, o passo atual, uma barra
 * de progresso e uma linha de detalhe. Desenhada a mao, e nao com os
 * controles padrao do Windows, para ser a mesma em qualquer versao dele.
 *
 * O script fala com ela por linhas que comecam com @@ na saida padrao:
 *   @@PASSO <porcento> <texto>   o que esta sendo feito, e ate onde a barra vai
 *   @@DETALHE <texto>            a linha pequena embaixo da barra
 *   @@PENDENCIA <texto>          o que ficou por fazer, mostrado no fim
 *   @@ERRO <texto>               o motivo de ter parado
 *   @@PRONTO <texto>             a frase final
 * Todo o resto vai so para o registro, em %TEMP%.
 */
class Janela : Form {
  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int valor, int tamanho);

  enum Modo { Trabalhando, Pronto, Erro }

  readonly bool desinstalando, fechar;
  Modo modo = Modo.Trabalhando;
  string passo, detalhe = "";
  readonly List<string> pendencias = new List<string>();
  string erro, fraseFinal;
  // Onde o script instalou a janela (@@APP), para o botao "Abrir".
  string janelaInstalada;
  // A primeira linha que o PowerShell escreveu como erro: se o script parar
  // sem dizer o motivo, e ela que a janela mostra.
  string primeiroErro;
  float alvo = 2f, atual = 0f, brilho = 0f;
  readonly Timer relogio = new Timer();
  float esc = 1f;
  string registro, pastaTemp;
  public int Codigo = 1;
  Process ps;
  // Fotos da janela, para a Action mostrar como ela ficou (TRACKEROAO_FOTO).
  readonly string foto = Environment.GetEnvironmentVariable("TRACKEROAO_FOTO");
  bool fotoTirada;

  Rectangle btPrimario, btSecundario, btFechar;
  string rotPrimario, rotSecundario;
  int sobre = 0;

  static readonly Color Fundo = Color.FromArgb(16, 18, 23);
  static readonly Color Borda = Color.FromArgb(38, 42, 52);
  static readonly Color Texto = Color.FromArgb(242, 244, 248);
  static readonly Color Apagado = Color.FromArgb(138, 144, 160);
  static readonly Color Trilho = Color.FromArgb(34, 38, 47);
  static readonly Color Sinal = Color.FromArgb(216, 255, 60);
  static readonly Color Aviso = Color.FromArgb(255, 196, 92);
  static readonly Color Falha = Color.FromArgb(255, 122, 122);

  Font fMarca, fPasso, fDetalhe, fBotao;

  public Janela(bool desinstalando, bool fechar) {
    this.desinstalando = desinstalando;
    this.fechar = fechar;
    passo = Textos.T(desinstalando ? "prep_rem" : "prep_inst");
    Text = "Trackeroao";
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.CenterScreen;
    ShowInTaskbar = true;
    BackColor = Fundo;
    DoubleBuffered = true;
    SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

    using (Graphics g = CreateGraphics()) esc = g.DpiX / 96f;
    string familia = "Segoe UI";
    fMarca = new Font(familia, 12.5f, FontStyle.Bold);
    fPasso = new Font(familia + " Semibold", 11f);
    fDetalhe = new Font(familia, 9f);
    fBotao = new Font(familia + " Semibold", 9.5f);
    ClientSize = new Size(S(440), S(168));

    relogio.Interval = 16;
    relogio.Tick += delegate {
      atual += (alvo - atual) * 0.07f;
      if (Math.Abs(alvo - atual) < 0.05f) atual = alvo;
      brilho = (brilho + 0.006f) % 1.6f;
      Invalidate();
      if (foto != null && !fotoTirada && modo == Modo.Trabalhando && alvo >= 40f && Math.Abs(alvo - atual) < 0.5f) {
        fotoTirada = true;
        Fotografar("trabalhando");
      }
    };
    relogio.Start();
    FormClosing += delegate(object s, FormClosingEventArgs e) {
      if (modo == Modo.Trabalhando && e.CloseReason == CloseReason.UserClosing) e.Cancel = true;
    };
  }

  int S(float px) { return (int)Math.Round(px * esc); }

  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ClassStyle |= 0x20000; // sombra, para o Windows 10
      return cp;
    }
  }

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    // Cantos arredondados do Windows 11. No 10 a chamada nao faz nada.
    try { int redondo = 2; DwmSetWindowAttribute(Handle, 33, ref redondo, 4); } catch { }
  }

  public void Preparar(string script, string usuario, string destino, string exe, bool semAdmin, string resto) {
    string nome = desinstalando ? "desinstalar" : "instalar";
    registro = Path.Combine(Path.GetTempPath(), "trackeroao-" + nome + ".log");
    try { File.WriteAllText(registro, "", Encoding.UTF8); } catch { }
    pastaTemp = Path.Combine(Path.GetTempPath(), "trackeroao-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(pastaTemp);
    string alvoPs = Path.Combine(pastaTemp, nome + ".ps1");
    File.WriteAllText(alvoPs, script, new UTF8Encoding(true));
    // A janela do Trackeroao vai junto, dentro deste .exe; o script a copia.
    string pastaApp = Path.Combine(pastaTemp, "app");
    if (!Programa.ExtrairJanela(pastaApp)) pastaApp = null;

    ProcessStartInfo psi = new ProcessStartInfo("powershell.exe");
    psi.Arguments = "-NoProfile -NonInteractive -File \"" + alvoPs + "\"" + (desinstalando ? " -GuardarProgresso" : "") + resto;
    /*
     * A politica de execucao vai pelo ambiente, e nao por -ExecutionPolicy
     * Bypass na linha de comando: o flag na linha e metade do que a
     * heuristica do Defender procura (ver o teste 15 do selftest). A variavel
     * e lida pelo PowerShell no arranque e faz o mesmo efeito. E preciso
     * porque em Windows recem-instalado a politica padrao e Restricted.
     */
    psi.EnvironmentVariables["PSExecutionPolicyPreference"] = "Bypass";
    psi.EnvironmentVariables["TRACKEROAO_GUI"] = "1";
    psi.EnvironmentVariables["TRACKEROAO_EXE"] = exe;
    psi.EnvironmentVariables["TRACKEROAO_USUARIO"] = usuario;
    if (pastaApp != null) psi.EnvironmentVariables["TRACKEROAO_APP"] = pastaApp;
    if (destino != null) psi.EnvironmentVariables["TRACKEROAO_DESTINO"] = destino;
    if (semAdmin) psi.EnvironmentVariables["TRACKEROAO_SEM_ELEVAR"] = "1";
    psi.UseShellExecute = false;
    psi.CreateNoWindow = true;
    psi.WorkingDirectory = pastaTemp;
    psi.RedirectStandardOutput = true;
    psi.RedirectStandardError = true;
    psi.StandardOutputEncoding = Encoding.UTF8;
    psi.StandardErrorEncoding = Encoding.UTF8;

    ps = new Process();
    ps.StartInfo = psi;
    ps.EnableRaisingEvents = true;
    ps.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) {
      if (e.Data == null) fimSaida.Set(); else Chegou(e.Data, false);
    };
    ps.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) {
      if (e.Data == null) fimErro.Set(); else Chegou(e.Data, true);
    };
    ps.Exited += delegate { BeginInvokeSeguro(new Action(Terminou)); };
    Shown += delegate {
      try {
        ps.Start();
        ps.BeginOutputReadLine();
        ps.BeginErrorReadLine();
      } catch (Exception ex) {
        erro = Textos.T("w_ps_fail", ex.Message);
        Registrar(erro);
        Mudar(Modo.Erro);
      }
    };
  }

  void BeginInvokeSeguro(Delegate d) {
    try { if (IsHandleCreated && !IsDisposed) BeginInvoke(d); } catch { }
  }

  internal void ApagarRegistro() {
    try { File.Delete(registro); } catch { }
  }

  void Registrar(string linha) {
    try { File.AppendAllText(registro, linha + Environment.NewLine, Encoding.UTF8); } catch { }
  }

  // As linhas chegam em outra thread. O estado e gravado ali mesmo, para que
  // o fim (Terminou) sempre veja tudo o que o script disse; a tela so e
  // avisada para redesenhar.
  readonly object trava = new object();
  readonly System.Threading.ManualResetEvent fimSaida = new System.Threading.ManualResetEvent(false);
  readonly System.Threading.ManualResetEvent fimErro = new System.Threading.ManualResetEvent(false);

  void Chegou(string linha, bool doErro) {
    Registrar((doErro ? "! " : "") + linha);
    if (doErro && linha.Trim() != "") {
      lock (trava) { if (primeiroErro == null) primeiroErro = linha.Trim(); }
    }
    if (doErro || !linha.StartsWith("@@")) return;
    int espaco = linha.IndexOf(' ');
    string tipo = espaco < 0 ? linha.Substring(2) : linha.Substring(2, espaco - 2);
    string resto = espaco < 0 ? "" : linha.Substring(espaco + 1).Trim();
    lock (trava) {
      if (tipo == "PASSO") {
        int sp = resto.IndexOf(' ');
        float p;
        if (sp > 0 && float.TryParse(resto.Substring(0, sp), System.Globalization.NumberStyles.Float,
                                      System.Globalization.CultureInfo.InvariantCulture, out p)) {
          alvo = Math.Max(alvo, Math.Min(100f, p));
          passo = Textos.DoScript(resto.Substring(sp + 1));
        } else passo = Textos.DoScript(resto);
        detalhe = "";
      } else if (tipo == "DETALHE") detalhe = Textos.DoScript(resto);
      else if (tipo == "PENDENCIA") pendencias.Add(Textos.DoScript(resto));
      else if (tipo == "ERRO") erro = Textos.DoScript(resto);
      else if (tipo == "PRONTO") fraseFinal = Textos.DoScript(resto);
      else if (tipo == "APP") janelaInstalada = resto;
    }
    BeginInvokeSeguro(new Action(Invalidate));
  }

  void Terminou() {
    int codigo = 1;
    // Espera a saida acabar de chegar: o processo pode ter saido com linhas
    // ainda a caminho, e a ultima delas e justamente a do fim.
    fimSaida.WaitOne(5000);
    fimErro.WaitOne(2000);
    try { codigo = ps.ExitCode; } catch { }
    try { Directory.Delete(pastaTemp, true); } catch { }
    lock (trava) {
      if (codigo == 0 && erro == null && fraseFinal != null) Mudar(Modo.Pronto);
      else {
        if (erro == null) erro = Textos.T(desinstalando ? "w_stopped_rem" : "w_stopped_inst")
                               + (primeiroErro != null ? " " + primeiroErro : "");
        Mudar(Modo.Erro);
      }
    }
  }

  void Mudar(Modo m) {
    modo = m;
    Codigo = m == Modo.Pronto ? 0 : 1;
    if (m == Modo.Pronto) { alvo = 100f; passo = fraseFinal; }
    else passo = Textos.T(desinstalando ? "w_fail_rem" : "w_fail_inst");
    if (m == Modo.Pronto && !desinstalando) { rotPrimario = Textos.T("w_open"); rotSecundario = Textos.T("w_close"); }
    else if (m == Modo.Pronto) { rotPrimario = Textos.T("w_close"); rotSecundario = null; }
    else { rotPrimario = Textos.T("w_close"); rotSecundario = Textos.T("w_log"); }

    int extra = 0;
    using (Graphics g = CreateGraphics()) {
      foreach (string t in LinhasFinais()) {
        extra += (int)Math.Ceiling(g.MeasureString(t, fDetalhe, ClientSize.Width - S(56)).Height) + S(4);
      }
    }
    ClientSize = new Size(ClientSize.Width, S(168) + S(44) + Math.Max(0, extra - S(18)));
    Invalidate();
    if (foto != null) { atual = alvo; Fotografar(m == Modo.Pronto ? "pronto" : "erro"); }
    if (fechar) { relogio.Stop(); Close(); }
  }

  void Fotografar(string nome) {
    try {
      using (Bitmap b = new Bitmap(ClientSize.Width, ClientSize.Height)) {
        DrawToBitmap(b, new Rectangle(Point.Empty, ClientSize));
        b.Save(Path.Combine(foto, nome + ".png"), System.Drawing.Imaging.ImageFormat.Png);
      }
    } catch { }
  }

  List<string> LinhasFinais() {
    List<string> r = new List<string>();
    if (modo == Modo.Erro) r.Add(erro);
    else if (modo == Modo.Pronto) {
      if (detalhe != "" && pendencias.Count == 0) r.Add(detalhe);
      foreach (string p in pendencias) r.Add(p);
    }
    return r;
  }

  protected override void OnPaint(PaintEventArgs e) {
    lock (trava) Pintar(e.Graphics);
  }

  void Pintar(Graphics g) {
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
    int w = ClientSize.Width, h = ClientSize.Height;
    using (Pen p = new Pen(Borda)) g.DrawRectangle(p, 0, 0, w - 1, h - 1);

    // O nome, com o "oao" no verde do sinal.
    float x = S(28), y = S(24);
    TextRenderer.DrawText(g, "Tracker", fMarca, new Point((int)x, (int)y), Texto, TextFormatFlags.NoPadding);
    Size t1 = TextRenderer.MeasureText(g, "Tracker", fMarca, Size.Empty, TextFormatFlags.NoPadding);
    TextRenderer.DrawText(g, "oao", fMarca, new Point((int)x + t1.Width, (int)y), Sinal, TextFormatFlags.NoPadding);

    if (modo != Modo.Trabalhando) {
      btFechar = new Rectangle(w - S(44), S(18), S(26), S(26));
      Color cx = sobre == 3 ? Texto : Apagado;
      TextRenderer.DrawText(g, "\u2715", fDetalhe, btFechar, cx, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
    } else btFechar = Rectangle.Empty;

    // O passo.
    Rectangle rPasso = new Rectangle(S(28), S(64), w - S(56), S(26));
    TextRenderer.DrawText(g, passo ?? "", fPasso, rPasso, Texto,
      TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);

    // A barra.
    int bx = S(28), by = S(102), bw = w - S(56) - S(44), bh = S(6);
    using (GraphicsPath trilho = Pilula(bx, by, bw, bh))
    using (SolidBrush b = new SolidBrush(Trilho)) g.FillPath(b, trilho);
    float fracao = Math.Max(0f, Math.Min(1f, atual / 100f));
    int fw = Math.Max(bh, (int)(bw * fracao));
    Color cor = modo == Modo.Erro ? Falha : Sinal;
    using (GraphicsPath cheio = Pilula(bx, by, fw, bh)) {
      using (SolidBrush b = new SolidBrush(cor)) g.FillPath(b, cheio);
      if (modo == Modo.Trabalhando) {
        // Um brilho que corre sobre o que ja encheu: mostra que ha trabalho
        // mesmo quando um passo demora e a barra nao anda.
        float cx0 = bx + (brilho - 0.3f) * fw;
        RectangleF faixa = new RectangleF(cx0, by, S(60), bh);
        using (LinearGradientBrush lg = new LinearGradientBrush(new RectangleF(faixa.X - 1, faixa.Y, faixa.Width + 2, faixa.Height),
               Color.FromArgb(0, 255, 255, 255), Color.FromArgb(0, 255, 255, 255), 0f)) {
          ColorBlend cb = new ColorBlend();
          cb.Colors = new Color[] { Color.FromArgb(0, 255, 255, 255), Color.FromArgb(150, 255, 255, 255), Color.FromArgb(0, 255, 255, 255) };
          cb.Positions = new float[] { 0f, 0.5f, 1f };
          lg.InterpolationColors = cb;
          Region antes = g.Clip;
          g.SetClip(cheio, CombineMode.Intersect);
          g.FillRectangle(lg, faixa);
          g.Clip = antes;
        }
      }
    }
    string pct = ((int)Math.Round(atual)).ToString() + "%";
    TextRenderer.DrawText(g, pct, fDetalhe, new Rectangle(bx + bw, by - S(8), S(44), S(22)), Apagado,
      TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);

    // O detalhe, ou o que ficou para o fim.
    int dy = S(122);
    if (modo == Modo.Trabalhando) {
      TextRenderer.DrawText(g, detalhe, fDetalhe, new Rectangle(S(28), dy, w - S(56), S(20)), Apagado,
        TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
    } else {
      foreach (string linha in LinhasFinais()) {
        Color c = modo == Modo.Erro ? Falha : (pendencias.Contains(linha) ? Aviso : Apagado);
        Rectangle r = new Rectangle(S(28), dy, w - S(56), h);
        Size m = TextRenderer.MeasureText(g, linha, fDetalhe, new Size(r.Width, 0), TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, linha, fDetalhe, r, c, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
        dy += m.Height + S(4);
      }
      // Os botoes, no canto de baixo.
      Size tp = TextRenderer.MeasureText(g, rotPrimario, fBotao);
      btPrimario = new Rectangle(w - S(28) - tp.Width - S(28), h - S(28) - S(34), tp.Width + S(28), S(34));
      using (GraphicsPath pp = Pilula(btPrimario.X, btPrimario.Y, btPrimario.Width, btPrimario.Height))
      using (SolidBrush b = new SolidBrush(sobre == 1 ? Color.FromArgb(230, 255, 120) : Sinal)) g.FillPath(b, pp);
      TextRenderer.DrawText(g, rotPrimario, fBotao, btPrimario, Color.FromArgb(12, 15, 2),
        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
      if (rotSecundario != null) {
        Size ts = TextRenderer.MeasureText(g, rotSecundario, fBotao);
        btSecundario = new Rectangle(btPrimario.X - S(10) - ts.Width - S(20), btPrimario.Y, ts.Width + S(20), btPrimario.Height);
        TextRenderer.DrawText(g, rotSecundario, fBotao, btSecundario, sobre == 2 ? Texto : Apagado,
          TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
      } else btSecundario = Rectangle.Empty;
    }
  }

  static GraphicsPath Pilula(float x, float y, float w, float h) {
    GraphicsPath p = new GraphicsPath();
    float d = Math.Min(h, w);
    if (w <= d) { p.AddEllipse(x, y, d, d); return p; }
    p.AddArc(x, y, d, d, 90, 180);
    p.AddArc(x + w - d, y, d, d, 270, 180);
    p.CloseFigure();
    return p;
  }

  protected override void OnMouseMove(MouseEventArgs e) {
    base.OnMouseMove(e);
    int antes = sobre;
    sobre = btPrimario.Contains(e.Location) ? 1 : btSecundario.Contains(e.Location) ? 2 : btFechar.Contains(e.Location) ? 3 : 0;
    Cursor = sobre != 0 ? Cursors.Hand : Cursors.Default;
    if (antes != sobre) Invalidate();
  }

  protected override void OnMouseDown(MouseEventArgs e) {
    base.OnMouseDown(e);
    if (modo != Modo.Trabalhando) {
      if (btPrimario.Contains(e.Location)) { Primario(); return; }
      if (btSecundario.Contains(e.Location)) { Secundario(); return; }
      if (btFechar.Contains(e.Location)) { Close(); return; }
    }
    // Arrastar a janela por qualquer ponto que nao seja botao.
    if (e.Button == MouseButtons.Left) {
      Capture = false;
      Message m = Message.Create(Handle, 0xA1, new IntPtr(2), IntPtr.Zero);
      WndProc(ref m);
    }
  }

  protected override void OnKeyDown(KeyEventArgs e) {
    base.OnKeyDown(e);
    if (modo == Modo.Trabalhando) return;
    if (e.KeyCode == Keys.Enter) Primario();
    else if (e.KeyCode == Keys.Escape) Close();
  }

  void Primario() {
    if (modo == Modo.Pronto && !desinstalando) {
      try {
        // Pelo explorer, a janela abre como a pessoa, e nao elevada como este
        // instalador.
        if (janelaInstalada != null && File.Exists(janelaInstalada)) Process.Start("explorer.exe", Programa.Aspas(janelaInstalada));
        else Process.Start(new ProcessStartInfo("http://localhost:8777/") { UseShellExecute = true });
      } catch { }
    }
    Close();
  }

  void Secundario() {
    if (modo == Modo.Erro) {
      try { Process.Start("notepad.exe", Programa.Aspas(registro)); } catch { }
      return;
    }
    Close();
  }
}
"@

$recursos = @()
if ($App) {
  foreach ($f in Get-ChildItem $App -File) { $recursos += "/resource:$($f.FullName),app/$($f.Name)" }
  if (-not $recursos) { throw "a pasta da janela esta vazia: $App" }
}
$tmpCs = Join-Path $tmp 'trackeroao.cs'
Set-Content -Path $tmpCs -Value $cs -Encoding UTF8

& $csc.FullName /nologo /target:winexe /platform:anycpu /optimize+ "/out:$exe" `
  "/win32icon:$icone" "/win32manifest:$manifesto" `
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll @recursos $tmpCs
$codigo = $LASTEXITCODE
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

if ($codigo -ne 0) { throw "csc falhou com codigo $codigo" }
$kb = [math]::Round((Get-Item $exe).Length / 1KB, 1)
Write-Host "gerado: $exe ($kb KB, versao $versaoNum)" -ForegroundColor Green

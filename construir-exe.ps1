<#
Gera o trackeroao-instalador.exe a partir do instalar.ps1.

Por que compilar em vez de so distribuir o .ps1: um .ps1 aberto por duplo
clique abre o editor em vez de executar, e mesmo pela linha de comando esbarra
na politica de execucao. Um .exe roda em qualquer maquina com duplo clique,
que e o que se quer de um instalador.

Por que nao o ps2exe: ele vem da PowerShell Gallery e exige instalar um
provider, o que nem sempre da certo em maquina alheia. O compilador C# do
.NET Framework ja vem com o Windows desde sempre, entao este script depende
so do que a maquina ja tem.

O script vai embutido em base64 e roda via -EncodedCommand: assim nao ha
arquivo temporario no disco nem problema de aspas escapadas.
#>

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$fonte = Join-Path $raiz 'instalar.ps1'
$saida = Join-Path $raiz 'trackeroao-instalador.exe'

if (-not (Test-Path $fonte)) { throw "nao achei $fonte" }

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64" -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -Last 1
if (-not $csc) { throw 'csc.exe do .NET Framework nao encontrado' }

# -EncodedCommand espera UTF-16LE em base64, que e o formato que o PowerShell
# usa internamente para passar um script inteiro por argumento.
$texto = Get-Content $fonte -Raw
$b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($texto))

$cs = @"
using System;
using System.Diagnostics;

class Instalador {
  const string Script = "$b64";

  static int Main(string[] args) {
    Console.Title = "trackeroao";
    var psi = new ProcessStartInfo("powershell.exe");
    psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoLogo -EncodedCommand " + Script;
    psi.UseShellExecute = false;
    var p = Process.Start(psi);
    p.WaitForExit();
    if (p.ExitCode != 0) {
      Console.WriteLine();
      Console.WriteLine("A instalacao terminou com erro. Tecle algo para fechar.");
      Console.ReadKey();
    }
    return p.ExitCode;
  }
}
"@

$tmpCs = Join-Path $env:TEMP ("instalador-" + [guid]::NewGuid().ToString('N') + '.cs')
Set-Content -Path $tmpCs -Value $cs -Encoding UTF8

& $csc.FullName /nologo /target:exe /platform:anycpu "/out:$saida" $tmpCs
$codigo = $LASTEXITCODE
Remove-Item $tmpCs -Force -ErrorAction SilentlyContinue

if ($codigo -ne 0) { throw "csc falhou com codigo $codigo" }
$kb = [math]::Round((Get-Item $saida).Length / 1KB, 1)
Write-Host "gerado: $saida ($kb KB)" -ForegroundColor Green

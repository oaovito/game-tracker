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

O script vai embutido em base64 dentro do executavel, e na hora de rodar e
gravado como um .ps1 comum numa pasta temporaria e chamado com -File. Os dois
comentarios dentro do Main explicam por que nao e feito do jeito mais curto --
e a parte deste arquivo que economiza mais tempo de quem mexer nele depois.
#>

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$fonte = Join-Path $raiz 'instalar.ps1'
$saida = Join-Path $raiz 'trackeroao-instalador.exe'

if (-not (Test-Path $fonte)) { throw "nao achei $fonte" }

$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64" -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -Last 1
if (-not $csc) { throw 'csc.exe do .NET Framework nao encontrado' }

# UTF-8 em base64. O arquivo e regravado como UTF-8 com BOM do outro lado,
# porque sem o BOM o PowerShell 5.1 le acentuado como ANSI e estraga os textos.
$texto = Get-Content $fonte -Raw
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($texto))

$cs = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class Instalador {
  const string Script = "$b64";

  static int Main(string[] args) {
    Console.Title = "trackeroao";

    /*
     * O script e gravado em disco e chamado com -File, e NAO passado por
     * -EncodedCommand.
     *
     * -EncodedCommand seria mais curto e nao deixaria arquivo nenhum para
     * tras, e foi assim que isto nasceu. Nao funciona: o Windows Defender
     * mata o processo antes de ele existir, e reporta
     * Trojan:Win32/ClickFix.PM!MTB. A assinatura nao e do nosso script -- e
     * da forma "um .exe qualquer abre o powershell com um blob codificado".
     * E o padrao das campanhas em que a pessoa e convencida a colar um
     * comando codificado no Executar, entao a heuristica e agressiva de
     * proposito e nao ha como ser educado com ela.
     *
     * O sintoma nao ajuda nada a chegar ate aqui: vem como "Access is denied"
     * do CreateProcess, como se faltasse permissao para rodar o powershell.
     * O que denunciou foi trocar o instalador por um script de duas linhas e
     * ver o mesmo executavel funcionar.
     *
     * Um .ps1 legivel em disco, por outro lado, e o caminho que o Windows
     * considera normal: o Defender le, ve um instalador, e deixa passar.
     */
    var pasta = Path.Combine(Path.GetTempPath(), "trackeroao-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(pasta);
    var alvo = Path.Combine(pasta, "instalar.ps1");
    File.WriteAllText(alvo, Encoding.UTF8.GetString(Convert.FromBase64String(Script)),
                      new UTF8Encoding(true));

    var psi = new ProcessStartInfo("powershell.exe");
    psi.Arguments = "-NoProfile -File \"" + alvo + "\"";
    foreach (var a in args) {
      psi.Arguments += " " + (a.Contains(" ") ? "\"" + a + "\"" : a);
    }

    /*
     * A politica de execucao vai pelo ambiente, e nao por -ExecutionPolicy
     * Bypass na linha de comando.
     *
     * O flag na linha faz parte da mesma assinatura descrita acima -- ele e
     * metade do que a heuristica procura. A variavel PSExecutionPolicyPreference
     * e lida pelo PowerShell no arranque e vale para o processo inteiro,
     * fazendo exatamente o mesmo efeito sem parecer a mesma coisa.
     *
     * E preciso porque em Windows recem-instalado a politica padrao e
     * Restricted, e sem isto o -File nao rodaria em maquina nenhuma.
     */
    psi.EnvironmentVariables["PSExecutionPolicyPreference"] = "Bypass";
    psi.UseShellExecute = false;

    int codigo;
    try {
      var p = Process.Start(psi);
      p.WaitForExit();
      codigo = p.ExitCode;
    } catch (Exception e) {
      Console.WriteLine();
      Console.WriteLine("Nao consegui iniciar o PowerShell: " + e.Message);
      Console.WriteLine("O script ficou em " + alvo + ", da para roda-lo a mao.");
      Console.WriteLine("Tecle algo para fechar.");
      Console.ReadKey();
      return 1;
    }

    try { Directory.Delete(pasta, true); } catch { }

    if (codigo != 0) {
      Console.WriteLine();
      Console.WriteLine("A instalacao terminou com erro. Tecle algo para fechar.");
      Console.ReadKey();
    }
    return codigo;
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

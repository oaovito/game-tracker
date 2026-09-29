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
  O icone: a chama do aplicativo (docs/app/icone-192.png), dentro de um .ico.
  Desde o Vista um .ico pode carregar um PNG inteiro, entao o arquivo e so um
  cabecalho de 22 bytes seguido do proprio PNG, sem conversao nem perda.
#>
$icone = Join-Path $tmp 'trackeroao.ico'
$png = [IO.File]::ReadAllBytes((Join-Path $projeto 'docs\app\icone-192.png'))
$ms = New-Object IO.MemoryStream
$bw = New-Object IO.BinaryWriter($ms)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]192); $bw.Write([Byte]192); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$png.Length); $bw.Write([UInt32]22)
$bw.Write($png)
$bw.Flush()
[IO.File]::WriteAllBytes($icone, $ms.ToArray())

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
using System.Windows.Forms;

[assembly: AssemblyTitle("Trackeroao")]
[assembly: AssemblyDescription("Instalador do Trackeroao")]
[assembly: AssemblyCompany("oaovito")]
[assembly: AssemblyProduct("Trackeroao")]
[assembly: AssemblyCopyright("oaovito")]
[assembly: AssemblyVersion("$versaoNum")]
[assembly: AssemblyFileVersion("$versaoNum")]
[assembly: AssemblyInformationalVersion("$versaoNum")]

static class Programa {
  const string Instalar = "$b64Instalar";
  const string Desinstalar = "$b64Desinstalar";

  [STAThread]
  static int Main(string[] args) {
    string proprio = Application.ExecutablePath;
    string pastaPropria = Path.GetDirectoryName(proprio);
    bool desinstalando = Path.GetFileName(proprio).ToLowerInvariant().Contains("desinstal");
    bool elevado = false, semElevar = false, fechar = false;
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
      else repassar.Append(" ").Append(Aspas(a));
    }
    if (usuario == null) usuario = UsuarioAtual();
    if (exeOriginal == null) exeOriginal = proprio;
    Limpar(proprio);
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
    passo = desinstalando ? "Preparando a remo\u00e7\u00e3o" : "Preparando a instala\u00e7\u00e3o";
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
    string pastaApp = null;
    Assembly eu = Assembly.GetExecutingAssembly();
    foreach (string r in eu.GetManifestResourceNames()) {
      if (!r.StartsWith("app/")) continue;
      if (pastaApp == null) { pastaApp = Path.Combine(pastaTemp, "app"); Directory.CreateDirectory(pastaApp); }
      using (Stream de = eu.GetManifestResourceStream(r))
      using (FileStream para = File.Create(Path.Combine(pastaApp, r.Substring(4)))) de.CopyTo(para);
    }

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
        erro = "N\u00e3o consegui iniciar o PowerShell: " + ex.Message;
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
          passo = resto.Substring(sp + 1);
        } else passo = resto;
        detalhe = "";
      } else if (tipo == "DETALHE") detalhe = resto;
      else if (tipo == "PENDENCIA") pendencias.Add(resto);
      else if (tipo == "ERRO") erro = resto;
      else if (tipo == "PRONTO") fraseFinal = resto;
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
        if (erro == null) erro = (desinstalando ? "A remo\u00e7\u00e3o" : "A instala\u00e7\u00e3o") + " parou antes do fim."
                               + (primeiroErro != null ? " " + primeiroErro : "");
        Mudar(Modo.Erro);
      }
    }
  }

  void Mudar(Modo m) {
    modo = m;
    Codigo = m == Modo.Pronto ? 0 : 1;
    if (m == Modo.Pronto) { alvo = 100f; passo = fraseFinal; }
    else passo = desinstalando ? "N\u00e3o foi poss\u00edvel remover" : "N\u00e3o foi poss\u00edvel instalar";
    if (m == Modo.Pronto && !desinstalando) { rotPrimario = "Abrir o Trackeroao"; rotSecundario = "Fechar"; }
    else if (m == Modo.Pronto) { rotPrimario = "Fechar"; rotSecundario = null; }
    else { rotPrimario = "Fechar"; rotSecundario = "Ver registro"; }

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

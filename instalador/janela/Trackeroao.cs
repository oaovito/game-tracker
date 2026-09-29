/*
 * Trackeroao.exe - a janela do Trackeroao no Windows.
 *
 * O progresso abre aqui, numa janela propria, e nao num navegador: sem barra
 * de endereco, sem aba, sem link. Ela abre com dois cliques no icone da area
 * de trabalho ou na chama da bandeja, e so por esses dois caminhos.
 *
 * Por dentro, a janela e o WebView2, o componente de pagina que o proprio
 * Windows 10 e 11 ja trazem (o mesmo motor do Edge). Ele mostra a pagina que
 * o servico do Trackeroao serve nesta maquina; o endereco e interno e nunca
 * aparece. Sem o componente (um Windows 10 muito antigo e sem atualizacoes),
 * a pagina abre numa janela de aplicativo do Edge, tambem sem barra.
 *
 * Uma janela so: abrir de novo traz a que ja esta aberta para a frente. O
 * "Fechar" do menu da bandeja fecha esta janela tambem, e o servico junto;
 * abrir esta janela e o que o traz de volta.
 *
 * Compila com o csc do .NET Framework (C# 5) contra as bibliotecas do
 * WebView2; quem compila e o construir-janela.ps1.
 */
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("Trackeroao")]
[assembly: System.Reflection.AssemblyDescription("Trackeroao")]
[assembly: System.Reflection.AssemblyCompany("oaovito")]
[assembly: System.Reflection.AssemblyProduct("Trackeroao")]
[assembly: System.Reflection.AssemblyCopyright("oaovito")]

static class Programa {
  internal const string Endereco = "http://127.0.0.1:8777/";

  [STAThread]
  static void Main() {
    bool primeira;
    Mutex unica = new Mutex(true, "Local\\TrackeroaoJanela", out primeira);
    if (!primeira) {
      // Ja existe uma janela: ela e que aparece, e esta sai sem mostrar nada.
      EventWaitHandle mostrar;
      if (EventWaitHandle.TryOpenExisting("Local\\TrackeroaoMostrar", out mostrar)) mostrar.Set();
      return;
    }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new Janela());
    GC.KeepAlive(unica);
  }
}

class Janela : Form {
  static readonly Color Fundo = Color.FromArgb(6, 7, 10);
  readonly WebView2 web;
  readonly EventWaitHandle mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TrackeroaoMostrar");
  readonly EventWaitHandle fechar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TrackeroaoFechar");

  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);

  public Janela() {
    Text = "Trackeroao";
    BackColor = Fundo;
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
    AutoScaleMode = AutoScaleMode.Dpi;
    StartPosition = FormStartPosition.CenterScreen;
    Rectangle tela = Screen.PrimaryScreen.WorkingArea;
    Size = new Size(Math.Min(1320, tela.Width - 80), Math.Min(860, tela.Height - 60));
    MinimumSize = new Size(420, 560);

    web = new WebView2();
    web.Dock = DockStyle.Fill;
    web.DefaultBackgroundColor = Fundo;
    // A pasta de dados do componente e uma so, sempre a mesma: nada se
    // acumula de uma abertura para a outra.
    web.CreationProperties = new CoreWebView2CreationProperties();
    web.CreationProperties.UserDataFolder = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "trackeroao", "webview");
    Controls.Add(web);

    HandleCreated += delegate {
      // Barra de titulo escura, como o resto da janela (Windows 10 20H1+).
      int sim = 1;
      try { DwmSetWindowAttribute(Handle, 20, ref sim, 4); } catch { }
    };
    Shown += async delegate { await Abrir(); };
    Vigiar(mostrar, delegate {
      if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
      Show(); Activate(); BringToFront();
    });
    Vigiar(fechar, delegate { Close(); });
  }

  void Vigiar(EventWaitHandle sinal, Action acao) {
    Thread t = new Thread(delegate() {
      while (true) {
        sinal.WaitOne();
        try { BeginInvoke(acao); } catch { return; }
      }
    });
    t.IsBackground = true;
    t.Start();
  }

  async Task Abrir() {
    try {
      await web.EnsureCoreWebView2Async();
    } catch (WebView2RuntimeNotFoundException) {
      AbrirNoEdge();
      return;
    }
    CoreWebView2Settings s = web.CoreWebView2.Settings;
    s.AreDevToolsEnabled = false;
    s.IsStatusBarEnabled = false;
    s.AreDefaultContextMenusEnabled = false;
    s.IsGeneralAutofillEnabled = false;
    s.IsPasswordAutosaveEnabled = false;
    // Link para fora (uma loja, um site de jogo) abre no navegador da pessoa;
    // dentro desta janela so fica o Trackeroao.
    web.CoreWebView2.NewWindowRequested += delegate(object o, CoreWebView2NewWindowRequestedEventArgs e) {
      e.Handled = true;
      Fora(e.Uri);
    };
    web.CoreWebView2.NavigationStarting += delegate(object o, CoreWebView2NavigationStartingEventArgs e) {
      if (e.Uri.StartsWith(Programa.Endereco, StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("data:")) return;
      e.Cancel = true;
      Fora(e.Uri);
    };
    web.CoreWebView2.DocumentTitleChanged += delegate { Text = "Trackeroao"; };

    web.NavigateToString(Espera());
    bool vivo = await Task.Run(new Func<bool>(GarantirServico));
    if (vivo) {
      Pedir(Programa.Endereco + "abrir");
      web.CoreWebView2.Navigate(Programa.Endereco);
    } else {
      web.NavigateToString(Espera().Replace("<i></i>", "<i class=\"parado\"></i>"));
    }
  }

  static void Fora(string uri) {
    if (uri != null && (uri.StartsWith("https://") || uri.StartsWith("http://"))) {
      try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
    }
  }

  /*
   * O servico sobe no logon, mas pode ter sido encerrado. A tarefa agendada e
   * o caminho certo para subi-lo: roda como o usuario certo e na pasta certa.
   */
  static bool GarantirServico() {
    // Abrir a mao desfaz o "Fechar" da bandeja: sem esta marca, o servico
    // volta a subir sozinho no logon e com o jogo.
    try {
      string raiz = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
      File.Delete(Path.Combine(Path.Combine(raiz, "sync"), "fechado.flag"));
    } catch { }
    if (Responde()) return true;
    try {
      ProcessStartInfo p = new ProcessStartInfo("schtasks.exe", "/run /tn TrackeroaoSync");
      p.CreateNoWindow = true;
      p.UseShellExecute = false;
      Process.Start(p).WaitForExit(5000);
    } catch { }
    for (int i = 0; i < 40; i++) {
      Thread.Sleep(500);
      if (Responde()) return true;
    }
    return false;
  }

  static bool Responde() {
    try {
      HttpWebRequest r = (HttpWebRequest)WebRequest.Create(Programa.Endereco + "progress.json");
      r.Timeout = 1500;
      r.Proxy = null;
      using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse()) return resp.StatusCode == HttpStatusCode.OK;
    } catch { return false; }
  }

  static void Pedir(string url) {
    ThreadPool.QueueUserWorkItem(delegate {
      try {
        HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
        r.Timeout = 2000;
        r.Proxy = null;
        r.GetResponse().Close();
      } catch { }
    });
  }

  // A tela de espera, sem texto: so o nome, que nao muda com o idioma.
  static string Espera() {
    return "<!doctype html><meta charset=utf-8><style>" +
      "html,body{margin:0;height:100%;background:#06070a;color:#f5f6f8;font-family:'Segoe UI',system-ui,sans-serif}" +
      "body{display:grid;place-items:center}div{text-align:center}" +
      "b{font-size:28px;font-weight:700;letter-spacing:.02em}b span{color:#d8ff3c}" +
      "i{display:block;margin:18px auto 0;width:120px;height:3px;border-radius:3px;background:linear-gradient(90deg,transparent,#d8ff3c,transparent);background-size:200% 100%;animation:a 1.2s linear infinite}" +
      "i.parado{animation:none;background:#ff5a5a}@keyframes a{to{background-position:-200% 0}}" +
      "</style><div><b>Tracker<span>oao</span></b><i></i></div>";
  }

  void AbrirNoEdge() {
    try {
      GarantirServico();
      ProcessStartInfo p = new ProcessStartInfo("msedge.exe", "--app=" + Programa.Endereco);
      p.UseShellExecute = true;
      Process.Start(p);
    } catch { }
    Close();
  }
}

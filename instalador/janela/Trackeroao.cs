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
 * A borda e a do proprio Trackeroao, e nao a do Windows: uma barra escura com
 * o nome e os tres botoes, como nos aplicativos de jogo. Por baixo a janela
 * continua sendo uma janela comum do Windows -- arrasta, encaixa nas bordas
 * da tela, maximiza com dois cliques e redimensiona pelas bordas --, so sem a
 * barra branca do sistema.
 *
 * O mesmo .exe e tambem o icone da bandeja (/bandeja). Assim o Windows mostra
 * "Trackeroao" e o icone dele na lista de icones da bandeja, e nao o do
 * PowerShell que fazia esse papel antes.
 *
 * Compila com o csc do .NET Framework (C# 5) contra as bibliotecas do
 * WebView2; quem compila e o construir-janela.ps1.
 */
using System;
using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Text;
using System.Text.RegularExpressions;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("Trackeroao")]
[assembly: System.Reflection.AssemblyDescription("Trackeroao")]
[assembly: System.Reflection.AssemblyCompany("oaovito")]
[assembly: System.Reflection.AssemblyProduct("Trackeroao")]
[assembly: System.Reflection.AssemblyCopyright("oaovito")]

static class Programa {
  internal const string Endereco = "http://127.0.0.1:8777/";

  /*
   * O icone do Trackeroao no tamanho pedido. O .ico da instalacao traz cada
   * tamanho desenhado a parte (16, 20, 24...), e o Windows escolhe o certo;
   * sem ele, vale o embutido neste .exe.
   */
  internal static Icon Icone(Size tamanho) {
    try {
      string raiz = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
      string ico = Path.Combine(Path.Combine(Path.Combine(raiz, "instalador"), "icone"), "trackeroao.ico");
      if (File.Exists(ico)) return new Icon(ico, tamanho);
    } catch { }
    try { return new Icon(Icon.ExtractAssociatedIcon(Application.ExecutablePath), tamanho); } catch { }
    return null;
  }

  // Quem abre passa a vez de ficar na frente para a janela ja aberta: sem
  // isto o Windows so pisca o botao dela na barra de tarefas.
  [DllImport("user32.dll")] internal static extern bool AllowSetForegroundWindow(int processo);

  // Para onde a janela ja aberta deve ir (/ir=#sekiro, do menu da bandeja).
  internal static string ArquivoIr { get { return Path.Combine(Path.GetTempPath(), "Trackeroao.ir"); } }

  [STAThread]
  static void Main(string[] args) {
    bool escondida = false;
    string ir = null;
    foreach (string a in args) {
      if (a.Equals("/bandeja", StringComparison.OrdinalIgnoreCase)) { Bandeja.Rodar(args); return; }
      if (a.Equals("/escondida", StringComparison.OrdinalIgnoreCase)) escondida = true;
      if (a.StartsWith("/ir=", StringComparison.OrdinalIgnoreCase)) ir = a.Substring(4);
    }
    bool primeira;
    Mutex unica = new Mutex(true, "Local\\TrackeroaoJanela", out primeira);
    if (!primeira) {
      // Ja existe uma janela: ela e que aparece, e esta sai sem mostrar nada.
      if (ir != null) { try { File.WriteAllText(ArquivoIr, ir); } catch { } }
      try { AllowSetForegroundWindow(-1); } catch { }
      EventWaitHandle mostrar;
      if (EventWaitHandle.TryOpenExisting("Local\\TrackeroaoMostrar", out mostrar)) mostrar.Set();
      return;
    }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new Janela(escondida, ir));
    GC.KeepAlive(unica);
  }
}

class Janela : Form {
  static readonly Color Fundo = Color.FromArgb(6, 7, 10);
  readonly WebView2 web;
  readonly EventWaitHandle mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TrackeroaoMostrar");
  readonly EventWaitHandle fechar = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\TrackeroaoFechar");
  // Aceso enquanto a janela esta a vista. A troca da janela pela atualizacao
  // le este sinal: com ela a vista, espera; escondida na bandeja, troca.
  readonly EventWaitHandle aVista = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\TrackeroaoAVista");
  readonly bool comecarEscondida;
  string irPara;
  // O X esconde; so o "Fechar" da bandeja (ou o desligamento do Windows) fecha.
  bool saindo;
  FormWindowState antes = FormWindowState.Normal;
  // O tamanho da janela fora de tela cheia: um so, travado.
  Size tamanho;

  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr janela);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr janela);
  [StructLayout(LayoutKind.Sequential)]
  struct PosicaoJanela { public IntPtr Janela, Depois; public int X, Y, L, A; public uint Opcoes; }
  const int WM_WINDOWPOSCHANGING = 0x46, HTBORDER = 18;

  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);
  [DllImport("user32.dll")]
  static extern int GetSystemMetrics(int indice);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr janela, IntPtr depois, int x, int y, int l, int a, uint opcoes);

  [StructLayout(LayoutKind.Sequential)]
  struct Retangulo { public int Esq, Topo, Dir, Base; }

  const int WM_NCCALCSIZE = 0x83, WM_NCHITTEST = 0x84;
  const int HTCLIENT = 1, HTCAPTION = 2, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;

  readonly Barra barra;

  public Janela(bool escondida, string ir) {
    comecarEscondida = escondida;
    irPara = ir;
    Text = "Trackeroao";
    BackColor = Fundo;
    // O icone da barra de tarefas: o do .exe, que traz todos os tamanhos.
    try {
      string ico = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath)), "instalador\\icone\\trackeroao.ico");
      Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    } catch { }
    AutoScaleMode = AutoScaleMode.Dpi;
    /*
     * Onde ela abre: no mesmo lugar da ultima vez (a mesma tela, a mesma
     * posicao, em tela cheia se estava), inclusive depois de reiniciar o
     * computador ou de uma atualizacao. Se aquela tela nao existe mais, abre
     * no meio da tela principal.
     */
    Lugar lugar = Lugar.Ler();
    Screen tela = null;
    if (lugar != null) {
      foreach (Screen t in Screen.AllScreens) if (t.WorkingArea.Contains(lugar.Centro)) tela = t;
    }
    Rectangle area = (tela ?? Screen.PrimaryScreen).WorkingArea;
    tamanho = new Size(Math.Min(1320, area.Width - 80), Math.Min(860, area.Height - 60));
    Size = tamanho;
    if (tela != null) {
      StartPosition = FormStartPosition.Manual;
      Location = new Point(
        Math.Max(area.Left, Math.Min(lugar.X, area.Right - tamanho.Width)),
        Math.Max(area.Top, Math.Min(lugar.Y, area.Bottom - tamanho.Height)));
      if (lugar.Cheia) { WindowState = FormWindowState.Maximized; antes = FormWindowState.Maximized; }
    } else {
      StartPosition = FormStartPosition.CenterScreen;
    }

    barra = new Barra(this);

    web = new WebView2();
    web.Dock = DockStyle.Fill;
    web.DefaultBackgroundColor = Fundo;
    // A pasta de dados do componente e uma so, sempre a mesma: nada se
    // acumula de uma abertura para a outra.
    web.CreationProperties = new CoreWebView2CreationProperties();
    web.CreationProperties.UserDataFolder = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "trackeroao", "webview");
    // Uma pagina so, local: um processo de pagina basta, sem reserva de outro
    // e sem as tarefas de rede de fundo do navegador.
    web.CreationProperties.AdditionalBrowserArguments =
      "--renderer-process-limit=1 --disable-background-networking --disable-features=SpareRendererForSitePerProcess";
    Controls.Add(web);
    Controls.Add(barra);
    // A pagina ocupa o que sobra abaixo da barra.
    web.BringToFront();

    HandleCreated += delegate {
      // Modo escuro nas partes que o Windows ainda desenha (Windows 10 20H1+),
      // e o contorno da janela no tom da barra (Windows 11).
      int sim = 1;
      try { DwmSetWindowAttribute(Handle, 20, ref sim, 4); } catch { }
      int contorno = 0x00221E1C; // COLORREF 0x00BBGGRR: #1c1e22
      try { DwmSetWindowAttribute(Handle, 34, ref contorno, 4); } catch { }
      // Faz o Windows recalcular a moldura com a regra de WndProc.
      SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x0027);
    };
    /*
     * Tres estados e so: o tamanho travado, a tela cheia, e escondida na
     * bandeja. Minimizar e fechar pelo X escondem na bandeja; de la ela volta
     * pelo icone, no mesmo lugar e no mesmo estado.
     */
    Resize += delegate {
      barra.Invalidate();
      if (WindowState == FormWindowState.Minimized) {
        if (Visible) BeginInvoke((Action)Esconder);
      } else {
        antes = WindowState;
      }
      Poupar();
      AtualizarVista();
    };
    VisibleChanged += delegate { Poupar(); AtualizarVista(); };
    ResizeEnd += delegate { SalvarLugar(); };
    // O contorno da janela acompanha a barra enquanto ela troca de cor.
    barra.Mudou += delegate(Color c) {
      if (!IsHandleCreated) return;
      int v = c.R | (c.G << 8) | (c.B << 16);
      try { DwmSetWindowAttribute(Handle, 34, ref v, 4); } catch { }
    };
    Shown += async delegate { await Abrir(); };
    Vigiar(mostrar, Mostrar);
    Vigiar(fechar, delegate { saindo = true; Close(); });
  }

  // Aberta com /escondida (a troca da atualizacao com a janela na bandeja),
  // ela nasce sem aparecer, e a pagina so carrega quando for mostrada.
  bool mostrada;
  protected override void SetVisibleCore(bool valor) {
    if (valor && comecarEscondida && !mostrada) {
      if (!IsHandleCreated) CreateHandle();
      valor = false;
    }
    base.SetVisibleCore(valor);
  }

  void Mostrar() {
    mostrada = true;
    string ir = null;
    try {
      if (File.Exists(Programa.ArquivoIr)) { ir = File.ReadAllText(Programa.ArquivoIr).Trim(); File.Delete(Programa.ArquivoIr); }
    } catch { }
    if (!Visible) Show();
    if (WindowState == FormWindowState.Minimized) WindowState = antes;
    Activate();
    BringToFront();
    if (!string.IsNullOrEmpty(ir)) {
      if (web.CoreWebView2 != null) web.CoreWebView2.Navigate(Programa.Endereco + ir);
      else irPara = ir;
    }
    AtualizarVista();
  }

  void Esconder() {
    SalvarLugar();
    Hide();
    Poupar();
    AtualizarVista();
  }

  // O estado tambem vai para sync\janela.estado, que o servico le antes de
  // tentar a troca: com a janela a vista, ele nem comeca (e o icone da
  // bandeja nao pisca a cada conferencia).
  string estadoGravado;
  static string ArquivoEstado {
    get {
      string raiz = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
      return Path.Combine(Path.Combine(raiz, "sync"), "janela.estado");
    }
  }

  void AtualizarVista() {
    bool vista = Visible && WindowState != FormWindowState.Minimized;
    try { if (vista) aVista.Set(); else aVista.Reset(); } catch { }
    string estado = vista ? "vista" : "escondida";
    if (estado == estadoGravado) return;
    estadoGravado = estado;
    try { File.WriteAllText(ArquivoEstado, estado); } catch { }
  }

  protected override void OnFormClosed(FormClosedEventArgs e) {
    try { File.Delete(ArquivoEstado); } catch { }
    base.OnFormClosed(e);
  }

  void SalvarLugar() {
    if (!IsHandleCreated) return;
    Point p = WindowState == FormWindowState.Normal ? Location : RestoreBounds.Location;
    bool cheia = WindowState == FormWindowState.Maximized ||
      (WindowState == FormWindowState.Minimized && antes == FormWindowState.Maximized);
    Lugar.Gravar(p, cheia);
  }

  protected override void OnFormClosing(FormClosingEventArgs e) {
    SalvarLugar();
    if (!saindo && e.CloseReason == CloseReason.UserClosing) {
      e.Cancel = true;
      Esconder();
      return;
    }
    base.OnFormClosing(e);
  }

  /*
   * A moldura.
   *
   * A barra de titulo do Windows sai, e o resto da moldura fica: as bordas
   * invisiveis de redimensionar dos lados e de baixo, a sombra e o encaixe na
   * tela. A faixa de cima vira area do aplicativo, onde mora a Barra; ali,
   * fora dos botoes, o Windows entende "barra de titulo" (arrastar, dois
   * cliques, menu do sistema), e rente ao topo, "borda de cima".
   */
  int Moldura(bool vertical) {
    // SM_CXSIZEFRAME/SM_CYSIZEFRAME + SM_CXPADDEDBORDER
    return GetSystemMetrics(vertical ? 33 : 32) + GetSystemMetrics(92);
  }

  protected override void WndProc(ref Message m) {
    // Fora da tela cheia o tamanho e sempre o mesmo: nem a borda nem o
    // encaixe do Windows nas laterais da tela mudam o tamanho dela.
    if (m.Msg == WM_WINDOWPOSCHANGING && IsHandleCreated && !IsZoomed(Handle) && !IsIconic(Handle) && tamanho.Width > 0) {
      PosicaoJanela w = (PosicaoJanela)Marshal.PtrToStructure(m.LParam, typeof(PosicaoJanela));
      if ((w.Opcoes & 0x0001) == 0 && (w.L != tamanho.Width || w.A != tamanho.Height)) {
        w.L = tamanho.Width;
        w.A = tamanho.Height;
        Marshal.StructureToPtr(w, m.LParam, false);
      }
    }
    if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero) {
      Retangulo r = (Retangulo)Marshal.PtrToStructure(m.LParam, typeof(Retangulo));
      int bx = Moldura(false), by = Moldura(true);
      r.Esq += bx; r.Dir -= bx; r.Base -= by;
      // Maximizada, a janela passa da tela pela espessura da moldura; o topo
      // volta para dentro para a barra nao ficar cortada.
      if (WindowState == FormWindowState.Maximized) r.Topo += by;
      Marshal.StructureToPtr(r, m.LParam, false);
      m.Result = IntPtr.Zero;
      return;
    }
    if (m.Msg == WM_NCHITTEST) {
      base.WndProc(ref m);
      // As bordas nao redimensionam: o tamanho e travado.
      int onde = m.Result.ToInt32();
      if (onde >= 10 && onde <= 17) { m.Result = (IntPtr)HTBORDER; return; }
      if (onde != HTCLIENT) return;
      Point p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
      if (barra != null && p.Y < barra.Height && !barra.SobreBotao(p)) m.Result = (IntPtr)HTCAPTION;
      return;
    }
    base.WndProc(ref m);
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

  /*
   * Minimizada, a pagina para de desenhar e o componente devolve memoria ao
   * sistema; de volta, tudo retoma de onde estava.
   */
  void Poupar() {
    if (web == null || web.CoreWebView2 == null) return;
    bool min = WindowState == FormWindowState.Minimized || !Visible;
    try {
      web.Visible = !min;
      web.CoreWebView2.MemoryUsageTargetLevel = min ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
    } catch { }
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
    // A pagina manda a cor das pontas dela ("cor:#rrggbb"), e a barra passa
    // para essa cor devagar.
    web.CoreWebView2.WebMessageReceived += delegate(object o, CoreWebView2WebMessageReceivedEventArgs e) {
      string m = null;
      try { m = e.TryGetWebMessageAsString(); } catch { }
      Match c = Regex.Match(m ?? "", "^cor:#([0-9a-fA-F]{6})$");
      if (c.Success) barra.Tingir(Color.FromArgb(Convert.ToInt32(c.Groups[1].Value, 16) | unchecked((int)0xFF000000)));
    };

    web.NavigateToString(Espera());
    bool vivo = await Task.Run(new Func<bool>(GarantirServico));
    if (vivo) {
      Pedir(Programa.Endereco + "abrir");
      web.CoreWebView2.Navigate(Programa.Endereco + (irPara ?? ""));
      irPara = null;
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
    // O pedido de abrir: sem ele o servico que a tarefa sobe sai na hora,
    // porque nada do Trackeroao inicia sozinho sem a caixa marcada na bandeja.
    try {
      string raiz = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
      File.WriteAllText(Path.Combine(Path.Combine(raiz, "sync"), "abrir.pedido"), DateTime.Now.ToString("o"));
    } catch { }
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

/*
 * Onde a janela estava: a posicao fora da tela cheia e se estava em tela
 * cheia, num arquivo pequeno ao lado dos dados do componente de pagina.
 */
class Lugar {
  public int X, Y;
  public bool Cheia;
  public Point Centro { get { return new Point(X + 300, Y + 200); } }

  static string Arquivo {
    get {
      return Path.Combine(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "trackeroao"), "janela.txt");
    }
  }

  public static Lugar Ler() {
    try {
      string[] v = File.ReadAllText(Arquivo).Trim().Split(' ');
      Lugar l = new Lugar();
      l.X = int.Parse(v[0]);
      l.Y = int.Parse(v[1]);
      l.Cheia = v.Length > 2 && v[2] == "1";
      return l;
    } catch { return null; }
  }

  public static void Gravar(Point p, bool cheia) {
    try {
      Directory.CreateDirectory(Path.GetDirectoryName(Arquivo));
      File.WriteAllText(Arquivo, p.X + " " + p.Y + " " + (cheia ? "1" : "0"));
    } catch { }
  }
}

/*
 * A barra do Trackeroao: o icone, o nome e os botoes de minimizar, maximizar
 * e fechar, desenhados no escuro do aplicativo. O nome e titulo e nao muda com
 * o idioma. Fora dos botoes ela e transparente para o Windows, que ali trata
 * o clique como barra de titulo (ver WndProc da Janela).
 */
class Barra : Control {
  static readonly Color Inicial = Color.FromArgb(10, 11, 15);
  static readonly Color Fechar = Color.FromArgb(237, 66, 69);

  // A cor da barra e a das pontas da pagina, e muda com ela em ~0,35 s.
  Color fundo = Inicial, de = Inicial, para = Inicial;
  DateTime desde;
  readonly System.Windows.Forms.Timer passo = new System.Windows.Forms.Timer();
  public event Action<Color> Mudou;

  public void Tingir(Color alvo) {
    if (alvo.ToArgb() == para.ToArgb()) return;
    de = fundo; para = alvo; desde = DateTime.UtcNow;
    passo.Start();
  }

  void Andar() {
    double t = Math.Min(1.0, (DateTime.UtcNow - desde).TotalMilliseconds / 350.0);
    double e = 1 - Math.Pow(1 - t, 3);
    fundo = Misturar(de, para, e);
    if (t >= 1) { fundo = para; passo.Stop(); }
    BackColor = fundo;
    Invalidate();
    if (Mudou != null) Mudou(fundo);
  }

  static Color Misturar(Color a, Color b, double k) {
    return Color.FromArgb(
      (int)Math.Round(a.R + (b.R - a.R) * k),
      (int)Math.Round(a.G + (b.G - a.G) * k),
      (int)Math.Round(a.B + (b.B - a.B) * k));
  }

  // Num fundo claro (o tema claro da pagina) o texto e os botoes escurecem.
  bool Claro { get { return (0.2126 * fundo.R + 0.7152 * fundo.G + 0.0722 * fundo.B) / 255.0 > 0.55; } }
  Color Texto { get { return Claro ? Color.FromArgb(18, 20, 26) : Color.FromArgb(236, 238, 242); } }
  Color Apagado { get { return Claro ? Color.FromArgb(84, 88, 98) : Color.FromArgb(150, 154, 164); } }
  Color Limao { get { return Claro ? Color.FromArgb(108, 140, 0) : Color.FromArgb(216, 255, 60); } }

  readonly Form dona;
  readonly Icon icone;
  int sob = -1;       // botao sob o mouse: 0 minimizar, 1 maximizar, 2 fechar
  int apertado = -1;

  public Barra(Form dona) {
    this.dona = dona;
    Dock = DockStyle.Top;
    SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
             ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
    BackColor = Inicial;
    passo.Interval = 15;
    passo.Tick += delegate { Andar(); };
    float escala = 1f;
    try { using (Graphics g = CreateGraphics()) escala = g.DpiX / 96f; } catch { }
    Height = (int)Math.Round(36 * escala);
    icone = Programa.Icone(new Size((int)(16 * escala), (int)(16 * escala)));
  }

  int LarguraBotao { get { return (int)Math.Round(Height * 38.0 / 36.0); } }

  Rectangle Botao(int i) {
    int l = LarguraBotao;
    return new Rectangle(Width - l * (3 - i), 0, l, Height);
  }

  public bool SobreBotao(Point p) {
    for (int i = 0; i < 3; i++) if (Botao(i).Contains(p)) return true;
    return false;
  }

  const int WM_NCHITTEST = 0x84, HTTRANSPARENT = -1;
  protected override void WndProc(ref Message m) {
    if (m.Msg == WM_NCHITTEST) {
      Point p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
      if (!SobreBotao(p)) { m.Result = (IntPtr)HTTRANSPARENT; return; }
    }
    base.WndProc(ref m);
  }

  protected override void OnMouseMove(MouseEventArgs e) {
    int novo = -1;
    for (int i = 0; i < 3; i++) if (Botao(i).Contains(e.Location)) novo = i;
    if (novo != sob) { sob = novo; Invalidate(); }
    base.OnMouseMove(e);
  }
  protected override void OnMouseLeave(EventArgs e) { sob = -1; apertado = -1; Invalidate(); base.OnMouseLeave(e); }
  protected override void OnMouseDown(MouseEventArgs e) {
    if (e.Button == MouseButtons.Left) { apertado = sob; Invalidate(); }
    base.OnMouseDown(e);
  }
  protected override void OnMouseUp(MouseEventArgs e) {
    int era = apertado;
    apertado = -1;
    Invalidate();
    if (e.Button == MouseButtons.Left && era >= 0 && Botao(era).Contains(e.Location)) {
      if (era == 0) dona.WindowState = FormWindowState.Minimized;
      else if (era == 1) dona.WindowState = dona.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
      else dona.Close();
    }
    base.OnMouseUp(e);
  }

  protected override void OnPaint(PaintEventArgs e) {
    Graphics g = e.Graphics;
    g.Clear(fundo);
    float k = Height / 36f;
    // Sem linha embaixo: a barra continua na pagina, que desce dela em degrade.

    int x = (int)(12 * k);
    if (icone != null) {
      int t = (int)(16 * k);
      g.DrawIcon(icone, new Rectangle(x, (Height - t) / 2, t, t));
      x += t + (int)(9 * k);
    }
    // O nome: "Tracker" claro e "oao" no limao, como no titulo da pagina.
    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
    using (Font f = new Font("Segoe UI Semibold", 9.5f * k, FontStyle.Regular, GraphicsUnit.Point)) {
      TextFormatFlags ff = TextFormatFlags.NoPadding | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine;
      Rectangle faixa = new Rectangle(x, 0, Width, Height);
      Size a = TextRenderer.MeasureText(g, "Tracker", f, faixa.Size, ff);
      TextRenderer.DrawText(g, "Tracker", f, faixa, Texto, ff);
      faixa.X += a.Width;
      TextRenderer.DrawText(g, "oao", f, faixa, Limao, ff);
    }

    /*
     * Os tres botoes, no jeito do Discord: tracos finos e arredondados, sem
     * moldura, e ao passar o mouse uma pastilha de cantos redondos por tras
     * (vermelha no fechar). Tudo com suavizacao, na mesma linha fina dos
     * icones da pagina.
     */
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
    for (int i = 0; i < 3; i++) {
      Rectangle b = Botao(i);
      Color cor = Apagado;
      if (i == sob) {
        Color realce = i == 2
          ? (apertado == i ? Color.FromArgb(200, 50, 54) : Fechar)
          : (Claro ? Color.FromArgb(apertado == i ? 30 : 18, 0, 0, 0) : Color.FromArgb(apertado == i ? 34 : 20, 255, 255, 255));
        float mx = 4 * k, my = 6 * k;
        RectangleF pastilha = new RectangleF(b.X + mx, b.Y + my, b.Width - 2 * mx, b.Height - 2 * my);
        using (GraphicsPath caminho = Arredondado(pastilha, 6 * k))
        using (SolidBrush br = new SolidBrush(realce)) g.FillPath(br, caminho);
        cor = i == 2 ? Color.White : Texto;
      }
      float cx = b.X + b.Width / 2f, cy = b.Y + b.Height / 2f, m = 4.5f * k;
      using (Pen p = new Pen(cor, Math.Max(1f, 1.15f * k))) {
        p.StartCap = p.EndCap = LineCap.Round;
        p.LineJoin = LineJoin.Round;
        if (i == 0) g.DrawLine(p, cx - m, cy, cx + m, cy);
        else if (i == 1) {
          if (dona.WindowState == FormWindowState.Maximized) {
            float d = 2f * k, lado = 2 * m - d;
            using (GraphicsPath frente = Arredondado(new RectangleF(cx - m, cy - m + d, lado, lado), 1.6f * k)) g.DrawPath(p, frente);
            using (GraphicsPath tras = new GraphicsPath()) {
              tras.AddLine(cx - m + d, cy - m, cx + m - 1.6f * k, cy - m);
              tras.AddArc(cx + m - 3.2f * k, cy - m, 3.2f * k, 3.2f * k, 270, 90);
              tras.AddLine(cx + m, cy - m + 1.6f * k, cx + m, cy + m - d);
              g.DrawPath(p, tras);
            }
          } else {
            using (GraphicsPath q = Arredondado(new RectangleF(cx - m, cy - m, 2 * m, 2 * m), 1.8f * k)) g.DrawPath(p, q);
          }
        } else {
          float dx = m * 0.95f;
          g.DrawLine(p, cx - dx, cy - dx, cx + dx, cy + dx);
          g.DrawLine(p, cx - dx, cy + dx, cx + dx, cy - dx);
        }
      }
    }
    g.SmoothingMode = SmoothingMode.None;
  }

  static GraphicsPath Arredondado(RectangleF r, float raio) {
    float d = Math.Min(raio * 2, Math.Min(r.Width, r.Height));
    GraphicsPath c = new GraphicsPath();
    c.AddArc(r.X, r.Y, d, d, 180, 90);
    c.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    c.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
    c.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    c.CloseFigure();
    return c;
  }
}

/*
 * O consumo do Trackeroao: a soma dos processos dele -- o servico (node), os
 * Trackeroao.exe (a janela e este icone) e tudo o que eles abriram, como o
 * motor da pagina (msedgewebview2). CPU pela diferenca do tempo de
 * processador entre duas medidas; GPU pelos contadores "GPU Engine" do
 * Windows, o mesmo numero do Gerenciador de Tarefas; RAM pelo conjunto de
 * trabalho. So mede com o menu aberto: fechado, nao custa nada.
 */
class Consumo {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Entrada {
    public uint Tamanho, Uso, Pid;
    public IntPtr Heap;
    public uint Modulo, Threads, Pai;
    public int Prioridade;
    public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool Process32FirstW(IntPtr snap, ref Entrada e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  static extern bool Process32NextW(IntPtr snap, ref Entrada e);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);

  readonly int servico;
  readonly System.Collections.Generic.Dictionary<int, TimeSpan> antes = new System.Collections.Generic.Dictionary<int, TimeSpan>();
  DateTime quando;
  System.Collections.Generic.Dictionary<string, CounterSample> gpuAntes;
  public string Cpu = "...", Gpu = "...", Ram = "...";

  public Consumo(int servico) { this.servico = servico; }

  // Os processos do Trackeroao: as raizes e todos os descendentes delas.
  System.Collections.Generic.HashSet<int> Nossos() {
    System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>> filhos =
      new System.Collections.Generic.Dictionary<int, System.Collections.Generic.List<int>>();
    System.Collections.Generic.HashSet<int> raiz = new System.Collections.Generic.HashSet<int>();
    if (servico > 0) raiz.Add(servico);
    raiz.Add(Process.GetCurrentProcess().Id);
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    if (snap != IntPtr.Zero && snap != new IntPtr(-1)) {
      try {
        Entrada e = new Entrada();
        e.Tamanho = (uint)Marshal.SizeOf(typeof(Entrada));
        for (bool ok = Process32FirstW(snap, ref e); ok; ok = Process32NextW(snap, ref e)) {
          int pid = (int)e.Pid, pai = (int)e.Pai;
          if (String.Equals(e.Exe, "Trackeroao.exe", StringComparison.OrdinalIgnoreCase)) raiz.Add(pid);
          if (pid == pai) continue;
          System.Collections.Generic.List<int> l;
          if (!filhos.TryGetValue(pai, out l)) { l = new System.Collections.Generic.List<int>(); filhos[pai] = l; }
          l.Add(pid);
        }
      } finally { CloseHandle(snap); }
    }
    System.Collections.Generic.HashSet<int> todos = new System.Collections.Generic.HashSet<int>();
    System.Collections.Generic.Queue<int> fila = new System.Collections.Generic.Queue<int>(raiz);
    while (fila.Count > 0) {
      int p = fila.Dequeue();
      if (!todos.Add(p)) continue;
      System.Collections.Generic.List<int> l;
      if (filhos.TryGetValue(p, out l)) foreach (int f in l) fila.Enqueue(f);
    }
    return todos;
  }

  public void Zerar() { antes.Clear(); Cpu = Gpu = Ram = "..."; }

  public void Soltar() {
    gpuAntes = null;
  }

  public void Medir() {
    System.Collections.Generic.HashSet<int> nossos = Nossos();
    DateTime agora = DateTime.UtcNow;
    double cpuMs = 0; long bytes = 0;
    System.Collections.Generic.Dictionary<int, TimeSpan> novo = new System.Collections.Generic.Dictionary<int, TimeSpan>();
    foreach (int pid in nossos) {
      try {
        using (Process p = Process.GetProcessById(pid)) {
          TimeSpan t = p.TotalProcessorTime;
          novo[pid] = t;
          TimeSpan a;
          if (antes.TryGetValue(pid, out a)) cpuMs += (t - a).TotalMilliseconds;
        }
      } catch { }
    }
    double passou = (agora - quando).TotalMilliseconds;
    bool temAntes = antes.Count > 0 && passou > 0;
    antes.Clear();
    foreach (System.Collections.Generic.KeyValuePair<int, TimeSpan> kv in novo) antes[kv.Key] = kv.Value;
    quando = agora;
    if (temAntes) Cpu = (Math.Max(0, cpuMs) / passou / Environment.ProcessorCount * 100).ToString("0.0") + "%";
    bytes = Privada(nossos);
    Ram = bytes < 0 ? "-" : (bytes / 1048576.0).ToString("0") + " MB";
    Gpu = MedirGpu(nossos, temAntes);
  }

  /*
   * A memoria e a mesma do Gerenciador de Tarefas: o conjunto de trabalho
   * privado de cada processo. O conjunto de trabalho inteiro conta de novo,
   * em cada processo do WebView2, as paginas que eles dividem entre si, e a
   * soma sairia maior do que a memoria que o Trackeroao ocupa de fato.
   */
  static long Privada(System.Collections.Generic.HashSet<int> nossos) {
    try {
      InstanceDataCollectionCollection tudo = new PerformanceCounterCategory("Process").ReadCategory();
      InstanceDataCollection ids = tudo["ID Process"], priv = tudo["Working Set - Private"];
      if (ids == null || priv == null) return -1;
      long soma = 0;
      foreach (InstanceData d in ids.Values) {
        if (!nossos.Contains((int)d.RawValue)) continue;
        InstanceData w = priv[d.InstanceName];
        if (w != null) soma += w.RawValue;
      }
      return soma;
    } catch { return -1; }
  }

  string MedirGpu(System.Collections.Generic.HashSet<int> nossos, bool temAntes) {
    try {
      /*
       * Uma leitura so da categoria inteira por medida, em vez de um contador
       * por motor: a propria medida nao pode pesar no numero que ela mostra.
       * Como o Gerenciador de Tarefas: por tipo de motor, a soma dos
       * processos; o numero e o do motor mais ocupado.
       */
      InstanceDataCollection util = new PerformanceCounterCategory("GPU Engine").ReadCategory()["Utilization Percentage"];
      System.Collections.Generic.Dictionary<string, CounterSample> agora = new System.Collections.Generic.Dictionary<string, CounterSample>();
      System.Collections.Generic.Dictionary<string, double> porTipo = new System.Collections.Generic.Dictionary<string, double>();
      if (util != null) {
        foreach (InstanceData d in util.Values) {
          Match m = Regex.Match(d.InstanceName, "^pid_(\\d+)_.*engtype_(.+)$");
          if (!m.Success || !nossos.Contains(int.Parse(m.Groups[1].Value))) continue;
          agora[d.InstanceName] = d.Sample;
          CounterSample a;
          if (gpuAntes == null || !gpuAntes.TryGetValue(d.InstanceName, out a)) continue;
          double v = CounterSample.Calculate(a, d.Sample), soma;
          porTipo.TryGetValue(m.Groups[2].Value, out soma);
          porTipo[m.Groups[2].Value] = soma + v;
        }
      }
      bool tinha = gpuAntes != null;
      gpuAntes = agora;
      if (!tinha) return "...";
      double maior = 0;
      foreach (double v in porTipo.Values) if (v > maior) maior = v;
      return Math.Min(100, maior).ToString("0.0") + "%";
    } catch {
      return "-";
    }
  }
}

/*
 * O icone de "atualizando": o anel do Trackeroao aberto em arco, girando.
 * O icone de sempre tem o anel fechado; o arco so aparece enquanto uma
 * atualizacao pedida pela bandeja esta em andamento.
 */
class Girando {
  const int Quadros = 12;
  readonly Icon[] quadros = new Icon[Quadros];
  readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();
  readonly NotifyIcon icone;
  readonly Icon parado;
  int atual;
  DateTime desde;

  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

  public Girando(NotifyIcon icone, Icon parado, Size tamanho) {
    this.icone = icone;
    this.parado = parado;
    for (int i = 0; i < Quadros; i++) quadros[i] = Desenhar(tamanho.Width, i * 360f / Quadros);
    relogio.Interval = 80;
    relogio.Tick += delegate {
      // Sem resposta em tres minutos, o icone volta ao normal: girar para
      // sempre prometeria uma atualizacao que nao esta mais acontecendo.
      if (DateTime.Now - desde > TimeSpan.FromMinutes(3)) { Parar(); return; }
      atual = (atual + 1) % Quadros;
      icone.Icon = quadros[atual];
    };
  }

  public bool Ligado { get { return relogio.Enabled; } }

  public void Comecar() {
    desde = DateTime.Now;
    if (relogio.Enabled) return;
    atual = 0;
    icone.Icon = quadros[0];
    relogio.Start();
  }

  public void Parar() {
    relogio.Stop();
    icone.Icon = parado;
  }

  static Icon Desenhar(int n, float giro) {
    using (Bitmap bmp = new Bitmap(n, n, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.Clear(Color.Transparent);
      // Sem fundo: o anel ocupa o quadro inteiro, como o icone parado, com um
      // aro escuro fino que o deixa legivel tambem na barra clara.
      float raio = n * 0.39f, largura = n * 0.16f, c = n / 2f;
      RectangleF anel = new RectangleF(c - raio, c - raio, raio * 2, raio * 2);
      using (Pen aro = new Pen(Color.FromArgb(128, 11, 13, 18), largura + Math.Max(1.2f, n * 0.075f))) g.DrawEllipse(aro, anel);
      using (Pen trilho = new Pen(Color.FromArgb(70, 216, 255, 60), largura)) g.DrawEllipse(trilho, anel);
      using (Pen arco = new Pen(Color.FromArgb(255, 216, 255, 60), largura)) {
        arco.StartCap = arco.EndCap = LineCap.Round;
        g.DrawArc(arco, anel, -90 + giro, 270);
      }
      g.SmoothingMode = SmoothingMode.None;
      int bx = (int)Math.Round(n * 0.3125), by = bx, bw = n - 2 * bx, bh = Math.Max(2, (int)Math.Round(n * 0.13));
      int sw = Math.Max(2, (int)Math.Round(n * 0.14)), sx = (n - sw) / 2, sb = n - by;
      using (SolidBrush sombra = new SolidBrush(Color.FromArgb(128, 11, 13, 18))) {
        g.FillRectangle(sombra, bx - 1, by - 1, bw + 2, bh + 2);
        g.FillRectangle(sombra, sx - 1, by - 1, sw + 2, sb - by + 2);
      }
      g.FillRectangle(Brushes.White, bx, by, bw, bh);
      g.FillRectangle(Brushes.White, sx, by, sw, sb - by);
      IntPtr h = bmp.GetHicon();
      Icon copia = (Icon)Icon.FromHandle(h).Clone();
      DestroyIcon(h);
      return copia;
    }
  }
}

/*
 * No Windows 11, icone novo na bandeja nasce escondido no menu da seta. Na
 * primeira vez que o Windows registra o icone do Trackeroao, ele e posto a
 * vista; dali em diante a escolha e de quem usa: se for escondido a mao, fica
 * escondido. A marca "TrackeroaoVisivel", na propria entrada do Windows, e o
 * que diz que a primeira vez ja passou.
 */
static class Visivel {
  const string Chave = @"Control Panel\NotifyIconSettings";

  // true quando a entrada do Trackeroao ja foi achada (acertada agora ou antes).
  public static bool Acertar() {
    string meu = Application.ExecutablePath;
    string pasta = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(meu)));
    string fim = "\\" + pasta + "\\app\\" + Path.GetFileName(meu);
    bool achou = false;
    try {
      using (RegistryKey k = Registry.CurrentUser.OpenSubKey(Chave)) {
        if (k == null) return false;
        foreach (string nome in k.GetSubKeyNames()) {
          using (RegistryKey e = k.OpenSubKey(nome, true)) {
            if (e == null) continue;
            string exe = e.GetValue("ExecutablePath") as string;
            if (exe == null) continue;
            bool nosso = exe.Equals(meu, StringComparison.OrdinalIgnoreCase) ||
              exe.EndsWith(fim, StringComparison.OrdinalIgnoreCase);
            if (!nosso) continue;
            achou = true;
            if (e.GetValue("TrackeroaoVisivel") != null) continue;
            e.SetValue("IsPromoted", 1, RegistryValueKind.DWord);
            e.SetValue("TrackeroaoVisivel", 1, RegistryValueKind.DWord);
          }
        }
      }
    } catch { }
    return achou;
  }
}

/*
 * O icone da bandeja (Trackeroao.exe /bandeja /porta=8777 /pai=<pid>).
 *
 * Fica aceso enquanto o Trackeroao estiver de pe, e some quando o servico que
 * o chamou (o /pai) sai. Um clique abre a janela. O botao direito abre o menu
 * do Trackeroao, desenhado no estilo dele (escuro, com o limao de destaque),
 * como o da Steam: os jogos no topo, o consumo, "Abrir", "Forcar
 * atualizacao", "Iniciar com o Windows" e "Fechar". Os textos seguem o idioma
 * escolhido no globo da pagina (sync\idioma.json) ou, sem escolha, o do
 * Windows.
 */
static class Bandeja {
  // Idioma, forcar atualizacao, fechar, aviso de versao atual, abrir, iniciar com o Windows.
  static readonly string[][] Textos = new string[][] {
    new string[] { "en", "Force update", "Close", "You are on the latest version ({0}).", "Open Trackeroao", "Start with Windows" },
    new string[] { "pt-BR", "Forçar atualização", "Fechar", "Você já está na versão mais recente ({0}).", "Abrir o Trackeroao", "Iniciar com o Windows" },
    new string[] { "es", "Forzar actualización", "Cerrar", "Ya tienes la versión más reciente ({0}).", "Abrir Trackeroao", "Iniciar con Windows" },
    new string[] { "fr", "Forcer la mise à jour", "Fermer", "Vous avez déjà la dernière version ({0}).", "Ouvrir Trackeroao", "Lancer avec Windows" },
    new string[] { "de", "Update erzwingen", "Schließen", "Du hast bereits die neueste Version ({0}).", "Trackeroao öffnen", "Mit Windows starten" },
    new string[] { "it", "Forza aggiornamento", "Chiudi", "Hai già la versione più recente ({0}).", "Apri Trackeroao", "Avvia con Windows" },
    new string[] { "ru", "Принудительно обновить", "Закрыть", "У вас уже последняя версия ({0}).", "Открыть Trackeroao", "Запускать с Windows" },
    new string[] { "pl", "Wymuś aktualizację", "Zamknij", "Masz już najnowszą wersję ({0}).", "Otwórz Trackeroao", "Uruchamiaj z Windows" },
    new string[] { "tr", "Güncellemeyi zorla", "Kapat", "Zaten en güncel sürümdesiniz ({0}).", "Trackeroao'yu aç", "Windows ile başlat" },
    new string[] { "ja", "今すぐ更新", "閉じる", "最新バージョンです（{0}）。", "Trackeroao を開く", "Windows と同時に起動" },
    new string[] { "ko", "강제 업데이트", "닫기", "이미 최신 버전입니다({0}).", "Trackeroao 열기", "Windows 시작 시 실행" },
    new string[] { "zh-CN", "强制更新", "关闭", "已是最新版本（{0}）。", "打开 Trackeroao", "随 Windows 启动" },
  };

  static string[] Idioma(string sync) {
    string v = null;
    try {
      Match m = Regex.Match(File.ReadAllText(Path.Combine(sync, "idioma.json"), Encoding.UTF8), "\"idioma\"\\s*:\\s*\"([A-Za-z-]+)\"");
      if (m.Success) v = m.Groups[1].Value;
    } catch { }
    string sistema = System.Globalization.CultureInfo.CurrentUICulture.Name;
    string[] tentar = new string[] { v, sistema, sistema.Split('-')[0] == "pt" ? "pt-BR" : null,
      sistema.Split('-')[0] == "zh" ? "zh-CN" : null, sistema.Split('-')[0] };
    foreach (string c in tentar) {
      if (string.IsNullOrEmpty(c)) continue;
      foreach (string[] t in Textos) if (t[0].Equals(c, StringComparison.OrdinalIgnoreCase)) return t;
    }
    return Textos[0];
  }

  // A versao instalada, do versao.json que a instalacao e a atualizacao gravam.
  static string Versao(string raiz) {
    try {
      Match m = Regex.Match(File.ReadAllText(Path.Combine(raiz, "versao.json"), Encoding.UTF8), "\"tag\"\\s*:\\s*\"v?([^\"]+)\"");
      if (m.Success) return m.Groups[1].Value;
    } catch { }
    return null;
  }

  static string Postar(string url) {
    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
    r.Method = "POST";
    r.Timeout = 60000;
    r.Proxy = null;
    r.ContentLength = 0;
    using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
    using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) return sr.ReadToEnd();
  }

  static byte[] PegarBytes(string url) {
    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
    r.Timeout = 8000;
    r.Proxy = null;
    using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
    using (Stream s = resp.GetResponseStream())
    using (MemoryStream m = new MemoryStream()) { s.CopyTo(m); return m.ToArray(); }
  }

  static string Pegar(string url) {
    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
    r.Timeout = 3000;
    r.Proxy = null;
    using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
    using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) return sr.ReadToEnd();
  }

  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr janela, int atributo, ref int valor, int tamanho);

  public static void Rodar(string[] args) {
    int porta = 8777, pai = 0;
    foreach (string a in args) {
      if (a.StartsWith("/porta=")) int.TryParse(a.Substring(7), out porta);
      if (a.StartsWith("/pai=")) int.TryParse(a.Substring(5), out pai);
    }
    bool primeira;
    Mutex unica = new Mutex(true, "Local\\TrackeroaoBandeja", out primeira);
    if (!primeira) return;

    Application.EnableVisualStyles();
    string raiz = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
    string sync = Path.Combine(raiz, "sync");
    string comWindows = Path.Combine(sync, "iniciar-com-windows.flag");
    string[] t = Idioma(sync);
    string base_ = "http://127.0.0.1:" + porta + "/";

    NotifyIcon icone = new NotifyIcon();
    icone.Icon = Programa.Icone(SystemInformation.SmallIconSize) ?? SystemIcons.Application;
    Girando girando = new Girando(icone, icone.Icon, SystemInformation.SmallIconSize);
    // O nome e a versao instalada: no texto ao passar o mouse e no topo do menu.
    Func<string> nome = delegate { string v = Versao(raiz); return v == null ? "Trackeroao" : "Trackeroao " + v; };
    icone.Text = nome();

    Action<string> abrir = delegate(string ir) {
      try { Programa.AllowSetForegroundWindow(-1); } catch { }
      try {
        ProcessStartInfo p = new ProcessStartInfo(Application.ExecutablePath, ir == null ? "" : "/ir=" + ir);
        p.UseShellExecute = false;
        Process.Start(p);
      } catch { }
    };

    ContextMenuStrip menu = new ContextMenuStrip();
    Tema tema = new Tema();
    menu.Renderer = tema;
    menu.BackColor = Tema.Fundo;
    menu.ForeColor = Tema.Texto;
    menu.ShowImageMargin = true;
    menu.ShowCheckMargin = false;
    // A coluna das imagens e larga o bastante para o logotipo de cada jogo.
    menu.ImageScalingSize = new Size(44, 22);
    menu.Padding = new Padding(6, 8, 6, 8);
    menu.Font = new Font("Segoe UI", 9.5f);
    Font negrito = new Font("Segoe UI Semibold", 10f);

    Func<string, Image, ToolStripMenuItem> item = delegate(string texto, Image img) {
      ToolStripMenuItem i = new ToolStripMenuItem(texto, img);
      i.Padding = new Padding(4, 5, 4, 5);
      i.ImageScaling = ToolStripItemImageScaling.None;
      return i;
    };

    // O topo: o icone e o nome com a versao.
    Icon grande = Programa.Icone(new Size(20, 20));
    ToolStripMenuItem cabeca = item(nome(), grande != null ? grande.ToBitmap() : null);
    cabeca.Font = negrito;
    cabeca.Tag = "cabeca";
    cabeca.Click += delegate { abrir(null); };
    menu.Items.Add(cabeca);

    // Os jogos, como na Steam: um clique abre a pagina dele (ou a tela
    // inicial, para quem ainda nao tem pagina de progresso).
    ToolStripSeparator antesDosJogos = new ToolStripSeparator();
    menu.Items.Add(antesDosJogos);
    System.Collections.Generic.List<ToolStripItem> itensDeJogo = new System.Collections.Generic.List<ToolStripItem>();
    string[] jogos = new string[0];
    object trava = new object();
    // O logotipo oficial de cada jogo, de fundo transparente, pedido ao
    // servico uma vez por jogo; sem logotipo, fica o selo com a inicial.
    System.Collections.Generic.Dictionary<string, Bitmap> logos = new System.Collections.Generic.Dictionary<string, Bitmap>();
    Action lerJogos = delegate {
      ThreadPool.QueueUserWorkItem(delegate {
        try {
          string txt = Pegar(base_ + "bandeja.txt");
          string[] lidos = txt.Split(new char[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
          lock (trava) jogos = lidos;
          foreach (string linha in lidos) {
            string chave = linha.Split('\t')[0];
            lock (trava) { if (logos.ContainsKey(chave)) continue; }
            Bitmap logo = null;
            try { logo = Tema.Logo(PegarBytes(base_ + "logo-bandeja?chave=" + Uri.EscapeDataString(chave))); } catch { logo = null; }
            lock (trava) logos[chave] = logo;
          }
        } catch { }
      });
    };
    Action montarJogos = delegate {
      foreach (ToolStripItem velho in itensDeJogo) { menu.Items.Remove(velho); velho.Dispose(); }
      itensDeJogo.Clear();
      string[] lista;
      lock (trava) lista = jogos;
      int onde = menu.Items.IndexOf(antesDosJogos) + 1;
      foreach (string linha in lista) {
        string[] c = linha.Split('\t');
        if (c.Length < 3) continue;
        string chave = c[0], nomeJogo = c[1];
        bool temPagina = c[2] == "1";
        Bitmap logo = null;
        lock (trava) logos.TryGetValue(chave, out logo);
        ToolStripMenuItem j = item(nomeJogo, logo != null ? (Image)logo : Tema.Selo(nomeJogo));
        j.Click += delegate { abrir(temPagina ? "#" + chave : "#"); };
        menu.Items.Insert(onde++, j);
        itensDeJogo.Add(j);
      }
      if (itensDeJogo.Count > 0) {
        ToolStripSeparator s = new ToolStripSeparator();
        menu.Items.Insert(onde, s);
        itensDeJogo.Add(s);
      }
      antesDosJogos.Visible = itensDeJogo.Count > 0;
    };

    // O que o Trackeroao inteiro gasta agora (servico, janela, este icone e
    // o motor da pagina). O menu abre na hora: a medida roda por fora, a
    // cada segundo so enquanto ele estiver aberto, e os numeros chegam logo
    // depois.
    ToolStripMenuItem cpu = item("CPU   ...", null);
    ToolStripMenuItem gpu = item("GPU   ...", null);
    ToolStripMenuItem ram = item("RAM   ...", null);
    foreach (ToolStripMenuItem i in new ToolStripMenuItem[] { cpu, gpu, ram }) {
      i.Enabled = false;
      i.Padding = new Padding(4, 1, 4, 1);
      i.Font = new Font("Consolas", 9f);
      menu.Items.Add(i);
    }
    menu.Items.Add(new ToolStripSeparator());
    Consumo consumo = new Consumo(pai);
    int medindo = 0;
    bool aberto = false;
    Action medir = delegate {
      if (Interlocked.Exchange(ref medindo, 1) == 1) return;
      Thread th = new Thread(delegate() {
        try {
          while (aberto) {
            try { consumo.Medir(); } catch { }
            string c = consumo.Cpu, g = consumo.Gpu, r = consumo.Ram;
            try {
              menu.BeginInvoke((Action)delegate {
                cpu.Text = "CPU   " + c;
                gpu.Text = "GPU   " + g;
                ram.Text = "RAM   " + r;
              });
            } catch { }
            for (int k = 0; k < 10 && aberto; k++) Thread.Sleep(100);
          }
        } finally {
          consumo.Soltar();
          Interlocked.Exchange(ref medindo, 0);
        }
      });
      th.IsBackground = true;
      th.Start();
    };

    ToolStripMenuItem abrirItem = item(t[4], null);
    abrirItem.Click += delegate { abrir(null); };
    menu.Items.Add(abrirItem);

    ToolStripMenuItem atualizar = item(t[1], null);
    atualizar.Click += delegate {
      /*
       * O servico confere a release agora. Ja na ultima versao, um aviso
       * pequeno sai ao lado deste icone e some sozinho. Havendo versao nova,
       * ela e aplicada em silencio e o servico se reinicia. Enquanto isso, o
       * anel do icone abre em arco e gira.
       */
      girando.Comecar();
      ThreadPool.QueueUserWorkItem(delegate {
        bool nova = false;
        try {
          string j = Postar(base_ + "atualizar");
          nova = Regex.IsMatch(j, "\"atual\"\\s*:\\s*false");
          if (Regex.IsMatch(j, "\"atual\"\\s*:\\s*true")) {
            Match v = Regex.Match(j, "\"instalada\"\\s*:\\s*\"([^\"]*)\"");
            string texto = string.Format(t[3], v.Success ? v.Groups[1].Value : "");
            menu.BeginInvoke((Action)delegate { girando.Parar(); icone.ShowBalloonTip(4000, "Trackeroao", texto, ToolTipIcon.None); });
          }
        } catch { }
        if (!nova) { try { menu.BeginInvoke((Action)delegate { if (girando.Ligado) girando.Parar(); }); } catch { } }
      });
    };
    menu.Items.Add(atualizar);

    // Iniciar com o Windows: desmarcada, nada do Trackeroao sobe sozinho no
    // logon (o servico que a tarefa agendada chama sai na hora).
    ToolStripMenuItem iniciar = item(t[5], null);
    Action marcar = delegate { iniciar.Image = Tema.Caixa(File.Exists(comWindows)); };
    marcar();
    iniciar.Click += delegate {
      try {
        if (File.Exists(comWindows)) File.Delete(comWindows);
        else File.WriteAllText(comWindows, DateTime.Now.ToString("o"));
      } catch { }
      marcar();
    };
    menu.Items.Add(iniciar);

    menu.Items.Add(new ToolStripSeparator());
    ToolStripMenuItem fechar = item(t[2], null);
    fechar.Tag = "fechar";
    fechar.Click += delegate {
      /*
       * Fecha tudo de verdade: a janela, este icone e o servico. Nada volta
       * sozinho ate o Trackeroao ser aberto a mao (ou, com a caixa marcada,
       * ate o proximo logon).
       */
      EventWaitHandle sinal;
      if (EventWaitHandle.TryOpenExisting("Local\\TrackeroaoFechar", out sinal)) sinal.Set();
      try { File.WriteAllText(Path.Combine(sync, "fechado.flag"), DateTime.Now.ToString("o")); } catch { }
      try { Postar(base_ + "encerrar"); } catch { }
      icone.Visible = false;
      Application.Exit();
    };
    menu.Items.Add(fechar);

    menu.Opening += delegate {
      string n = nome();
      cabeca.Text = n;
      icone.Text = n;
      montarJogos();
      marcar();
      aberto = true;
      consumo.Zerar();
      cpu.Text = "CPU   ...";
      gpu.Text = "GPU   ...";
      ram.Text = "RAM   ...";
      medir();
    };
    menu.Closed += delegate { aberto = false; lerJogos(); };

    icone.ContextMenuStrip = menu;
    icone.MouseClick += delegate(object o, MouseEventArgs e) { if (e.Button == MouseButtons.Left) abrir(null); };
    // O menu precisa de identificador para o BeginInvoke do aviso.
    IntPtr h = menu.Handle;
    // Cantos arredondados no Windows 11, como os menus do sistema.
    int redondo = 2;
    try { DwmSetWindowAttribute(h, 33, ref redondo, 4); } catch { }
    lerJogos();
    icone.Visible = true;
    // Aceso de novo no meio de uma atualizacao (a troca da janela), segue girando.
    foreach (string a in args) if (a.Equals("/atualizando", StringComparison.OrdinalIgnoreCase)) girando.Comecar();

    // O Windows registra o icone alguns segundos depois de ele aparecer.
    System.Windows.Forms.Timer vista = new System.Windows.Forms.Timer();
    int tentativas = 0;
    vista.Interval = 2000;
    vista.Tick += delegate { if (Visivel.Acertar() || ++tentativas >= 30) vista.Stop(); };
    vista.Start();

    // Sem o servico que o chamou, o icone sai: icone orfao prometeria uma
    // aplicacao que nao esta mais la.
    if (pai > 0) {
      System.Windows.Forms.Timer vigia = new System.Windows.Forms.Timer();
      vigia.Interval = 2000;
      vigia.Tick += delegate {
        bool vivo = true;
        try { vivo = !Process.GetProcessById(pai).HasExited; } catch { vivo = false; }
        if (!vivo) { icone.Visible = false; Application.Exit(); }
      };
      vigia.Start();
    }
    Application.Run();
    icone.Dispose();
    GC.KeepAlive(unica);
    GC.KeepAlive(h);
  }
}

/*
 * O desenho do menu da bandeja: o vidro escuro do Trackeroao, texto claro, o
 * limao como destaque do item sob o mouse, e cada jogo com um selo da cor
 * dele e a inicial, como os icones da lista da Steam.
 */
class Tema : ToolStripProfessionalRenderer {
  public static readonly Color Fundo = Color.FromArgb(17, 19, 24);
  public static readonly Color Borda = Color.FromArgb(44, 47, 56);
  public static readonly Color Texto = Color.FromArgb(236, 238, 242);
  public static readonly Color Apagado = Color.FromArgb(150, 154, 164);
  public static readonly Color Limao = Color.FromArgb(216, 255, 60);

  public Tema() : base(new Cores()) { RoundedEdges = false; }

  class Cores : ProfessionalColorTable {
    public override Color ToolStripDropDownBackground { get { return Fundo; } }
    public override Color ImageMarginGradientBegin { get { return Fundo; } }
    public override Color ImageMarginGradientMiddle { get { return Fundo; } }
    public override Color ImageMarginGradientEnd { get { return Fundo; } }
    public override Color MenuBorder { get { return Borda; } }
    public override Color SeparatorDark { get { return Borda; } }
    public override Color SeparatorLight { get { return Fundo; } }
  }

  static GraphicsPath Arredondado(Rectangle r, int raio) {
    GraphicsPath p = new GraphicsPath();
    int d = raio * 2;
    p.AddArc(r.X, r.Y, d, d, 180, 90);
    p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
    p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
    p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
    p.CloseFigure();
    return p;
  }

  protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e) {
    using (SolidBrush b = new SolidBrush(Fundo)) e.Graphics.FillRectangle(b, e.AffectedBounds);
  }

  protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e) {
    Rectangle r = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
    using (Pen p = new Pen(Borda)) e.Graphics.DrawRectangle(p, r);
  }

  protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

  protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e) {
    if (!e.Item.Selected || !e.Item.Enabled) return;
    Rectangle r = new Rectangle(2, 1, e.Item.Width - 4, e.Item.Height - 2);
    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
    bool fechar = "fechar".Equals(e.Item.Tag);
    Color cor = fechar ? Color.FromArgb(60, 232, 17, 35) : Color.FromArgb(34, Limao);
    using (GraphicsPath p = Arredondado(r, 6))
    using (SolidBrush b = new SolidBrush(cor)) e.Graphics.FillPath(b, p);
  }

  protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e) {
    int y = e.Item.Height / 2;
    using (Pen p = new Pen(Borda)) e.Graphics.DrawLine(p, 10, y, e.Item.Width - 10, y);
  }

  protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e) {
    if ("cabeca".Equals(e.Item.Tag)) e.TextColor = Texto;
    else if (!e.Item.Enabled) e.TextColor = Apagado;
    else e.TextColor = e.Item.Selected && !"fechar".Equals(e.Item.Tag) ? Limao : Texto;
    base.OnRenderItemText(e);
  }

  protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e) { }

  // O logotipo de um jogo: o PNG transparente, sem a margem vazia em volta,
  // encaixado sem deformar numa faixa de 44 x 22. Null se nao for imagem.
  public static Bitmap Logo(byte[] png) {
    if (png == null || png.Length < 8) return null;
    using (MemoryStream m = new MemoryStream(png))
    using (Bitmap orig = new Bitmap(m)) {
      Bitmap src = new Bitmap(orig.Width, orig.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(src)) g.DrawImage(orig, 0, 0, orig.Width, orig.Height);
      int x0 = src.Width, y0 = src.Height, x1 = -1, y1 = -1;
      System.Drawing.Imaging.BitmapData d = src.LockBits(new Rectangle(0, 0, src.Width, src.Height),
        System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      byte[] px = new byte[d.Stride * src.Height];
      Marshal.Copy(d.Scan0, px, 0, px.Length);
      src.UnlockBits(d);
      for (int y = 0; y < src.Height; y++) {
        for (int x = 0; x < src.Width; x++) {
          if (px[y * d.Stride + x * 4 + 3] > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { src.Dispose(); return null; }
      Rectangle corte = new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      float escala = Math.Min(44f / corte.Width, 22f / corte.Height);
      int w = Math.Max(1, (int)Math.Round(corte.Width * escala)), h = Math.Max(1, (int)Math.Round(corte.Height * escala));
      Bitmap bmp = new Bitmap(44, 22, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(bmp)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.DrawImage(src, new Rectangle((44 - w) / 2, (22 - h) / 2, w, h), corte, GraphicsUnit.Pixel);
      }
      src.Dispose();
      return bmp;
    }
  }

  // O selo de um jogo: um quadrado arredondado na cor tirada do nome, com a inicial.
  public static Bitmap Selo(string nome) {
    int h = 0;
    foreach (char c in nome) h = h * 31 + c;
    float matiz = (h & 0x7fffffff) % 360;
    Bitmap bmp = new Bitmap(20, 20, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
      using (GraphicsPath p = Arredondado(new Rectangle(0, 0, 19, 19), 5))
      using (LinearGradientBrush b = new LinearGradientBrush(new Rectangle(0, 0, 20, 20), DeMatiz(matiz, 0.55f), DeMatiz(matiz + 30, 0.32f), 45f))
        g.FillPath(b, p);
      string letra = nome.Length > 0 ? nome.Substring(0, 1).ToUpperInvariant() : "?";
      using (Font f = new Font("Segoe UI Semibold", 9f))
      using (StringFormat sf = new StringFormat()) {
        sf.Alignment = StringAlignment.Center;
        sf.LineAlignment = StringAlignment.Center;
        g.DrawString(letra, f, Brushes.White, new RectangleF(0, 0, 20, 20), sf);
      }
    }
    return bmp;
  }

  // A caixa de "Iniciar com o Windows": vazia, ou cheia de limao com o visto.
  public static Bitmap Caixa(bool marcada) {
    Bitmap bmp = new Bitmap(20, 20, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (Graphics g = Graphics.FromImage(bmp)) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      Rectangle r = new Rectangle(2, 2, 15, 15);
      using (GraphicsPath p = Arredondado(r, 4)) {
        if (marcada) {
          using (SolidBrush b = new SolidBrush(Limao)) g.FillPath(b, p);
          using (Pen v = new Pen(Color.FromArgb(12, 15, 2), 2f)) {
            v.StartCap = v.EndCap = LineCap.Round;
            g.DrawLines(v, new PointF[] { new PointF(5.5f, 10f), new PointF(8.5f, 13f), new PointF(14f, 6.5f) });
          }
        } else {
          using (Pen b = new Pen(Apagado, 1.4f)) g.DrawPath(b, p);
        }
      }
    }
    return bmp;
  }

  static Color DeMatiz(float matiz, float luz) {
    matiz = ((matiz % 360) + 360) % 360;
    float s = 0.6f, c = (1 - Math.Abs(2 * luz - 1)) * s, x = c * (1 - Math.Abs((matiz / 60) % 2 - 1)), m = luz - c / 2;
    float r = 0, g = 0, b = 0;
    if (matiz < 60) { r = c; g = x; } else if (matiz < 120) { r = x; g = c; } else if (matiz < 180) { g = c; b = x; }
    else if (matiz < 240) { g = x; b = c; } else if (matiz < 300) { r = x; b = c; } else { r = c; b = x; }
    return Color.FromArgb((int)((r + m) * 255), (int)((g + m) * 255), (int)((b + m) * 255));
  }
}

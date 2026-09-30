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

  [STAThread]
  static void Main(string[] args) {
    foreach (string a in args) {
      if (a.Equals("/bandeja", StringComparison.OrdinalIgnoreCase)) { Bandeja.Rodar(args); return; }
    }
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
  [DllImport("user32.dll")]
  static extern int GetSystemMetrics(int indice);
  [DllImport("user32.dll")]
  static extern bool SetWindowPos(IntPtr janela, IntPtr depois, int x, int y, int l, int a, uint opcoes);

  [StructLayout(LayoutKind.Sequential)]
  struct Retangulo { public int Esq, Topo, Dir, Base; }

  const int WM_NCCALCSIZE = 0x83, WM_NCHITTEST = 0x84;
  const int HTCLIENT = 1, HTCAPTION = 2, HTTOP = 12, HTTOPLEFT = 13, HTTOPRIGHT = 14;

  readonly Barra barra;

  public Janela() {
    Text = "Trackeroao";
    BackColor = Fundo;
    // O icone da barra de tarefas: o do .exe, que traz todos os tamanhos.
    try {
      string ico = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath)), "instalador\\icone\\trackeroao.ico");
      Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    } catch { }
    AutoScaleMode = AutoScaleMode.Dpi;
    StartPosition = FormStartPosition.CenterScreen;
    Rectangle tela = Screen.PrimaryScreen.WorkingArea;
    Size = new Size(Math.Min(1320, tela.Width - 80), Math.Min(860, tela.Height - 60));
    MinimumSize = new Size(420, 560);

    barra = new Barra(this);

    web = new WebView2();
    web.Dock = DockStyle.Fill;
    web.DefaultBackgroundColor = Fundo;
    // A pasta de dados do componente e uma so, sempre a mesma: nada se
    // acumula de uma abertura para a outra.
    web.CreationProperties = new CoreWebView2CreationProperties();
    web.CreationProperties.UserDataFolder = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "trackeroao", "webview");
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
    Resize += delegate { barra.Invalidate(); };
    // O contorno da janela acompanha a barra enquanto ela troca de cor.
    barra.Mudou += delegate(Color c) {
      if (!IsHandleCreated) return;
      int v = c.R | (c.G << 8) | (c.B << 16);
      try { DwmSetWindowAttribute(Handle, 34, ref v, 4); } catch { }
    };
    Shown += async delegate { await Abrir(); };
    Vigiar(mostrar, delegate {
      if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
      Show(); Activate(); BringToFront();
    });
    Vigiar(fechar, delegate { Close(); });
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
      if (m.Result.ToInt32() != HTCLIENT) return;
      Point p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
      if (WindowState != FormWindowState.Maximized && p.Y < Moldura(true)) {
        int canto = Moldura(false) * 2;
        m.Result = (IntPtr)(p.X < canto ? HTTOPLEFT : p.X > ClientSize.Width - canto ? HTTOPRIGHT : HTTOP);
        return;
      }
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

/*
 * A barra do Trackeroao: o icone, o nome e os botoes de minimizar, maximizar
 * e fechar, desenhados no escuro do aplicativo. O nome e titulo e nao muda com
 * o idioma. Fora dos botoes ela e transparente para o Windows, que ali trata
 * o clique como barra de titulo (ver WndProc da Janela).
 */
class Barra : Control {
  static readonly Color Inicial = Color.FromArgb(10, 11, 15);
  static readonly Color Fechar = Color.FromArgb(232, 17, 35);

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
  Color Linha { get { return Misturar(fundo, Claro ? Color.Black : Color.White, 0.07); } }

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

  int LarguraBotao { get { return (int)Math.Round(Height * 46.0 / 36.0); } }

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
    using (Pen p = new Pen(Linha)) g.DrawLine(p, 0, Height - 1, Width, Height - 1);

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

    g.SmoothingMode = SmoothingMode.None;
    for (int i = 0; i < 3; i++) {
      Rectangle b = Botao(i);
      Color cor = Apagado;
      if (i == sob) {
        Color realce = i == 2 ? Fechar : (Claro ? Color.FromArgb(apertado == i ? 36 : 22, 0, 0, 0) : Color.FromArgb(apertado == i ? 44 : 30, 255, 255, 255));
        using (SolidBrush br = new SolidBrush(realce)) g.FillRectangle(br, b);
        cor = i == 2 ? Color.White : Texto;
      }
      int cx = b.X + b.Width / 2, cy = b.Y + b.Height / 2, m = (int)Math.Round(5 * k);
      using (Pen p = new Pen(cor, Math.Max(1f, k))) {
        if (i == 0) g.DrawLine(p, cx - m, cy, cx + m, cy);
        else if (i == 1) {
          if (dona.WindowState == FormWindowState.Maximized) {
            int d = (int)Math.Round(2 * k);
            g.DrawRectangle(p, cx - m, cy - m + d, 2 * m - d, 2 * m - d);
            g.DrawLine(p, cx - m + d, cy - m, cx + m, cy - m);
            g.DrawLine(p, cx + m, cy - m, cx + m, cy + m - d);
          } else g.DrawRectangle(p, cx - m, cy - m, 2 * m, 2 * m);
        } else {
          g.SmoothingMode = SmoothingMode.AntiAlias;
          g.DrawLine(p, cx - m, cy - m, cx + m, cy + m);
          g.DrawLine(p, cx - m, cy + m, cx + m, cy - m);
          g.SmoothingMode = SmoothingMode.None;
        }
      }
    }
  }
}

/*
 * O icone da bandeja (Trackeroao.exe /bandeja /porta=8777 /pai=<pid>).
 *
 * Aparece quando um jogo escolhido abre, ou quando o Trackeroao e aberto a
 * mao, e some quando o servico que o chamou (o /pai) sai. Dois cliques abrem
 * a janela; o botao direito oferece "Forcar atualizacao" e "Fechar". Os
 * textos seguem o idioma escolhido no globo da pagina (sync\idioma.json) ou,
 * sem escolha, o do Windows.
 */
static class Bandeja {
  static readonly string[][] Textos = new string[][] {
    new string[] { "en", "Force update", "Close", "You are on the latest version ({0})." },
    new string[] { "pt-BR", "Forçar atualização", "Fechar", "Você já está na versão mais recente ({0})." },
    new string[] { "es", "Forzar actualización", "Cerrar", "Ya tienes la versión más reciente ({0})." },
    new string[] { "fr", "Forcer la mise à jour", "Fermer", "Vous avez déjà la dernière version ({0})." },
    new string[] { "de", "Update erzwingen", "Schließen", "Du hast bereits die neueste Version ({0})." },
    new string[] { "it", "Forza aggiornamento", "Chiudi", "Hai già la versione più recente ({0})." },
    new string[] { "ru", "Принудительно обновить", "Закрыть", "У вас уже последняя версия ({0})." },
    new string[] { "pl", "Wymuś aktualizację", "Zamknij", "Masz już najnowszą wersję ({0})." },
    new string[] { "tr", "Güncellemeyi zorla", "Kapat", "Zaten en güncel sürümdesiniz ({0})." },
    new string[] { "ja", "今すぐ更新", "閉じる", "最新バージョンです（{0}）。" },
    new string[] { "ko", "강제 업데이트", "닫기", "이미 최신 버전입니다({0})." },
    new string[] { "zh-CN", "强制更新", "关闭", "已是最新版本（{0}）。" },
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
    string[] t = Idioma(sync);
    string base_ = "http://127.0.0.1:" + porta + "/";

    NotifyIcon icone = new NotifyIcon();
    icone.Icon = Programa.Icone(SystemInformation.SmallIconSize) ?? SystemIcons.Application;
    // O nome e a versao instalada: no texto ao passar o mouse e no topo do menu.
    Func<string> nome = delegate { string v = Versao(raiz); return v == null ? "Trackeroao" : "Trackeroao " + v; };
    icone.Text = nome();

    ContextMenuStrip menu = new ContextMenuStrip();
    ToolStripItem versao = menu.Items.Add(nome());
    versao.Enabled = false;
    menu.Items.Add(new ToolStripSeparator());
    menu.Opening += delegate { string n = nome(); versao.Text = n; icone.Text = n; };
    ToolStripItem atualizar = menu.Items.Add(t[1]);
    atualizar.Click += delegate {
      /*
       * O servico confere a release agora. Ja na ultima versao, um aviso
       * pequeno sai ao lado deste icone e some sozinho. Havendo versao nova,
       * ela e aplicada em silencio e o servico se reinicia.
       */
      ThreadPool.QueueUserWorkItem(delegate {
        try {
          string j = Postar(base_ + "atualizar");
          if (Regex.IsMatch(j, "\"atual\"\\s*:\\s*true")) {
            Match v = Regex.Match(j, "\"instalada\"\\s*:\\s*\"([^\"]*)\"");
            string texto = string.Format(t[3], v.Success ? v.Groups[1].Value : "");
            menu.BeginInvoke((Action)delegate { icone.ShowBalloonTip(4000, "Trackeroao", texto, ToolTipIcon.None); });
          }
        } catch { }
      });
    };
    menu.Items.Add(new ToolStripSeparator());
    ToolStripItem fechar = menu.Items.Add(t[2]);
    fechar.Click += delegate {
      /*
       * Fecha tudo de verdade: a janela, este icone e o servico. Nada volta
       * sozinho -- nem no logon, nem com o jogo -- ate o Trackeroao ser aberto
       * a mao. A marca e escrita aqui tambem, para valer mesmo com o servico
       * sem responder.
       */
      EventWaitHandle sinal;
      if (EventWaitHandle.TryOpenExisting("Local\\TrackeroaoFechar", out sinal)) sinal.Set();
      try { File.WriteAllText(Path.Combine(sync, "fechado.flag"), DateTime.Now.ToString("o")); } catch { }
      try { Postar(base_ + "encerrar"); } catch { }
      icone.Visible = false;
      Application.Exit();
    };
    icone.ContextMenuStrip = menu;
    icone.MouseDoubleClick += delegate {
      try { Process.Start(new ProcessStartInfo(Application.ExecutablePath) { UseShellExecute = false }); } catch { }
    };
    // O menu precisa de identificador para o BeginInvoke do aviso.
    IntPtr h = menu.Handle;
    icone.Visible = true;

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

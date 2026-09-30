import UIKit
import WebKit

/*
 * O aplicativo de iOS: uma tela só, com a página que o computador serve na
 * rede de casa, como o aplicativo de Android. Toda a página passa pela Ponte
 * (esquema trackeroao://), que acha o computador, guarda a última cópia de
 * cada arquivo e a entrega quando o computador está fora do alcance.
 */
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = Principal.fundo
        w.rootViewController = Principal()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class Principal: UIViewController, WKNavigationDelegate {
    static let fundo = UIColor(red: 6 / 255, green: 7 / 255, blue: 10 / 255, alpha: 1)
    static let inicio = URL(string: "trackeroao://app/")!

    private var web: WKWebView!
    private let ponte = Ponte()

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(ponte, forURLScheme: "trackeroao")
        cfg.websiteDataStore = .default()
        // Os gestos de voltar e avançar ficam com a página (ligarGestos), que
        // fecha primeiro o que estiver aberto por cima dela.
        let aviso = WKUserScript(source: "window.TRACKEROAO_GESTOS = true;",
                                 injectionTime: .atDocumentStart, forMainFrameOnly: true)
        cfg.userContentController.addUserScript(aviso)
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.isOpaque = false
        web.backgroundColor = Principal.fundo
        web.scrollView.backgroundColor = Principal.fundo
        web.scrollView.contentInsetAdjustmentBehavior = .never
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: Principal.inicio))
    }

    // Link para outro site abre no Safari; dentro do aplicativo fica só o Trackeroao.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let esquema = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        if esquema == "trackeroao" || esquema == "about" || !action.targetFrameIsMain {
            decisionHandler(.allow)
            return
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }
}

private extension WKNavigationAction {
    var targetFrameIsMain: Bool { targetFrame?.isMainFrame ?? true }
}

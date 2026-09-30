import Foundation
import WebKit
import CryptoKit

/*
 * Ponte: atende o esquema trackeroao:// buscando cada arquivo no computador,
 * pela rede de casa (http://trackeroao.local:8777, o nome que o serviço
 * anuncia por mDNS). Cada GET que dá certo vira cópia local; com o computador
 * desligado ou longe, a página abre com a última cópia. O telefone só lê:
 * nenhum pedido que altere o computador passa daqui.
 */
final class Ponte: NSObject, WKURLSchemeHandler {
    static let base = "http://trackeroao.local:8777"

    private let sessao: URLSession
    private let pasta: URL
    private var ativas = Set<ObjectIdentifier>()
    private let trava = NSLock()

    override init() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 5
        c.timeoutIntervalForResource = 15
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.connectionProxyDictionary = [:]
        sessao = URLSession(configuration: c)
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        pasta = caches.appendingPathComponent("copia", isDirectory: true)
        try? FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        super.init()
    }

    func webView(_ webView: WKWebView, start tarefa: WKURLSchemeTask) {
        let id = ObjectIdentifier(tarefa)
        trava.lock(); ativas.insert(id); trava.unlock()

        guard let url = tarefa.request.url,
              let partes = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            responder(tarefa, 400, "text/plain", Data(), nil)
            return
        }
        var caminho = partes.percentEncodedPath
        if caminho.isEmpty { caminho = "/" }
        let alvo = partes.percentEncodedQuery.map { caminho + "?" + $0 } ?? caminho
        let principal = tarefa.request.mainDocumentURL == url

        if (tarefa.request.httpMethod ?? "GET").uppercased() != "GET" {
            responder(tarefa, 405, "text/plain", Data(), nil)
            return
        }
        guard let destino = URL(string: Ponte.base + alvo) else {
            responder(tarefa, 400, "text/plain", Data(), nil)
            return
        }
        sessao.dataTask(with: URLRequest(url: destino)) { [weak self] dados, resposta, erro in
            guard let self = self else { return }
            if erro == nil, let r = resposta as? HTTPURLResponse, let dados = dados {
                let tipo = r.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
                if (200..<300).contains(r.statusCode) { self.guardar(caminho, tipo, dados) }
                self.responder(tarefa, r.statusCode, tipo, dados, r.value(forHTTPHeaderField: "x-trackeroao-pagina"))
                return
            }
            // Computador fora do alcance: a última cópia, se houver.
            if let c = self.ler(caminho) {
                self.responder(tarefa, 200, c.tipo, c.dados, nil)
            } else if principal || caminho == "/" {
                self.responder(tarefa, 200, "text/html; charset=utf-8", Data(Ponte.espera.utf8), nil)
            } else {
                self.responder(tarefa, 503, "text/plain", Data(), nil)
            }
        }.resume()
    }

    func webView(_ webView: WKWebView, stop tarefa: WKURLSchemeTask) {
        trava.lock(); ativas.remove(ObjectIdentifier(tarefa)); trava.unlock()
    }

    private func responder(_ tarefa: WKURLSchemeTask, _ status: Int, _ tipo: String, _ dados: Data, _ pagina: String?) {
        DispatchQueue.main.async {
            let id = ObjectIdentifier(tarefa)
            self.trava.lock()
            let viva = self.ativas.remove(id) != nil
            self.trava.unlock()
            guard viva, let url = tarefa.request.url else { return }
            var cab = ["Content-Type": tipo, "Cache-Control": "no-store", "Content-Length": String(dados.count)]
            if let p = pagina { cab["x-trackeroao-pagina"] = p }
            let r = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: cab)!
            tarefa.didReceive(r)
            tarefa.didReceive(dados)
            tarefa.didFinish()
        }
    }

    // --- cópia local -------------------------------------------------------

    private func arquivo(_ caminho: String) -> URL {
        let h = Insecure.SHA1.hash(data: Data(caminho.utf8)).map { String(format: "%02x", $0) }.joined()
        return pasta.appendingPathComponent(h)
    }

    private func guardar(_ caminho: String, _ tipo: String, _ dados: Data) {
        let f = arquivo(caminho)
        try? dados.write(to: f, options: .atomic)
        try? Data(tipo.utf8).write(to: f.appendingPathExtension("tipo"), options: .atomic)
    }

    private func ler(_ caminho: String) -> (tipo: String, dados: Data)? {
        let f = arquivo(caminho)
        guard let dados = try? Data(contentsOf: f) else { return nil }
        let tipo = (try? String(contentsOf: f.appendingPathExtension("tipo"), encoding: .utf8)) ?? "application/octet-stream"
        return (tipo, dados)
    }

    // A tela de espera, enquanto o computador não responde e não há cópia.
    static let espera = """
    <!doctype html><html><head><meta charset=utf-8>\
    <meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'>\
    <style>html,body{margin:0;height:100%;background:#06070a;color:#e8e8ec}\
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;\
    font:600 34px/1 system-ui,-apple-system,sans-serif;letter-spacing:-.02em}\
    .b{margin-top:22px;width:64px;height:3px;border-radius:2px;background:#d8ff3c;\
    animation:p 1.6s ease-in-out infinite}\
    @keyframes p{0%,100%{opacity:.15;transform:scaleX(.5)}50%{opacity:.8;transform:scaleX(1)}}\
    </style></head><body><div>Tracker<span style=color:#d8ff3c>oao</span></div><div class=b></div>\
    <script>setTimeout(function(){location.reload()},4000)</script></body></html>
    """
}

package com.oaovito.trackeroao;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/*
 * Ponte - todo pedido da página passa por aqui.
 *
 * A página acha que está em http://trackeroao.local/ e nunca fica sabendo do
 * IP: este lado descobre onde o computador está e busca lá. Assim a origem da
 * página é sempre a mesma (o localStorage não se perde quando o IP muda) e
 * não existe endereço nenhum à vista.
 *
 * Cada GET que dá certo vira cópia local, um arquivo por caminho, trocado no
 * lugar. Com o computador desligado, a página abre com a última leitura.
 */
final class Ponte {

    private final Localizador localizador;
    private final File pasta;

    Ponte(Context ctx, Localizador localizador) {
        this.localizador = localizador;
        this.pasta = new File(ctx.getFilesDir(), "copia");
        // noinspection ResultOfMethodCallIgnored
        pasta.mkdirs();
    }

    WebResourceResponse atender(WebResourceRequest req) {
        Uri uri = req.getUrl();
        String caminho = uri.getEncodedPath();
        if (caminho == null || caminho.isEmpty()) caminho = "/";
        String consulta = uri.getEncodedQuery();
        String alvo = consulta == null ? caminho : caminho + "?" + consulta;

        // O telefone só lê. Mudar alguma coisa é coisa do computador (e ele
        // mesmo recusa POST que não venha dele).
        if (!"GET".equalsIgnoreCase(req.getMethod())) {
            return resposta(405, "Method Not Allowed", "text/plain", new byte[0]);
        }

        // Duas voltas: se o IP guardado morreu, a segunda já usa o novo.
        for (int volta = 0; volta < 2; volta++) {
            String ip = localizador.ip();
            if (ip == null) break;
            try {
                Busca b = buscar(ip, alvo);
                if (b.status >= 200 && b.status < 300) guardar(caminho, b.tipo, b.corpo);
                // A página não precisa ver redirecionamento; e o WebView recusa 3xx aqui.
                if (b.status >= 300 && b.status < 400) break;
                WebResourceResponse r = resposta(b.status, "OK", b.tipo, b.corpo);
                // A versão da página que o computador serve: com ela a página
                // aberta no aplicativo se recarrega sozinha depois de uma atualização.
                if (b.pagina != null) r.getResponseHeaders().put("x-trackeroao-pagina", b.pagina);
                return r;
            } catch (IOException e) {
                localizador.esquecer(ip);
            }
        }

        // Computador fora do alcance: a última cópia, se houver.
        Copia c = ler(caminho);
        if (c != null) return resposta(200, "OK", c.tipo, c.corpo);
        if (req.isForMainFrame() || "/".equals(caminho)) {
            return resposta(200, "OK", "text/html; charset=utf-8", ESPERA.getBytes(StandardCharsets.UTF_8));
        }
        return resposta(503, "Service Unavailable", "text/plain", new byte[0]);
    }

    // --- rede ---------------------------------------------------------------

    private static final class Busca {
        int status;
        String tipo;
        String pagina;
        byte[] corpo;
    }

    private static Busca buscar(String ip, String alvo) throws IOException {
        URL u = new URL("http://" + ip + ":" + Localizador.PORTA + alvo);
        // NO_PROXY: um proxy configurado no Wi-Fi não sabe chegar a um IP da casa.
        HttpURLConnection c = (HttpURLConnection) u.openConnection(Proxy.NO_PROXY);
        try {
            c.setConnectTimeout(2000);
            c.setReadTimeout(5000);
            c.setUseCaches(false);
            Busca b = new Busca();
            b.status = c.getResponseCode();
            b.tipo = c.getContentType();
            b.pagina = c.getHeaderField("x-trackeroao-pagina");
            InputStream in = b.status >= 400 ? c.getErrorStream() : c.getInputStream();
            b.corpo = in == null ? new byte[0] : tudo(in);
            return b;
        } finally {
            c.disconnect();
        }
    }

    private static byte[] tudo(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    // --- cópia local --------------------------------------------------------

    private static final class Copia {
        String tipo;
        byte[] corpo;
    }

    /** Nome do arquivo: hash do caminho, que é curto e nunca tem barra. A consulta fica de fora. */
    private File arquivo(String caminho) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-1").digest(caminho.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte x : h) sb.append(String.format("%02x", x & 0xff));
            return new File(pasta, sb.toString());
        } catch (Exception e) {
            return new File(pasta, Integer.toHexString(caminho.hashCode()));
        }
    }

    /**
     * Grava num temporário e renomeia por cima: quem estiver lendo ao mesmo
     * tempo vê a cópia velha inteira ou a nova inteira, nunca a metade.
     */
    private void guardar(String caminho, String tipo, byte[] corpo) {
        File dest = arquivo(caminho);
        File tmp = new File(pasta, dest.getName() + ".tmp");
        try {
            DataOutputStream out = new DataOutputStream(new FileOutputStream(tmp));
            try {
                out.writeUTF(tipo == null ? "" : tipo);
                out.write(corpo);
            } finally {
                out.close();
            }
            if (!tmp.renameTo(dest)) tmp.delete();
        } catch (IOException e) {
            // noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    private Copia ler(String caminho) {
        File f = arquivo(caminho);
        if (!f.isFile()) return null;
        try {
            DataInputStream in = new DataInputStream(new FileInputStream(f));
            try {
                Copia c = new Copia();
                c.tipo = in.readUTF();
                c.corpo = tudo(in);
                return c;
            } finally {
                in.close();
            }
        } catch (IOException e) {
            return null;
        }
    }

    // --- resposta -----------------------------------------------------------

    /** "text/html; charset=utf-8" chega junto; o WebView quer tipo e charset separados. */
    private static WebResourceResponse resposta(int status, String motivo, String tipo, byte[] corpo) {
        String mime = "application/octet-stream";
        String charset = null;
        if (tipo != null && !tipo.isEmpty()) {
            String[] partes = tipo.split(";");
            mime = partes[0].trim();
            for (int i = 1; i < partes.length; i++) {
                String p = partes[i].trim();
                if (p.regionMatches(true, 0, "charset=", 0, 8)) charset = p.substring(8).replace("\"", "").trim();
            }
        }
        Map<String, String> cab = new HashMap<>();
        cab.put("Cache-Control", "no-store");
        return new WebResourceResponse(mime, charset, status, motivo, cab, new ByteArrayInputStream(corpo));
    }

    /**
     * Primeira abertura sem o computador por perto e sem cópia guardada.
     * Nada de texto nem de endereço: só o nome, uma barra pulsando, e uma nova
     * tentativa a cada poucos segundos.
     */
    private static final String ESPERA =
        "<!doctype html><html><head><meta charset=utf-8>"
        + "<meta name=viewport content='width=device-width,initial-scale=1'>"
        + "<style>"
        + "html,body{margin:0;height:100%;background:#06070a;color:#e8e8ec}"
        + "body{display:flex;flex-direction:column;align-items:center;justify-content:center;"
        + "font:600 34px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:-.02em}"
        + ".b{margin-top:22px;width:64px;height:3px;border-radius:2px;background:#d8ff3c;"
        + "animation:p 1.6s ease-in-out infinite}"
        + "@keyframes p{0%,100%{opacity:.15;transform:scaleX(.5)}50%{opacity:.8;transform:scaleX(1)}}"
        + "</style></head><body>"
        + "<div>Tracker<span style=color:#d8ff3c>oao</span></div><div class=b></div>"
        + "<script>setTimeout(function(){location.reload()},4000)</script>"
        + "</body></html>";
}

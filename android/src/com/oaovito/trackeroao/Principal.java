package com.oaovito.trackeroao;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/*
 * Principal - a tela única: um WebView ocupando tudo.
 *
 * O endereço carregado é sempre o mesmo, http://trackeroao.local/, e nenhum
 * pedido para ele sai de fato para a rede pelo WebView: a Ponte atende todos.
 * Link para outro site abre no navegador do sistema.
 */
public final class Principal extends Activity {

    static final String INICIO = "http://" + Localizador.NOME + "/";
    private static final int FUNDO = 0xFF06070A;

    private WebView web;
    private Ponte ponte;

    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        getWindow().setBackgroundDrawable(new ColorDrawable(FUNDO));

        ponte = new Ponte(this, new Localizador(this));

        web = new WebView(this);
        web.setBackgroundColor(FUNDO);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);    // a página guarda preferências no localStorage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new Cliente(this, ponte));
        setContentView(web);

        if (salvo == null || web.restoreState(salvo) == null) web.loadUrl(INICIO);
    }

    /*
     * Classe aninhada estática, e não interna: o javac novo marca o parâmetro
     * escondido do construtor de classe interna de um jeito que derruba
     * algumas versões do d8.
     */
    private static final class Cliente extends WebViewClient {
        private final Activity dono;
        private final Ponte ponte;

        Cliente(Activity dono, Ponte ponte) {
            this.dono = dono;
            this.ponte = ponte;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            // Só o que é da página passa pela Ponte; fonte e afins de outros
            // endereços seguem o caminho normal.
            if (!Localizador.NOME.equalsIgnoreCase(req.getUrl().getHost())) return null;
            return ponte.atender(req);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (Localizador.NOME.equalsIgnoreCase(u.getHost())) return false;
            try {
                dono.startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException e) {
                // nada que abra isso no aparelho; fica onde está
            }
            return true;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}

package com.oaovito.trackeroao;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.wifi.WifiManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.Collections;
import java.util.Enumeration;

/*
 * Localizador - descobre sozinho o IP do computador na rede de casa.
 *
 * O Android não resolve `.local` para aplicativo comum de forma confiável
 * (depende da versão e do fabricante), então a pergunta de mDNS é feita aqui
 * mesmo, do jeito que o sync/mdns.js sabe responder: registro A, classe IN,
 * com o bit de "responda em unicast" ligado.
 *
 * A ordem é da mais barata para a mais cara: primeiro o último IP que deu
 * certo (quase sempre ainda vale), só depois o multicast.
 */
final class Localizador {

    static final String NOME = "trackeroao.local";
    static final int PORTA = 8777;

    private static final String GRUPO = "224.0.0.251";
    private static final int PORTA_MDNS = 5353;
    private static final String CHAVE_IP = "ultimo_ip";

    // Depois de uma busca sem resposta, espera este tanto antes da próxima.
    // Sem isso, cada pedido da página dispararia um multicast novo.
    private static final long FOLGA_MS = 2500;

    private final Context ctx;
    private final SharedPreferences prefs;
    private String ip;
    private long falhouEm;

    Localizador(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.prefs = this.ctx.getSharedPreferences("rede", Context.MODE_PRIVATE);
    }

    /**
     * O IP do computador, ou null se ele não está na rede agora.
     * É sincronizado de propósito: os pedidos que chegam juntos esperam uma
     * única busca em vez de cada um fazer a sua.
     */
    synchronized String ip() {
        if (ip != null) return ip;
        if (System.currentTimeMillis() - falhouEm < FOLGA_MS) return null;

        String ultimo = prefs.getString(CHAVE_IP, null);
        if (ultimo != null && responde(ultimo)) return lembrar(ultimo);

        String achado = perguntarMdns();
        if (achado != null) return lembrar(achado);

        falhouEm = System.currentTimeMillis();
        return null;
    }

    /** Um pedido para `qual` falhou: esquece, e a próxima chamada procura de novo. */
    synchronized void esquecer(String qual) {
        if (qual != null && qual.equals(ip)) ip = null;
    }

    private String lembrar(String novo) {
        ip = novo;
        falhouEm = 0;
        prefs.edit().putString(CHAVE_IP, novo).apply();
        return novo;
    }

    /** Um GET rápido no progresso: só o nosso serviço responde isso nesta porta. */
    private static boolean responde(String alvo) {
        HttpURLConnection c = null;
        try {
            URL u = new URL("http://" + alvo + ":" + PORTA + "/progress.json");
            c = (HttpURLConnection) u.openConnection(Proxy.NO_PROXY);
            c.setConnectTimeout(1200);
            c.setReadTimeout(1500);
            c.setUseCaches(false);
            return c.getResponseCode() == 200;
        } catch (IOException e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // --- mDNS ---------------------------------------------------------------

    private String perguntarMdns() {
        WifiManager wifi = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock trava = null;
        MulticastSocket sock = null;
        try {
            // Muitos aparelhos descartam multicast com a tela em economia;
            // a trava pede ao Wi-Fi que deixe passar enquanto perguntamos.
            if (wifi != null) {
                trava = wifi.createMulticastLock("trackeroao");
                trava.setReferenceCounted(false);
                trava.acquire();
            }
            // Porta qualquer, não a 5353: o próprio Android pode estar nela, e
            // com o bit QU a resposta vem direto para esta porta.
            sock = new MulticastSocket(0);
            sock.setTimeToLive(255);
            NetworkInterface nif = interfaceWifi();
            if (nif != null) sock.setNetworkInterface(nif);

            byte[] pergunta = montarPergunta(NOME);
            InetAddress grupo = InetAddress.getByName(GRUPO);
            byte[] buf = new byte[1500];

            // Três tentativas: pacote multicast se perde e ninguém retransmite.
            for (int tentativa = 0; tentativa < 3; tentativa++) {
                sock.send(new DatagramPacket(pergunta, pergunta.length, grupo, PORTA_MDNS));
                long fim = System.currentTimeMillis() + 700;
                while (true) {
                    long resta = fim - System.currentTimeMillis();
                    if (resta <= 0) break;
                    sock.setSoTimeout((int) resta);
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try {
                        sock.receive(p);
                    } catch (SocketTimeoutException e) {
                        break;
                    }
                    String a = lerRegistroA(p.getData(), p.getLength(), NOME);
                    if (a != null) return a;
                }
            }
            return null;
        } catch (IOException | RuntimeException e) {
            return null;
        } finally {
            if (sock != null) sock.close();
            if (trava != null && trava.isHeld()) trava.release();
        }
    }

    /**
     * A interface do Wi-Fi. Com dados móveis ligados, o multicast pode sair
     * pela rede da operadora, onde o computador obviamente não está.
     */
    private static NetworkInterface interfaceWifi() {
        try {
            NetworkInterface reserva = null;
            Enumeration<NetworkInterface> todas = NetworkInterface.getNetworkInterfaces();
            if (todas == null) return null;
            for (NetworkInterface n : Collections.list(todas)) {
                if (!n.isUp() || n.isLoopback() || !n.supportsMulticast()) continue;
                boolean temIpv4 = false;
                for (InetAddress a : Collections.list(n.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLinkLocalAddress()) temIpv4 = true;
                }
                if (!temIpv4) continue;
                if (n.getName().startsWith("wlan")) return n;
                if (reserva == null && !n.getName().startsWith("rmnet")) reserva = n;
            }
            return reserva;
        } catch (IOException e) {
            return null;
        }
    }

    /** Pergunta de um registro A para `nome`, com o bit QU (resposta em unicast). */
    static byte[] montarPergunta(String nome) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        // id 0, flags 0, uma pergunta, nenhuma resposta
        byte[] cab = {0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0};
        out.write(cab, 0, cab.length);
        for (String rotulo : nome.split("\\.")) {
            if (rotulo.isEmpty()) continue;
            byte[] b = rotulo.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            out.write(b.length);
            out.write(b, 0, b.length);
        }
        out.write(0);
        out.write(0); out.write(1);                  // TYPE A
        out.write(0x80); out.write(1);               // CLASS IN + QU
        return out.toByteArray();
    }

    /**
     * O IPv4 de um registro A para `nome` dentro do pacote, ou null.
     * Olha todas as seções, porque respondedor de mDNS às vezes manda o
     * endereço como registro adicional.
     */
    static String lerRegistroA(byte[] b, int len, String nome) {
        if (len < 12) return null;
        int flags = u16(b, 2);
        if ((flags & 0x8000) == 0) return null;      // é pergunta, não resposta
        int qd = u16(b, 4);
        int rr = u16(b, 6) + u16(b, 8) + u16(b, 10);
        int[] pos = {12};
        for (int i = 0; i < qd; i++) {
            if (lerNome(b, len, pos) == null) return null;
            pos[0] += 4;
        }
        for (int i = 0; i < rr; i++) {
            String n = lerNome(b, len, pos);
            if (n == null || pos[0] + 10 > len) return null;
            int tipo = u16(b, pos[0]);
            int classe = u16(b, pos[0] + 2) & 0x7fff;  // sem o bit de cache-flush
            int tam = u16(b, pos[0] + 8);
            int dados = pos[0] + 10;
            if (dados + tam > len) return null;
            if (tipo == 1 && classe == 1 && tam == 4 && n.equalsIgnoreCase(nome)) {
                int a = b[dados] & 0xff, c = b[dados + 1] & 0xff;
                // 0.x e 169.254.x nunca servem para chegar a lugar nenhum
                if (a != 0 && !(a == 169 && c == 254)) {
                    return a + "." + c + "." + (b[dados + 2] & 0xff) + "." + (b[dados + 3] & 0xff);
                }
            }
            pos[0] = dados + tam;
        }
        return null;
    }

    /**
     * Lê um nome a partir de pos[0] e avança pos[0] para depois dele.
     * Segue ponteiros de compressão com limite de saltos: pacote malformado
     * existe, e um laço infinito aqui travaria a busca.
     */
    private static String lerNome(byte[] b, int len, int[] pos) {
        StringBuilder sb = new StringBuilder();
        int i = pos[0];
        int depois = -1;
        int saltos = 0;
        while (true) {
            if (i >= len) return null;
            int n = b[i] & 0xff;
            if (n == 0) { i++; break; }
            if ((n & 0xc0) == 0xc0) {
                if (i + 1 >= len || ++saltos > 8) return null;
                if (depois < 0) depois = i + 2;
                i = ((n & 0x3f) << 8) | (b[i + 1] & 0xff);
                continue;
            }
            if (i + 1 + n > len) return null;
            if (sb.length() > 0) sb.append('.');
            sb.append(new String(b, i + 1, n, java.nio.charset.StandardCharsets.UTF_8));
            i += 1 + n;
        }
        pos[0] = depois >= 0 ? depois : i;
        return sb.toString();
    }

    private static int u16(byte[] b, int i) {
        return ((b[i] & 0xff) << 8) | (b[i + 1] & 0xff);
    }
}

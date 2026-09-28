'use strict';
/*
 * mdns.js - faz a máquina atender por um nome, e não por um IP.
 *
 * O objetivo é um link que dê para dizer em voz alta: em vez de
 * "192.168.1.10:8777", "sekiro.local". Quem estiver no mesmo Wi-Fi abre e
 * pronto, sem instalar nem configurar nada no aparelho.
 *
 * Isso funciona porque mDNS é nativo: iPhone, iPad e Mac resolvem `.local` de
 * fábrica (é o Bonjour), e o Windows 10 em diante também. O que este arquivo
 * faz é entrar no grupo multicast 224.0.0.251:5353, escutar as perguntas e
 * responder "sekiro.local é este IP aqui".
 *
 * O SUFIXO `.local` NÃO É ESCOLHA. mDNS só atende esse sufixo - é o que a RFC
 * 6762 reserva para ele. Um nome como "sekiro.oaovito" sairia do aparelho como
 * consulta de DNS comum, não chegaria aqui, e morreria no servidor do
 * provedor. Para um nome assim seria preciso ou mexer no hosts de cada
 * aparelho, ou pôr um servidor de DNS na rede e apontar o roteador para ele.
 *
 * Nada aqui escreve no sistema nem pede privilégio: é um socket UDP e um
 * grupo multicast, que qualquer processo pode abrir.
 */

const dgram = require('dgram');
const os = require('os');

const GRUPO = '224.0.0.251';
const PORTA = 5353;
const TTL = 120;

/** Nome em rótulos: "sekiro.local" -> <6>sekiro<5>local<0> */
function codificarNome(nome) {
  const partes = nome.split('.').filter(Boolean);
  const bufs = [];
  for (const p of partes) {
    const b = Buffer.from(p, 'utf8');
    if (b.length > 63) throw new Error(`rótulo longo demais: ${p}`);
    bufs.push(Buffer.from([b.length]), b);
  }
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

/**
 * Lê um nome a partir de `off`. Devolve { nome, proximo }.
 * Trata ponteiro de compressão porque pergunta malformada existe, e um laço
 * infinito aqui derrubaria o serviço inteiro.
 */
function lerNome(buf, off) {
  const partes = [];
  let i = off;
  let saltos = 0;
  let depoisDoPonteiro = -1;
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) { i += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (i + 1 >= buf.length) return null;
      if (++saltos > 8) return null;                 // ponteiro em círculo
      if (depoisDoPonteiro < 0) depoisDoPonteiro = i + 2;
      i = ((len & 0x3f) << 8) | buf[i + 1];
      continue;
    }
    if (i + 1 + len > buf.length) return null;
    partes.push(buf.toString('utf8', i + 1, i + 1 + len));
    i += 1 + len;
  }
  return { nome: partes.join('.'), proximo: depoisDoPonteiro >= 0 ? depoisDoPonteiro : i };
}

/** Resposta com um registro A. O bit de cache-flush evita resposta velha presa. */
function montarResposta(nome, ip) {
  const cab = Buffer.alloc(12);
  cab.writeUInt16BE(0, 0);          // id: zero em resposta mDNS
  cab.writeUInt16BE(0x8400, 2);     // QR=1, AA=1
  cab.writeUInt16BE(0, 4);          // sem perguntas
  cab.writeUInt16BE(1, 6);          // uma resposta
  const nomeBuf = codificarNome(nome);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(1, 0);           // TYPE A
  rr.writeUInt16BE(0x8001, 2);      // CLASS IN + cache-flush
  rr.writeUInt32BE(TTL, 4);
  rr.writeUInt16BE(4, 8);           // RDLENGTH
  const octetos = Buffer.from(ip.split('.').map(Number));
  if (octetos.length !== 4) throw new Error(`IPv4 inválido: ${ip}`);
  return Buffer.concat([cab, nomeBuf, rr, octetos]);
}

/** As perguntas do pacote, como [{nome, tipo, unicast}]. */
function lerPerguntas(buf) {
  if (buf.length < 12) return [];
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return [];                     // é resposta, não pergunta
  const qd = buf.readUInt16BE(4);
  const out = [];
  let off = 12;
  for (let n = 0; n < qd && off + 4 <= buf.length; n++) {
    const lido = lerNome(buf, off);
    if (!lido) break;
    off = lido.proximo;
    if (off + 4 > buf.length) break;
    const tipo = buf.readUInt16BE(off);
    const classe = buf.readUInt16BE(off + 2);
    off += 4;
    out.push({ nome: lido.nome, tipo, unicast: (classe & 0x8000) !== 0 });
  }
  return out;
}

/**
 * Sobe o respondedor.
 *
 * `obterIp` é função porque o IP muda: o serviço sobe antes de o Wi-Fi
 * associar, e a máquina troca de rede. Consultar na hora de responder é o que
 * evita anunciar um endereço que não vale mais.
 */
function responder(options) {
  const opts = options || {};
  // Vários nomes de uma vez: responder a mais um custa uma comparação de
  // string, e assim dá para oferecer o bonito e o garantido ao mesmo tempo.
  const nomes = (opts.nomes || ['sekiro.local']).map((x) => x.toLowerCase());
  const obterIp = opts.obterIp || (() => {
    for (const lista of Object.values(os.networkInterfaces())) {
      for (const net of lista || []) {
        if (net.family === 'IPv4' && !net.internal && !/^169\.254\./.test(net.address)) {
          return net.address;
        }
      }
    }
    return null;
  });
  const log = opts.log || (() => {});

  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let vivo = false;
  let ultimoIp = null;

  sock.on('error', (err) => {
    // Outro programa pode já estar com a porta de um jeito que não divide, ou
    // a rede pode estar caindo. Isso não pode derrubar o resto do serviço: o
    // acesso por IP continua valendo.
    log(`[mdns] desligado: ${err.message}`);
    vivo = false;
    try { sock.close(); } catch (e) { /* já fechado */ }
  });

  sock.on('message', (msg, rinfo) => {
    if (!vivo) return;
    let perguntas;
    try { perguntas = lerPerguntas(msg); } catch (e) { return; }
    for (const p of perguntas) {
      // tipo 1 = A, 255 = ANY. O resto não nos diz respeito.
      if (p.tipo !== 1 && p.tipo !== 255) continue;
      const alvoNome = nomes.find((x) => x === p.nome.toLowerCase());
      if (!alvoNome) continue;
      const ip = obterIp();
      if (!ip) return;
      let pacote;
      try { pacote = montarResposta(alvoNome, ip); } catch (e) { return; }
      const alvo = p.unicast ? rinfo.address : GRUPO;
      const porta = p.unicast ? rinfo.port : PORTA;
      sock.send(pacote, porta, alvo, () => {});
      return;
    }
  });

  sock.bind(PORTA, () => {
    try {
      sock.setMulticastTTL(255);
      sock.setMulticastLoopback(true);
      sock.addMembership(GRUPO);
      vivo = true;
      log(`[mdns] atendendo por ${nomes.join(', ')}`);
      anunciar();
    } catch (err) {
      log(`[mdns] não consegui entrar no grupo multicast: ${err.message}`);
      vivo = false;
      try { sock.close(); } catch (e) { /* já fechado */ }
    }
  });

  /** Anuncia sem ninguém perguntar: quem já estava na rede atualiza o cache. */
  function anunciar() {
    if (!vivo) return;
    const ip = obterIp();
    if (!ip) return;
    ultimoIp = ip;
    for (const nome of nomes) {
      let pacote;
      try { pacote = montarResposta(nome, ip); } catch (e) { continue; }
      // Duas vezes, com folga: pacote multicast se perde e não é retransmitido.
      sock.send(pacote, PORTA, GRUPO, () => {});
      setTimeout(() => { if (vivo) sock.send(pacote, PORTA, GRUPO, () => {}); }, 1000);
    }
  }

  return {
    nomes,
    anunciar,
    /** Chamado quando o IP muda, para o cache da rede não ficar desatualizado. */
    ipMudou(ip) { if (ip !== ultimoIp) anunciar(); },
    ativo: () => vivo,
    parar() { vivo = false; try { sock.close(); } catch (e) { /* já fechado */ } },
  };
}

module.exports = { responder, montarResposta, lerPerguntas, codificarNome, lerNome, GRUPO, PORTA };

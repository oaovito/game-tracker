'use strict';

/**
 * Código QR, sem dependência nenhuma.
 *
 * Serve para o endereço do celular: a página no computador mostra um código
 * que a câmera do telefone lê, em vez de pedir que alguém copie um endereço
 * que muda de rede para rede. Modo byte, correção M, versões 1 a 10 (até
 * 213 bytes), mais do que basta para um endereço da rede local.
 *
 * Segue a especificação ISO/IEC 18004; a estrutura acompanha a implementação
 * de referência de domínio público de Project Nayuki.
 */

// Correção M, versões 1 a 10: bytes de correção por bloco, e número de blocos.
const ECC_POR_BLOCO = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function modulosDeDados(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

function bytesDeDados(ver) {
  return Math.floor(modulosDeDados(ver) / 8) - ECC_POR_BLOCO[ver - 1] * BLOCOS[ver - 1];
}

function mult(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisor(grau) {
  const r = new Array(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mult(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mult(raiz, 0x02);
  }
  return r;
}

function resto(dados, div) {
  const r = div.map(() => 0);
  for (const b of dados) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < r.length; i++) r[i] ^= mult(div[i], f);
  }
  return r;
}

function posicoesDeAlinhamento(ver, tam) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const passo = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= passo) r.splice(1, 0, p);
  return r;
}

/** Matriz de módulos (true = escuro) para o texto dado. */
function gerar(texto) {
  const bytes = [...Buffer.from(String(texto), 'utf8')];
  let ver = 1;
  for (; ver <= 10; ver++) {
    const bits = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (bits <= bytesDeDados(ver) * 8) break;
  }
  if (ver > 10) throw new Error('texto longo demais para o código QR');
  const tam = ver * 4 + 17;
  const cap = bytesDeDados(ver) * 8;

  // Os bits: modo byte, tamanho, dados, terminador e preenchimento.
  const bits = [];
  const por = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  por(4, 4);
  por(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) por(b, 8);
  por(0, Math.min(4, cap - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) por(p, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Blocos com correção de erros, intercalados.
  const nb = BLOCOS[ver - 1], ecc = ECC_POR_BLOCO[ver - 1];
  const brutos = Math.floor(modulosDeDados(ver) / 8);
  const curtos = nb - (brutos % nb);
  const tamCurto = Math.floor(brutos / nb);
  const div = divisor(ecc);
  const blocos = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = dados.slice(k, k + tamCurto - ecc + (i < curtos ? 0 : 1));
    k += d.length;
    const e = resto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++) {
    for (let j = 0; j < blocos.length; j++) {
      if (i !== tamCurto - ecc || j >= curtos) final.push(blocos[j][i]);
    }
  }

  // Padrões fixos.
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fixo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const pos = (x, y, v) => { m[y][x] = v; fixo[y][x] = true; };
  for (let i = 0; i < tam; i++) { pos(6, i, i % 2 === 0); pos(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [tam - 4, 3], [3, tam - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < tam && y >= 0 && y < tam) pos(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = posicoesDeAlinhamento(ver, tam);
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) pos(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  const formato = (mask) => {
    const d = (0 << 3) | mask; // correção M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) pos(8, i, bit(i));
    pos(8, 7, bit(6)); pos(8, 8, bit(7)); pos(7, 8, bit(8));
    for (let i = 9; i < 15; i++) pos(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) pos(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) pos(8, tam - 15 + i, bit(i));
    pos(8, tam - 8, true);
  };
  formato(0);
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const v = ((b >>> i) & 1) === 1;
      const a = tam - 11 + (i % 3), c = Math.floor(i / 3);
      pos(a, c, v); pos(c, a, v);
    }
  }

  // Os dados, em zigue-zague de baixo para cima.
  let n = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let v = 0; v < tam; v++) {
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const sobe = ((dir + 1) & 2) === 0;
        const y = sobe ? tam - 1 - v : v;
        if (!fixo[y][x] && n < final.length * 8) {
          m[y][x] = ((final[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
          n++;
        }
      }
    }
  }

  // A máscara de menor penalidade.
  const regra = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const aplicar = (k) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fixo[y][x] && regra[k](x, y)) m[y][x] = !m[y][x];
  };
  const penalidade = () => {
    let p = 0, escuros = 0;
    for (let a = 0; a < 2; a++) {
      for (let i = 0; i < tam; i++) {
        let seq = 1;
        for (let j = 1; j <= tam; j++) {
          const at = j < tam && (a ? m[j][i] : m[i][j]) === (a ? m[j - 1][i] : m[i][j - 1]);
          if (at) seq++;
          else { if (seq >= 5) p += seq - 2; seq = 1; }
        }
      }
    }
    for (let y = 0; y < tam; y++) {
      for (let x = 0; x < tam; x++) {
        if (m[y][x]) escuros++;
        if (x < tam - 1 && y < tam - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    }
    return p + Math.floor(Math.abs(escuros * 20 - tam * tam * 10) / (tam * tam)) * 10;
  };
  let melhor = 0, menor = Infinity;
  for (let k = 0; k < 8; k++) {
    aplicar(k); formato(k);
    const p = penalidade();
    if (p < menor) { menor = p; melhor = k; }
    aplicar(k);
  }
  aplicar(melhor); formato(melhor);
  return m;
}

/** O código como SVG, com a margem de quatro módulos que a leitura pede. */
function svg(texto, cor, fundo) {
  const m = gerar(texto);
  const n = m.length + 8;
  let d = '';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) if (m[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${fundo || '#fff'}"/><path d="${d}" fill="${cor || '#000'}"/></svg>`;
}

module.exports = { gerar, svg };

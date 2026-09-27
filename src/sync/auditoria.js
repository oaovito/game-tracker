'use strict';
/*
 * auditoria.js - escreve um txt com TUDO que uma pessoa com o link público
 * consegue acessar, já com o prompt para alguém (ou outra IA) revisar.
 *
 * O ponto é não descrever de memória. O arquivo é montado a partir do que está
 * de fato publicado — a página, o JSON, o README, o repositório, a API do
 * GitHub — porque uma auditoria feita sobre o que eu acho que publiquei não
 * audita nada.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RAIZ = path.join(__dirname, '..');
const SITE = path.join(RAIZ, 'site');
const SAIDA = path.join(RAIZ, 'auditoria-publica.txt');
const BASE = 'https://oaovito.github.io/trackeroao';
const REPO = 'oaovito/trackeroao';

function buscar(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'trackeroao-audit' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(buscar(res.headers.location));
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: d, tipo: res.headers['content-type'] || '' }));
    }).on('error', (e) => resolve({ status: 0, corpo: '', erro: e.message }));
  });
}

/** Campos de um objeto, em profundidade, para listar o que o JSON expõe. */
function campos(obj, prefixo, saida, prof) {
  saida = saida || [];
  prof = prof || 0;
  if (prof > 3 || obj === null || typeof obj !== 'object') return saida;
  if (Array.isArray(obj)) {
    if (obj.length) campos(obj[0], (prefixo || '') + '[]', saida, prof + 1);
    return saida;
  }
  for (const k of Object.keys(obj)) {
    const caminho = prefixo ? prefixo + '.' + k : k;
    const v = obj[k];
    const tipo = Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v;
    saida.push({ caminho, tipo, exemplo: tipo === 'object' || tipo.startsWith('array') ? '' : JSON.stringify(v) });
    if (v && typeof v === 'object') campos(v, caminho, saida, prof + 1);
  }
  return saida;
}

async function montar() {
  const L = [];
  const add = (s) => L.push(s === undefined ? '' : s);

  add('AUDITORIA DO QUE ESTÁ PÚBLICO — trackeroao');
  add('gerado em ' + new Date().toISOString());
  add('='.repeat(72));
  add();
  add('PROMPT PARA QUEM FOR ANALISAR');
  add('-'.repeat(72));
  add('Você está auditando um site estático público. Abaixo está TUDO que uma');
  add('pessoa de posse apenas do link consegue acessar: as URLs servidas, o');
  add('conteúdo de cada uma, os campos do JSON de dados e o que a API pública do');
  add('GitHub devolve sobre o repositório.');
  add();
  add('Procure, e aponte com a linha exata:');
  add();
  add('  1. VAZAMENTO DE IDENTIDADE. Qualquer coisa que identifique a pessoa ou');
  add('     a máquina além do apelido "oaovito": caminho de arquivo, nome de');
  add('     usuário do sistema, Steam ID ou outro id de conta, IP, nome de');
  add('     máquina, e-mail que não seja o de autoria dos commits, coordenada,');
  add('     número de série.');
  add('  2. INFERÊNCIA. Coisas que não identificam sozinhas mas permitem deduzir:');
  add('     fuso horário, horários de jogo, rotina, localização aproximada.');
  add('  3. ERRO DE DADO. Número que se contradiz entre duas partes do JSON,');
  add('     contagem que não fecha, campo com nome enganoso, data impossível.');
  add('  4. ERRO NA PÁGINA. Referência a arquivo que não existe, script que');
  add('     estoura sem o JSON, texto que promete o que o dado não sustenta,');
  add('     estado que a página não sabe mostrar.');
  add('  5. SUPERFÍCIE. Qualquer URL servida que não deveria estar acessível.');
  add();
  add('Para cada achado: o que é, onde está, e o quanto importa. Se não achar');
  add('nada numa categoria, diga isso explicitamente — "não encontrei" é um');
  add('resultado, "não comentei" não é.');
  add();

  // --- o que é servido ---
  add('='.repeat(72));
  add('1. URLs SERVIDAS');
  add('-'.repeat(72));
  const caminhos = ['/', '/index.html', '/progress.json', '/README.md', '/.nojekyll',
    '/.git/config', '/nao-existe-teste-404'];
  const corpos = {};
  for (const c of caminhos) {
    const r = await buscar(BASE + c);
    corpos[c] = r;
    add(`  ${String(r.status).padEnd(4)} ${(BASE + c).padEnd(58)} ${r.corpo.length} bytes`);
  }
  add();
  add('  As duas últimas são sondagens: /.git/config e uma URL inexistente. O');
  add('  esperado é 404 nas duas. Qualquer outra coisa é achado.');
  add();

  // --- campos do JSON ---
  add('='.repeat(72));
  add('2. CAMPOS DO progress.json (o dado que a página consome)');
  add('-'.repeat(72));
  let dados = null;
  try { dados = JSON.parse(corpos['/progress.json'].corpo); } catch (e) { dados = null; }
  if (!dados) {
    add('  não consegui ler o JSON publicado');
  } else {
    for (const c of campos(dados)) {
      add(`  ${c.caminho.padEnd(46)} ${c.tipo.padEnd(12)} ${String(c.exemplo).slice(0, 60)}`);
    }
  }
  add();

  // --- conteúdo bruto ---
  add('='.repeat(72));
  add('3. CONTEÚDO COMPLETO DO progress.json');
  add('-'.repeat(72));
  add(corpos['/progress.json'] ? corpos['/progress.json'].corpo : '(indisponível)');
  add();

  add('='.repeat(72));
  add('4. CONTEÚDO COMPLETO DO README.md');
  add('-'.repeat(72));
  add(corpos['/README.md'] ? corpos['/README.md'].corpo : '(indisponível)');
  add();

  // --- a página ---
  add('='.repeat(72));
  add('5. A PÁGINA (index.html)');
  add('-'.repeat(72));
  const html = corpos['/index.html'] ? corpos['/index.html'].corpo : '';
  add(`  ${html.length} bytes. É um arquivo só: HTML, CSS e JavaScript juntos,`);
  add('  sem recurso externo além das fontes do Google Fonts.');
  add();
  add('  Recursos externos que ela pede:');
  for (const m of html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) add('    ' + m[1]);
  add();
  add('  Chaves gravadas no navegador de quem abre (localStorage):');
  for (const m of new Set([...html.matchAll(/"(sekiro-progresso-[a-z]+)"/g)].map((m) => m[1]))) add('    ' + m);
  add();
  add('  --- HTML completo abaixo ---');
  add(html);
  add();

  // --- o repositório ---
  add('='.repeat(72));
  add('6. O QUE A API PÚBLICA DO GITHUB DEVOLVE');
  add('-'.repeat(72));
  for (const [rot, url] of [
    ['repositório', `https://api.github.com/repos/${REPO}`],
    ['commits', `https://api.github.com/repos/${REPO}/commits?per_page=100`],
    ['contribuidores', `https://api.github.com/repos/${REPO}/contributors`],
    ['perfil', 'https://api.github.com/users/oaovito'],
  ]) {
    const r = await buscar(url);
    add(`  ${rot} (${url}) -> HTTP ${r.status}`);
    try {
      const j = JSON.parse(r.corpo);
      if (rot === 'commits' && Array.isArray(j)) {
        add(`    ${j.length} commits. Autores distintos:`);
        for (const a of new Set(j.map((c) => `${c.commit.author.name} <${c.commit.author.email}>`))) add('      ' + a);
        add('    Mensagens:');
        for (const c of j) add(`      ${c.sha.slice(0, 7)}  ${c.commit.author.date}  ${c.commit.message.split('\n')[0]}`);
      } else if (rot === 'perfil') {
        for (const k of ['login', 'name', 'email', 'location', 'company', 'blog', 'bio', 'twitter_username', 'created_at']) {
          add(`    ${k.padEnd(18)} ${JSON.stringify(j[k])}`);
        }
      } else if (Array.isArray(j)) {
        for (const x of j) add('    ' + (x.login ? `${x.login} (${x.contributions})` : JSON.stringify(x).slice(0, 80)));
      } else {
        for (const k of ['full_name', 'description', 'private', 'homepage', 'created_at', 'pushed_at', 'size', 'language']) {
          add(`    ${k.padEnd(18)} ${JSON.stringify(j[k])}`);
        }
      }
    } catch (e) { add('    (resposta não é JSON)'); }
    add();
  }

  add('='.repeat(72));
  add('FIM');
  fs.writeFileSync(SAIDA, L.join('\n'), 'utf8');
  return { arquivo: SAIDA, linhas: L.length, bytes: fs.statSync(SAIDA).size };
}

module.exports = { montar, campos, SAIDA };

if (require.main === module) {
  montar().then((r) => {
    console.log(`  ${r.arquivo}`);
    console.log(`  ${r.linhas} linhas, ${(r.bytes / 1024).toFixed(1)} KB`);
  });
}

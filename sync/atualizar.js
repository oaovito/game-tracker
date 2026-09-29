/**
 * atualizar.js - a instalação se mantém atual sozinha, em silêncio.
 *
 * O pedido é que quem tem a aplicação instalada receba cada versão nova sem
 * fazer nada, sem mensagem e sem janela. Então este módulo não fala com a
 * tela: o que ele tem a dizer vai para o log, e só.
 *
 * A unidade de atualização é a release, e não cada commit da main. Todo ciclo
 * de trabalho termina numa release; é ela que marca "isto está pronto", e é o
 * mesmo código que o instalador baixa. Entre releases, a main pode estar no
 * meio de uma mudança.
 *
 * Dois modos, decididos pela pasta:
 *
 *   - instalação (sem .git): compara a tag gravada em versao.json com a última
 *     release. Se mudou, baixa o zip da tag, copia por cima e remove o que a
 *     versão anterior tinha e a nova não tem mais.
 *   - clone do repositório (com .git): é a máquina de quem desenvolve. Aqui o
 *     git manda: só avança a main por fast-forward, e só com a árvore limpa.
 *     Qualquer trabalho local em andamento faz a atualização esperar, em vez
 *     de arriscar sobrescrever o que alguém está editando.
 *
 * O estado desta máquina nunca é tocado: progress.json, as contagens, a
 * calibração e a escolha de jogos não vêm no zip, e o que vem no zip mas é
 * gerado aqui (docs/progress.json) fica como está.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const REPO = process.env.TRACKEROAO_REPO_ID || 'oaovito/trackeroao';
const NOME_ESTADO = 'versao.json';

// O que chega no zip mas é desta máquina: a cópia publicada do progresso.
const PRESERVAR = new Set(['docs/progress.json']);

// Sem estes, o zip veio truncado ou de outro projeto, e copiar seria pior do
// que não atualizar.
const EXIGIDOS = [
  'trackeroao.html', 'package.json', 'sync/main.js', 'sync/offsets.json',
  'sync/conquistas.json', 'windows/install-sync-service.ps1', 'docs/index.html',
];

/*
 * O que ficava na raiz antes de os scripts irem para pastas próprias.
 *
 * Uma instalação daquela época não tem versao.json, então não há lista do que
 * ela recebeu para comparar. Sem esta lista, a primeira atualização deixaria
 * as cópias velhas na raiz, ao lado das novas em windows\ -- e quem abrisse a
 * pasta não saberia qual rodar.
 */
const LEGADO = [
  'install-sync-service.ps1', 'uninstall-sync-service.ps1', 'liberar-porta.ps1',
  'reativar.ps1', 'run.bat', 'instalar.ps1', 'construir-exe.ps1',
  'trackeroao-instalador.exe',
];

function lerEstado(raiz) {
  try { return JSON.parse(fs.readFileSync(path.join(raiz, NOME_ESTADO), 'utf8')); } catch (e) { return null; }
}

function gravarEstado(raiz, estado) {
  const alvo = path.join(raiz, NOME_ESTADO);
  const tmp = alvo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 1));
  fs.renameSync(tmp, alvo);
}

/** Todos os arquivos abaixo de `dir`, como caminhos relativos com barra normal. */
function listar(dir) {
  const saida = [];
  const anda = (d, rel) => {
    for (const n of fs.readdirSync(d)) {
      const c = path.join(d, n);
      const r = rel ? rel + '/' + n : n;
      if (fs.statSync(c).isDirectory()) anda(c, r);
      else saida.push(r);
    }
  };
  anda(dir, '');
  return saida.sort();
}

/** Resolve `rel` dentro de `raiz`, ou null se escapar dela. */
function dentro(raiz, rel) {
  const alvo = path.resolve(raiz, rel);
  const base = path.resolve(raiz);
  return alvo.startsWith(base + path.sep) ? alvo : null;
}

/**
 * Copia uma versão baixada por cima da instalação.
 *
 * É a mesma rotina para o instalador e para a atualização: os dois recebem a
 * pasta descompactada e fazem exatamente isto, e ter duas cópias do "como se
 * atualiza" seria convidar uma delas a ficar para trás.
 */
function aplicarPasta(fonte, tag, raiz) {
  raiz = raiz || RAIZ;
  const faltando = EXIGIDOS.filter((r) => !fs.existsSync(path.join(fonte, r)));
  if (faltando.length) throw new Error('a versão baixada veio incompleta, faltou: ' + faltando.join(', '));

  const novos = listar(fonte);
  const anterior = lerEstado(raiz);

  for (const rel of novos) {
    const destino = dentro(raiz, rel);
    if (!destino) continue;
    if (PRESERVAR.has(rel) && fs.existsSync(destino)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(path.join(fonte, rel), destino);
  }

  // Sai só o que era do projeto e deixou de ser. Arquivo que nunca veio de
  // release nenhuma -- estado, log, cópia de hibernação -- não está em lista
  // alguma e fica.
  const antigos = anterior && Array.isArray(anterior.arquivos) ? anterior.arquivos : LEGADO;
  const ficam = new Set(novos);
  const removidos = [];
  for (const rel of antigos) {
    if (ficam.has(rel) || PRESERVAR.has(rel)) continue;
    const alvo = dentro(raiz, rel);
    if (!alvo || !fs.existsSync(alvo)) continue;
    try { fs.unlinkSync(alvo); removidos.push(rel); } catch (e) { /* em uso: sai na próxima */ }
  }

  gravarEstado(raiz, { tag, arquivos: novos, em: new Date().toISOString() });
  return { copiados: novos.length, removidos };
}

/* ------------------------------------------------------------- rede */

function pedir(url, destino, saltos) {
  saltos = saltos || 0;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'trackeroao', accept: 'application/vnd.github+json' },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && saltos < 5) {
        res.resume();
        resolve(pedir(new URL(res.headers.location, url).toString(), destino, saltos + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' em ' + url));
        return;
      }
      if (destino) {
        const arq = fs.createWriteStream(destino);
        res.pipe(arq);
        arq.on('finish', () => arq.close(() => resolve(destino)));
        arq.on('error', reject);
      } else {
        let corpo = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { corpo += c; });
        res.on('end', () => { try { resolve(JSON.parse(corpo)); } catch (e) { reject(e); } });
      }
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado em ' + url)));
    req.on('error', reject);
  });
}

function rodar(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ windowsHide: true, timeout: 120000 }, opts || {}),
      (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(String(out).trim())));
  });
}

async function ultimaRelease() {
  const r = await pedir(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!r || !r.tag_name) throw new Error('a API não devolveu release nenhuma');
  return r.tag_name;
}

/** Baixa e descompacta o código de uma tag; devolve a pasta e a limpeza. */
async function baixar(tag) {
  varrerTemporarios();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trackeroao-'));
  const limpar = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp */ } };
  try {
    return await baixarEm(tmp, tag, limpar);
  } catch (e) {
    // Download ou zip que falhou nao deixa pasta para tras.
    limpar();
    throw e;
  }
}

/*
 * Nada se acumula na pasta temporaria: uma atualizacao interrompida (o PC
 * desligado no meio, o processo morto) deixaria a pasta dela ali para
 * sempre. Antes de baixar, as que sobraram de rodadas anteriores saem. Uma
 * hora de folga para nunca pegar a de uma rodada que ainda esta em curso.
 */
function varrerTemporarios() {
  const agora = Date.now();
  let nomes = [];
  try { nomes = fs.readdirSync(os.tmpdir()); } catch (e) { return; }
  for (const nome of nomes) {
    if (!/^trackeroao-[A-Za-z0-9]{6}$/.test(nome)) continue;
    const cheio = path.join(os.tmpdir(), nome);
    try {
      if (agora - fs.statSync(cheio).mtimeMs < 60 * 60 * 1000) continue;
      fs.rmSync(cheio, { recursive: true, force: true });
    } catch (e) { /* em uso: sai na proxima */ }
  }
}

async function baixarEm(tmp, tag, limpar) {
  const zip = path.join(tmp, 'fonte.zip');
  await pedir(`https://codeload.github.com/${REPO}/zip/refs/tags/${encodeURIComponent(tag)}`, zip);
  const pasta = path.join(tmp, 'x');
  // O Node não descompacta zip sozinho, e o projeto não ganha dependência por
  // isso: o Expand-Archive já vem no Windows. Fora dele, o unzip do sistema.
  if (process.platform === 'win32') {
    await rodar('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${pasta.replace(/'/g, "''")}' -Force`]);
  } else {
    await rodar('unzip', ['-q', zip, '-d', pasta]);
  }
  const sub = fs.readdirSync(pasta).map((n) => path.join(pasta, n)).find((c) => fs.statSync(c).isDirectory());
  if (!sub) throw new Error('o zip da ' + tag + ' veio vazio');
  return { pasta: sub, limpar };
}

/* ------------------------------------------------------------- modos */

async function viaGit(raiz) {
  const git = (...a) => rodar('git', a, { cwd: raiz });
  const ramo = await git('rev-parse', '--abbrev-ref', 'HEAD');
  if (ramo !== 'main') return { atualizou: false, motivo: 'clone fora da main (' + ramo + ')' };
  if (await git('status', '--porcelain', '--untracked-files=no')) {
    return { atualizou: false, motivo: 'clone com alterações locais; espera' };
  }
  await git('fetch', '--quiet', 'origin', 'main');
  const de = await git('rev-parse', 'HEAD');
  const para = await git('rev-parse', 'origin/main');
  if (de === para) return { atualizou: false };
  try { await git('merge-base', '--is-ancestor', 'HEAD', 'origin/main'); } catch (e) {
    return { atualizou: false, motivo: 'clone com commits que a origem não tem; espera' };
  }
  await git('merge', '--ff-only', '--quiet', 'origin/main');
  return { atualizou: true, de: de.slice(0, 7), para: para.slice(0, 7) };
}

async function viaRelease(raiz) {
  const tag = await ultimaRelease();
  const estado = lerEstado(raiz);
  if (estado && estado.tag === tag) return { atualizou: false };
  const b = await baixar(tag);
  try {
    const r = aplicarPasta(b.pasta, tag, raiz);
    return { atualizou: true, de: estado ? estado.tag : null, para: tag, removidos: r.removidos };
  } finally {
    b.limpar();
  }
}

/**
 * Confere e, havendo versão nova, aplica. Nunca lança: quem chama é o serviço,
 * e uma atualização que falhou não pode derrubar a aplicação que está de pé.
 */
async function verificar(raiz) {
  raiz = raiz || RAIZ;
  if (process.env.TRACKEROAO_SEM_ATUALIZAR) return { atualizou: false, motivo: 'desligada por variável de ambiente' };
  try {
    return fs.existsSync(path.join(raiz, '.git')) ? await viaGit(raiz) : await viaRelease(raiz);
  } catch (e) {
    return { atualizou: false, erro: e.message };
  }
}

module.exports = { verificar, aplicarPasta, listar, lerEstado, EXIGIDOS, LEGADO, PRESERVAR, NOME_ESTADO };

/*
 * Linha de comando.
 *
 *   node sync/atualizar.js                                confere e aplica
 *   node sync/atualizar.js --aplicar <pasta> <tag> <destino>
 *
 * A segunda forma é a que o instalador usa: ele já baixou e descompactou, e só
 * precisa da cópia -- a mesma que a atualização faz.
 */
if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === '--aplicar') {
    try {
      const r = aplicarPasta(path.resolve(a[1]), a[2], path.resolve(a[3] || RAIZ));
      console.log(`${a[2]}: ${r.copiados} arquivos` + (r.removidos.length ? `, removidos: ${r.removidos.join(', ')}` : ''));
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  } else {
    verificar().then((r) => {
      console.log(r.atualizou ? `atualizado: ${r.de || '?'} -> ${r.para}` : (r.erro || r.motivo || 'já está na versão atual'));
      if (r.erro) process.exit(1);
    });
  }
}

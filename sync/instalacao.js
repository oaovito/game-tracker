'use strict';
/*
 * instalacao.js - o Sekiro ainda está instalado nesta máquina?
 *
 * A pergunta parece simples e não é. A pasta de save NÃO serve de resposta:
 * ela fica em %APPDATA%\Sekiro e sobrevive à desinstalação, que é justamente o
 * motivo de o progresso continuar lá quando se reinstala o jogo.
 *
 * O que some quando o jogo é removido é o `appmanifest_814380.acf` da
 * biblioteca do Steam e a chave de desinstalação no registro. São esses dois
 * que consultamos.
 *
 * A função devolve três respostas, e a terceira é a que importa:
 *
 *   true  - achamos o jogo
 *   false - o Steam respondeu e o jogo não está lá
 *   null  - NÃO SABEMOS
 *
 * `null` acontece quando o Steam não está instalado, o registro não responde,
 * ou a biblioteca está num disco que não foi montado agora. Tratar isso como
 * "desinstalado" desligaria o serviço de quem só desconectou um HD externo.
 * Quem chama tem de agir apenas no `false`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_ID = '814380';

function regQuery(chave, valor) {
  try {
    const args = ['query', chave];
    if (valor) args.push('/v', valor);
    return execFileSync('reg', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return null;                      // chave ausente, ou reg indisponível
  }
}

/** Onde o Steam está instalado, segundo o próprio registro dele. */
function steamPath() {
  const saida = regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (!saida) return null;
  const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(saida);
  if (!m) return null;
  return m[1].trim().replace(/\//g, '\\');
}

/**
 * Todas as bibliotecas do Steam, inclusive as de outros discos.
 *
 * O arquivo é VDF, não JSON; aqui só interessa o campo "path", e tentar
 * interpretar o formato inteiro seria trabalho para nada.
 */
function bibliotecas(steam) {
  const libs = [steam];
  const vdf = path.join(steam, 'steamapps', 'libraryfolders.vdf');
  try {
    const txt = fs.readFileSync(vdf, 'utf8');
    const re = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt))) libs.push(m[1].replace(/\\\\/g, '\\'));
  } catch (e) { /* sem o arquivo, fica só a pasta principal */ }
  return [...new Set(libs)];
}

/**
 * Devolve { instalado, evidencias, checagemValida }.
 *
 * `checagemValida` diz se dá para confiar num `instalado: false`. Sem o Steam
 * localizado, a resposta não vale nada e sai como null.
 */
function estado() {
  if (process.platform !== 'win32') {
    return { instalado: null, checagemValida: false, evidencias: ['fora do Windows: não sei checar'] };
  }

  const steam = steamPath();
  if (!steam) {
    return { instalado: null, checagemValida: false, evidencias: ['Steam não localizado no registro'] };
  }

  const evidencias = [];
  let achou = false;

  let libsLidas = 0;
  for (const lib of bibliotecas(steam)) {
    const manifesto = path.join(lib, 'steamapps', `appmanifest_${APP_ID}.acf`);
    let existe = false;
    try { existe = fs.existsSync(manifesto); libsLidas++; } catch (e) { continue; }
    if (existe) { achou = true; evidencias.push(`manifesto em ${lib}`); }
  }
  if (!libsLidas) {
    return { instalado: null, checagemValida: false, evidencias: ['nenhuma biblioteca do Steam pôde ser lida'] };
  }

  const uninstall = regQuery(`HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App ${APP_ID}`);
  if (uninstall) { achou = true; evidencias.push('chave de desinstalação no registro'); }

  if (!achou) evidencias.push(`sem manifesto em ${libsLidas} biblioteca(s) e sem chave no registro`);
  return { instalado: achou, checagemValida: true, evidencias };
}

module.exports = { estado, steamPath, bibliotecas, APP_ID };

if (require.main === module) {
  const e = estado();
  const rotulo = e.instalado === true ? 'INSTALADO' : e.instalado === false ? 'NÃO INSTALADO' : 'NÃO SEI';
  console.log(`  Sekiro: ${rotulo}`);
  for (const x of e.evidencias) console.log(`    - ${x}`);
}

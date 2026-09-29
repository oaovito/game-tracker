'use strict';
/**
 * idioma.js - o idioma escolhido à mão no globo da página.
 *
 * Um arquivo só, substituído no lugar a cada escolha: sync/idioma.json com
 * { "idioma": "<código>" }, ou sem o arquivo quando a pessoa volta a seguir o
 * idioma do sistema. A página, a bandeja e a janela do Windows leem daqui.
 */
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, 'idioma.json');
// Os códigos que a página sabe falar. Qualquer outro é recusado.
const IDIOMAS = ['en', 'pt-BR', 'es', 'fr', 'de', 'it', 'ru', 'pl', 'tr', 'ja', 'ko', 'zh-CN'];

function ler() {
  try {
    const v = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')).idioma;
    return IDIOMAS.includes(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function gravar(v) {
  if (v === null || v === undefined || v === '') {
    try { fs.unlinkSync(ARQUIVO); } catch (e) { /* já não havia */ }
    return null;
  }
  if (!IDIOMAS.includes(v)) throw new Error('idioma desconhecido: ' + v);
  fs.writeFileSync(ARQUIVO, JSON.stringify({ idioma: v }));
  return v;
}

module.exports = { ler, gravar, IDIOMAS, ARQUIVO };

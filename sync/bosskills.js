'use strict';
/*
 * bosskills.js - quantas vezes cada chefe foi morto.
 *
 * O jogo não guarda isso. As flags de chefe são booleanas (morto / não morto) e
 * as Memories são posse de item, não quantidade. Então não há número para ler:
 * há um número para construir.
 *
 * Como se constrói:
 *
 *   - Semente: o que já está morto no ciclo atual conta como 1. Não dá para
 *     saber quantas vezes você matou o Gyoubu antes de eu existir, e chutar
 *     seria pior do que começar de 1.
 *   - Daí em diante: cada vez que uma flag vai de desligada para ligada, é mais
 *     uma morte. É o que acontece a cada NG+, quando as flags zeram e você mata
 *     tudo de novo.
 *
 * Ou seja: é exato do momento em que o serviço começou a olhar, e um piso antes
 * disso. A página diz isso, em vez de apresentar o número como se fosse do jogo.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'bosskills.json');

function carregar(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo || ARQUIVO, 'utf8')); } catch (e) { return null; }
}

function gravar(estado, arquivo) {
  const alvo = arquivo || ARQUIVO;
  const tmp = alvo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 1));
  fs.renameSync(tmp, alvo);
}

/**
 * Atualiza a contagem a partir da lista de chefes da leitura atual.
 *
 * `bosses` é o array que o parse monta: cada item com `key` e `defeated`.
 * Devolve um mapa chave -> { vezes, desde, semeado }.
 */
function atualizar(bosses, opts) {
  const o = opts || {};
  const arquivo = o.arquivo || ARQUIVO;
  let estado = carregar(arquivo);
  const agora = new Date().toISOString();

  if (!estado) {
    estado = { iniciadoEm: agora, chefes: {} };
    for (const b of bosses) {
      if (typeof b.defeated !== 'boolean') continue;
      estado.chefes[b.key] = {
        vezes: b.defeated ? 1 : 0,
        // `semeado` marca que o 1 veio da semente, e não de uma morte que eu vi.
        semeado: b.defeated === true,
        ultima: b.defeated ? null : null,
        estava: b.defeated,
      };
    }
    gravar(estado, arquivo);
    return estado;
  }

  let mudou = false;
  for (const b of bosses) {
    if (typeof b.defeated !== 'boolean') continue;
    let c = estado.chefes[b.key];
    if (!c) {
      // Chefe novo no config: entra com a mesma regra da semente.
      c = estado.chefes[b.key] = { vezes: b.defeated ? 1 : 0, semeado: b.defeated, ultima: null, estava: b.defeated };
      mudou = true;
      continue;
    }
    // Só a transição desligado -> ligado conta. O caminho inverso é o NG+
    // zerando as flags, e não é uma morte a menos.
    if (b.defeated && !c.estava) {
      c.vezes += 1;
      c.ultima = agora;
      c.semeado = false;
      mudou = true;
    }
    if (c.estava !== b.defeated) { c.estava = b.defeated; mudou = true; }
  }
  if (mudou) gravar(estado, arquivo);
  return estado;
}

/** O formato que a página consome: uma entrada por chefe, na ordem recebida. */
function paraProgresso(bosses, estado) {
  const e = estado || carregar() || { chefes: {} };
  return bosses.map((b) => {
    const c = e.chefes[b.key] || { vezes: 0, semeado: false, ultima: null };
    return {
      key: b.key,
      label: b.label,
      area: b.area || null,
      defeated: b.defeated === true,
      emblema: b.emblema || null,
      emblemaPorque: b.emblemaPorque || null,
      enquadre: b.enquadre || null,
      vezes: c.vezes || 0,
      // `semeado` avisa que o número é um piso: a contagem exata começou depois.
      semeado: c.semeado === true,
      ultima: c.ultima || null,
    };
  });
}

module.exports = { atualizar, paraProgresso, carregar, ARQUIVO };

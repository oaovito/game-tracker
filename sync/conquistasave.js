'use strict';
/*
 * conquistasave.js - as 34 conquistas tiradas do save, sem Steam.
 *
 * O jogo concede cada conquista por AwardAchievement(N) nos próprios scripts
 * de evento, e N segue a ordem de conquistas-lista.json (0 = Sekiro ... 33 =
 * Great Colored Carp). O que interessa ao tracker é o que o jogo grava junto
 * no save, e isso existe para quase todas:
 *
 *   - chefes e finais: ao lado de cada concessão o jogo liga uma flag da
 *     faixa 68xx, a mesma que o common.emevd consulta para dar o Man Without
 *     Equal (6800-6817), e os quatro finais ligam 6830-6833;
 *   - Resurrection: a flag 8250 é ligada logo depois da concessão;
 *   - o resto é inventário: próteses e suas melhorias, ninjutsu, habilidades,
 *     a cabaça e os colares.
 *
 * Fontes (conferidas uma a uma, não copiadas de lembrança):
 *   common.emevd decompilado (Man Without Equal, Ashina Traveler, Resurrection);
 *   SoulsRandomizers events.txt e annotations.txt (chefes, finais, carpa);
 *   tabela de itens do Sekiro-Practice-CT e o Paramdex (ids de item e skill).
 *
 * Cada regra devolve true, false ou null. null é "o save não diz": acontece
 * nas duas conquistas sem prova confiável no save (Memorial Mob e Great
 * Serpent) e quando a leitura das flags não calibrou. A página não transforma
 * null em "não conquistada" sem dizer: ela marca a conquista como incerta.
 *
 * A Steam, quando está na máquina, confere. Ela nunca é a fonte de que o
 * resto depende: sem ela, isto aqui é a lista inteira.
 */

const path = require('path');

const LISTA = require('./conquistas-lista.json').lista;

const faixa = (de, ate, passo) => {
  const r = [];
  for (let i = de; i <= ate; i += passo) r.push(i);
  return r;
};

/* Próteses: 7X000 é a ferramenta, 7X100..7X500 as melhorias. */
const PROTESES = faixa(70000, 79000, 1000);
const MELHORIAS = [
  ...faixa(70100, 70500, 100), ...faixa(71100, 71300, 100), ...faixa(72100, 72300, 100),
  ...faixa(73100, 73300, 100), ...faixa(74100, 74200, 100), ...faixa(75100, 75300, 100),
  ...faixa(76100, 76300, 100), ...faixa(77100, 77200, 100), ...faixa(78100, 78400, 100),
  ...faixa(79100, 79200, 100),
];
/* As quatro melhorias de lazulita que a comunidade confirma. */
const LAZULITA = [70500, 72300, 73300, 75300];

/* As 48 habilidades da árvore. */
const HABILIDADES = [
  ...faixa(200000, 200600, 100), 210000, 211000, ...faixa(301000, 301300, 100),
  310000, 310100, 410000, 410100, 411000, 510000, 510100, 511000, 511100,
  610100, 611100, 612100, 620000, 620100, 630000, 630100,
  ...faixa(640000, 640400, 100), ...faixa(650000, 650400, 100), ...faixa(660000, 660800, 100),
];
/* O "mistério" de cada estilo: a última habilidade de cada árvore. */
const MISTERIOS = [211000, 301300, 411000, 511100, 611100];

const NINJUTSU = [2100, 2110, 2120];

/* Flag de cada conquista de chefe (faixa 68xx) e a Memory equivalente (93xx). */
const CHEFES = {
  13: [6812, 9312], 20: [6801, 9301], 21: [6802, 9302], 22: [6803, 9303], 23: [6804, 9304],
  24: [6814, 9314], 25: [6805, 9305], 26: [6808, 9308], 27: [6817, 9317], 28: [6809, 9309],
  29: [6810, 9310], 30: [6816, 9316], 31: [6813, 9313],
};
const FINAIS = { 9: 6830, 10: 6831, 11: 6832, 12: 6833 };

/**
 * Deriva as 34.
 *
 * `f(id)` lê uma event flag (true/false/null); `goods` é Map id -> quantidade;
 * `armas` é o Set dos ids na categoria de arma (próteses e habilidades moram
 * ali); `essenciais` é o bloco de mesmo nome do progress.json.
 *
 * Devolve [{ indice, conquistada, como }], em que `como` diz em uma frase o
 * que no save provou (ou não) aquela conquista.
 */
function derivar({ f, goods, armas, essenciais }) {
  const tem = (id) => (goods && goods.has(id)) || (armas && armas.has(id));
  const todas = (ids) => ids.every(tem);
  const alguma = (ids) => ids.some(tem);
  const flag = (id) => (f ? f(id) : null);
  // Flag lida como true decide; false só decide quando a leitura existe.
  const qualquerFlag = (ids) => {
    const v = ids.map(flag);
    if (v.some((x) => x === true)) return true;
    if (v.every((x) => x === false)) return false;
    return null;
  };

  const r = {};
  const por = (i, conquistada, como) => { r[i] = { indice: i, conquistada, como }; };

  // 1. Man Without Equal: exatamente as flags que o common.emevd confere.
  {
    const ids = [...faixa(6800, 6806, 1), ...faixa(6808, 6817, 1)];
    const v = ids.map(flag);
    por(1, v.includes(null) ? null : v.every(Boolean), 'flags 6800-6806 e 6808-6817');
  }
  // 2. Ashina Traveler: as duas áreas que o evento 130 exige por último.
  por(2, (() => { const a = flag(132), b = flag(140); return a === null || b === null ? null : a && b; })(),
    'flags 132 e 140, as visitas registradas pelo evento 130');
  por(3, todas(MELHORIAS), 'as 30 melhorias de prótese no inventário');
  por(4, todas(HABILIDADES), 'as 48 habilidades no inventário');
  por(5, todas(PROTESES), 'as 10 próteses no inventário');
  por(6, todas(NINJUTSU), 'os três ninjutsu no inventário');
  {
    const e = essenciais && essenciais.prayerBeads;
    por(7, e ? e.necklaces >= (e.totalNecklaces || 10) : null, 'os 10 colares de contas');
  }
  {
    const g = essenciais && essenciais.gourdSeeds;
    por(8, g ? g.charges >= (g.maxCharges || 10) : null, 'a cabaça com 10 cargas');
  }
  for (const [i, id] of Object.entries(FINAIS)) por(Number(i), flag(id), 'flag ' + id + ' do final');
  for (const [i, ids] of Object.entries(CHEFES)) por(Number(i), qualquerFlag(ids), 'flags ' + ids.join(' / '));
  por(14, alguma(MISTERIOS), 'o mistério de algum estilo de combate');
  por(15, alguma(LAZULITA), 'alguma prótese de lazulita');
  por(16, tem(2300) ? true : null, 'a Kusabimaru no inventário');
  por(17, tem(2310) ? true : null, 'a prótese shinobi no inventário');
  // Sem prova no save: a flag da semente vendida por ele só prova quem comprou.
  por(18, flag(6721) === true ? true : null, 'a semente comprada do Memorial Mob, quando houve compra');
  por(19, flag(8250), 'flag 8250, ligada na primeira ressurreição');
  // A víscera é consumível: tê-la prova, não tê-la não desmente.
  por(32, alguma([9192, 9193]) ? true : null, 'a víscera da serpente, enquanto está na bolsa');
  por(33, flag(9370) === true || tem(9071) ? true : (flag(9370) === false ? false : null),
    'flag 9370 ou o Great White Whisker');

  // 0. Sekiro: todas as outras.
  {
    const outras = LISTA.filter((a) => a.indice !== 0).map((a) => (r[a.indice] || {}).conquistada);
    por(0, outras.every((x) => x === true) ? true : (outras.some((x) => x === false) ? false : null), 'todas as outras 33');
  }

  return LISTA.map((a) => r[a.indice] || { indice: a.indice, conquistada: null, como: 'sem regra' });
}

/**
 * Junta o que o save diz com o que a Steam diz, quando há Steam.
 *
 * O save manda na ausência dela. Com ela presente, uma conquista vale se
 * qualquer dos dois a tiver: a Steam guarda o que a CONTA já conquistou em
 * qualquer save e em qualquer ciclo, e o save só sabe deste personagem. Quando
 * os dois discordam, a conquista sai marcada com `confere: false` -- é a
 * conferência que o pedido descreve, visível e sem esconder o desencontro.
 */
function juntar(doSave, daSteam) {
  const steamPor = new Map();
  if (daSteam && Array.isArray(daSteam.lista)) {
    daSteam.lista.forEach((a, i) => steamPor.set(i, a));
  }
  const lista = LISTA.map((base) => {
    const s = doSave.find((x) => x.indice === base.indice) || { conquistada: null };
    const st = steamPor.get(base.indice);
    const temSteam = !!st;
    const conquistada = s.conquistada === true || (temSteam && st.conquistada === true);
    const fonte = s.conquistada === true && temSteam && st.conquistada ? 'ambos'
      : s.conquistada === true ? 'save'
      : temSteam && st.conquistada ? 'steam' : null;
    return {
      bloco: base.indice,
      nome: (st && st.nome) || base.nome,
      descricao: (st && st.descricao) || base.descricao,
      oculta: base.oculta,
      conquistada,
      em: st && st.em ? st.em : null,
      fonte,
      doSave: s.conquistada,
      comoNoSave: s.como,
      incerta: !temSteam && s.conquistada === null,
      confere: temSteam && s.conquistada !== null ? s.conquistada === !!st.conquistada : null,
    };
  });
  return {
    total: lista.length,
    desbloqueadas: lista.filter((a) => a.conquistada).length,
    lista,
    fonte: daSteam && daSteam.lista ? 'save+steam' : 'save',
    divergentes: lista.filter((a) => a.confere === false).map((a) => a.nome),
  };
}

module.exports = { derivar, juntar, LISTA, CHEFES, FINAIS, HABILIDADES, MELHORIAS, PROTESES, MISTERIOS, LAZULITA };

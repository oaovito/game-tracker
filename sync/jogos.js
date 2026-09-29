'use strict';
/*
 * jogos.js - quais jogos o tracker vigia, e qual deles esta escolhido.
 *
 * Sao duas coisas com tempos de vida diferentes, e por isso moram em arquivos
 * diferentes:
 *
 *   sync/jogos.json  catalogo. Versionado, igual em toda maquina, e so muda
 *                    quando um jogo novo passa a ser suportado.
 *   selecao.json     escolha. Estado desta maquina, fora do git como os
 *                    outros arquivos de estado, e muda quando a pessoa mexe
 *                    na pagina.
 *
 * Misturar os dois daria o problema de sempre: atualizar o projeto
 * sobrescreveria a escolha de quem instalou, ou a escolha entraria no commit
 * de quem desenvolve.
 *
 * O padrao, sem selecao gravada, e vigiar TUDO que o catalogo lista. E o
 * comportamento que nao surpreende: quem instalou e abriu o jogo espera que o
 * tracker perceba, sem antes ter de ir escolher nada.
 */

const fs = require('fs');
const path = require('path');

const CATALOGO = path.join(__dirname, 'jogos.json');
const SELECAO = path.join(__dirname, '..', 'selecao.json');

/** Os jogos que o projeto sabe ler, versionados em jogos.json. */
function suportados() {
  try {
    const j = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
    return Array.isArray(j.lista) ? j.lista : [];
  } catch (e) {
    return [];
  }
}

/*
 * O catálogo inteiro: os suportados mais o que a varredura achou nesta
 * máquina e na conta (ver biblioteca.js).
 *
 * Um jogo achado pela varredura entra com leitura 'nenhuma': o tracker sabe
 * que ele abriu e fechou, e é só. Ele pode ser vigiado para acender a
 * aplicação, que é o que a escolha de jogos promete, e aparece na tela de
 * jogos com os pinos de instalado e de vigiado.
 */
function catalogo() {
  const base = suportados();
  let achados = [];
  try { achados = (require('./biblioteca').ultima() || {}).jogos || []; } catch (e) { achados = []; }
  const lista = base.map((g) => {
    const b = achados.find((a) => a.appId && g.appId && String(a.appId) === String(g.appId));
    return { ...g, instalado: b ? !!b.instalado : null, fontes: b ? b.fontes : [], popular: b ? b.popular : null };
  });
  for (const a of achados) {
    if (lista.some((g) => g.appId && a.appId && String(g.appId) === String(a.appId))) continue;
    lista.push({
      chave: a.chave, nome: a.nome, appId: a.appId || null, processos: a.processos || [],
      leitura: 'nenhuma', instalado: !!a.instalado, fontes: a.fontes || [], popular: a.popular || null,
    });
  }
  return lista;
}

/** As chaves escolhidas, ou null quando ninguem escolheu ainda. */
function escolhidas() {
  try {
    const j = JSON.parse(fs.readFileSync(SELECAO, 'utf8'));
    if (!Array.isArray(j.jogos)) return null;
    // Uma chave que nao existe mais no catalogo e ignorada em vez de derrubar
    // a leitura: o catalogo pode encolher numa atualizacao, e a escolha antiga
    // continuaria gravada aqui sem culpa de ninguem.
    const validas = new Set(catalogo().map((g) => g.chave));
    return j.jogos.filter((c) => validas.has(c));
  } catch (e) {
    return null;
  }
}

/** Os jogos vigiados agora: os escolhidos, ou todos quando nao ha escolha. */
function vigiados() {
  const todos = catalogo();
  const esc = escolhidas();
  // Sem escolha, vigia os que o projeto sabe ler, e não tudo que a varredura
  // achou: a bandeja acendendo a cada jogo instalado seria o contrário de
  // aparecer em silêncio.
  if (!esc) return todos.filter((g) => g.leitura === 'completa');
  return todos.filter((g) => esc.includes(g.chave));
}

/**
 * Os nomes de imagem a procurar, em minuscula e sem repeticao.
 *
 * Nome de imagem e nao caminho: o mesmo jogo instalado em disco diferente tem
 * caminho diferente e executavel igual, e e o executavel que identifica.
 */
function processos() {
  const nomes = [];
  for (const g of vigiados()) {
    for (const p of g.processos || []) {
      const n = String(p).toLowerCase();
      if (!nomes.includes(n)) nomes.push(n);
    }
  }
  return nomes;
}

/** O jogo a que um nome de processo pertence, ou null. */
function porProcesso(nome) {
  const alvo = String(nome || '').toLowerCase();
  return vigiados().find((g) => (g.processos || []).some((p) => String(p).toLowerCase() === alvo)) || null;
}

/**
 * Grava a escolha.
 *
 * Lista vazia e escolha valida e quer dizer "nao vigie nada": a aplicacao
 * deixa de acender sozinha e so abre pelo atalho. Isso e diferente de nunca
 * ter escolhido, que vigia tudo -- e a diferenca entre uma decisao e a
 * ausencia dela.
 */
function selecionar(chaves) {
  const validas = new Set(catalogo().map((g) => g.chave));
  const limpas = (Array.isArray(chaves) ? chaves : [])
    .map(String)
    .filter((c) => validas.has(c));
  fs.writeFileSync(SELECAO, JSON.stringify({ jogos: limpas }, null, 2) + '\n');
  return limpas;
}

/** O que a pagina precisa saber para desenhar a escolha. */
function paraProgresso() {
  const esc = escolhidas();
  return {
    lista: catalogo().map((g) => ({
      chave: g.chave,
      nome: g.nome,
      leitura: g.leitura || 'nenhuma',
      vigiado: esc ? esc.includes(g.chave) : (g.leitura === 'completa'),
      instalado: g.instalado === undefined ? null : g.instalado,
      naSteam: (g.fontes || []).some((f) => /^steam/.test(f)),
      semSteam: (g.fontes || []).some((f) => !/^steam/.test(f)),
      popular: g.popular || null,
    })),
    // Distingue "nunca escolheu" de "escolheu nenhum", que tem efeitos opostos.
    escolheu: esc !== null,
    varredura: (() => {
      try {
        const b = require('./biblioteca').ultima();
        return b ? { em: b.em, comSteam: b.comSteam } : null;
      } catch (e) { return null; }
    })(),
  };
}

module.exports = {
  suportados, catalogo, escolhidas, vigiados, processos, porProcesso, selecionar, paraProgresso,
  CATALOGO, SELECAO,
};

if (require.main === module) {
  const v = vigiados();
  console.log('  catalogo : ' + catalogo().map((g) => g.chave).join(', '));
  console.log('  escolha  : ' + (escolhidas() ? escolhidas().join(', ') || '(nenhum)' : '(nao escolheu: vigia tudo)'));
  console.log('  vigiando : ' + (v.map((g) => g.nome).join(', ') || 'nada'));
  console.log('  processos: ' + (processos().join(', ') || 'nenhum'));
}

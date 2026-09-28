'use strict';
/*
 * efeitos.js - efeitos temporários que reagem ao que aconteceu na sessão.
 *
 * Dois pedidos chegaram com a mesma forma: fogo no anel por 6 horas depois de
 * duas conquistas na mesma sessão, e podridão no bloco de mortes por 6 horas
 * depois de cinco mortes na mesma sessão. Em vez de dois mecanismos parecidos
 * vivendo em lugares diferentes, é um só aqui, com os gatilhos declarados numa
 * tabela — um terceiro efeito no futuro é uma linha, não um módulo.
 *
 * O que é uma "sessão": uma execução do jogo. A identidade vem do pid, porque
 * ele muda a cada abertura e não depende de gravar nada. Fechou o jogo, a
 * contagem da sessão volta a zero na próxima; o efeito já acionado, não — ele
 * corre pelo relógio até vencer, e é isso que o pedido quer dizer com "por 6
 * horas depois".
 *
 * O que é publicado é o tempo QUE FALTA, nunca a hora em que começou. A hora
 * diria quando a pessoa estava jogando, que é justamente o que o site público
 * não mostra. Segundos restantes dizem só que o efeito está aceso.
 */

const fs = require('fs');
const path = require('path');

const ESTADO = path.join(__dirname, '..', 'efeitos.json');
const SEIS_HORAS = 6 * 60 * 60 * 1000;

/**
 * Os efeitos, declarados.
 *
 * `medir` recebe o que se sabe agora e devolve quanto o gatilho já acumulou
 * NESTA sessão. `limiar` é onde acende. `duracao` é quanto tempo fica aceso
 * depois de acender, contado do momento em que o limiar foi cruzado.
 */
const EFEITOS = {
  // Cinco mortes numa sessão é o que o jogo chama de "você está espalhando
  // podridão": no Sekiro, morrer demais contamina os NPCs com 竜咳.
  podridao: {
    limiar: 5,
    duracao: SEIS_HORAS,
    medir: (agora) => (typeof agora.mortesNaSessao === 'number' ? agora.mortesNaSessao : null),
  },
  // Duas conquistas na mesma sessão: a sessão rendeu, e o anel pega fogo.
  fogo: {
    limiar: 2,
    duracao: SEIS_HORAS,
    medir: (agora, inicio) => {
      if (typeof agora.conquistas !== 'number') return null;
      if (typeof inicio.conquistas !== 'number') return 0;
      return Math.max(0, agora.conquistas - inicio.conquistas);
    },
  },
};

function carregar() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch (e) { return null; }
}

function gravar(e) {
  const tmp = ESTADO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(e, null, 1));
  fs.renameSync(tmp, ESTADO);
}

/**
 * Atualiza o estado com o que se sabe agora e devolve o que está aceso.
 *
 * `agora` traz `{ pid, mortesNaSessao, conquistas }`. `pid` nulo significa jogo
 * fechado: nada acende, mas o que já estava aceso continua correndo.
 */
function atualizar(agora, quando) {
  const t = quando || Date.now();
  const e = carregar() || { sessao: null, inicio: {}, ate: {} };

  // Sessão nova: o ponto de partida das medidas é o estado deste instante.
  // Sem isso, abrir o jogo com 19 conquistas contaria as 19 como ganhas agora.
  if (agora.pid && e.sessao !== agora.pid) {
    e.sessao = agora.pid;
    e.inicio = { conquistas: agora.conquistas, em: new Date(t).toISOString() };
  }
  if (!agora.pid) e.sessao = null;

  const aceso = {};
  for (const [nome, cfg] of Object.entries(EFEITOS)) {
    const ate = e.ate[nome] ? new Date(e.ate[nome]).getTime() : 0;

    // Acende só com o jogo aberto, porque só aí existe sessão para medir.
    if (agora.pid) {
      const quanto = cfg.medir(agora, e.inicio || {});
      // Re-acender com o efeito já aceso estende a janela, e isso é de
      // propósito: morrer mais cinco vezes renova as seis horas em vez de
      // deixar a podridão vencer no meio de uma sessão ruim.
      if (typeof quanto === 'number' && quanto >= cfg.limiar) {
        e.ate[nome] = new Date(t + cfg.duracao).toISOString();
      }
    }

    const fim = e.ate[nome] ? new Date(e.ate[nome]).getTime() : 0;
    const resta = Math.max(0, Math.round((fim - t) / 1000));
    if (resta > 0) aceso[nome] = resta;
    else if (e.ate[nome] && fim <= t) delete e.ate[nome];   // venceu: some do estado
  }

  gravar(e);
  return aceso;
}

/** O que está aceso agora, sem mexer no estado. */
function ativos(quando) {
  const t = quando || Date.now();
  const e = carregar();
  if (!e || !e.ate) return {};
  const aceso = {};
  for (const [nome, iso] of Object.entries(e.ate)) {
    const resta = Math.max(0, Math.round((new Date(iso).getTime() - t) / 1000));
    if (resta > 0) aceso[nome] = resta;
  }
  return aceso;
}

module.exports = { atualizar, ativos, carregar, EFEITOS, ESTADO, SEIS_HORAS };

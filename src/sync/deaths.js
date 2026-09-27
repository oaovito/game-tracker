'use strict';
/*
 * deaths.js - contagem de mortes vista pelo save.
 *
 * Este é o caminho de reserva. O contador de verdade é o deathsmem.js, que lê
 * a memória do jogo em tempo real e dá o número exato — mas ele precisa de uma
 * calibração por diferença antes de valer, e enquanto ela não fecha é este
 * aqui que a página mostra.
 *
 * O que ele faz: conta as gravações do save em que o Sen caiu sem nenhum item
 * ter entrado. Isso é uma morte. O limite, que está dito na página, é que uma
 * morte só custa Sen quando o Unseen Aid não a perdoa — então o número é um
 * piso, nunca o total.
 *
 * O que ele NÃO faz mais: procurar um contador de mortes dentro do save. Essa
 * busca rodou, eliminou todos os candidatos em dez gravações, e a conclusão
 * bate com a pesquisa — o Sekiro não guarda essa conta em disco. O código dela
 * saiu junto com esta nota.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'deaths.json');

/** Só o que a contagem precisa. A busca por offset saiu; o estado encolheu junto. */
function estadoVazio(slot) {
  return {
    startedAt: new Date().toISOString(),
    slot,
    gravacoes: 0,
    mortesCertas: 0,
    contadas: 0,
    contandoDesde: new Date().toISOString(),
  };
}

function load(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile || STATE_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function save(estado, stateFile) {
  const alvo = stateFile || STATE_FILE;
  const tmp = alvo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 1));
  fs.renameSync(tmp, alvo);
}

/** O payload anterior fica só na memória: é 1 MiB e não vale gravar a cada sync. */
let anterior = null;

/**
 * Uma gravação do save foi vista. Devolve o estado atualizado.
 *
 * `goods` e `weapons` são os do parse; servem para separar morte de compra.
 */
function observar(opts) {
  const { payload, goods, weapons, slot, senOffset, stateFile } = opts;
  let estado = load(stateFile);
  if (!estado || estado.slot !== slot) estado = estadoVazio(slot);
  // Antes, a fase "nada" encerrava a observação de vez. Errado: ela só diz que
  // a BUSCA PELO CAMPO fracassou, e uma única leitura ruim bastava para chegar
  // lá. A contagem própria segue correndo de qualquer jeito.
  if (estado.fase === 'resolvido') return estado;

  const agora = {
    payload,
    sen: senOffset != null && senOffset + 4 <= payload.length ? payload.readUInt32LE(senOffset) : null,
    goods: new Map(goods),
    weapons: new Set(weapons),
  };

  if (!anterior) { anterior = agora; return estado; }

  // Mesma gravação relida: não é observação nenhuma, e contá-la falsearia a
  // evidência de "ficou parado".
  if (anterior.payload.equals(payload)) { anterior = agora; return estado; }

  const limite = Math.min(anterior.payload.length, payload.length);
  const ganhouItem = [...agora.goods].some(([id, q]) => q > (anterior.goods.get(id) || 0));
  const ganhouArma = [...agora.weapons].some((id) => !anterior.weapons.has(id));
  const senCaiu = agora.sen !== null && anterior.sen !== null && agora.sen < anterior.sen;
  const morteCerta = senCaiu && !ganhouItem && !ganhouArma;

  estado.gravacoes++;
  if (morteCerta) {
    estado.mortesCertas++;
    // Isto é o contador que a página mostra. Ele não depende da busca pelo
    // campo do jogo dar certo — e não deu: o Sekiro não guarda essa conta.
    estado.contadas = (estado.contadas || 0) + 1;
    if (!estado.contandoDesde) estado.contandoDesde = new Date().toISOString();
  }

  // Só a contagem, sem busca de offset: quem procura o campo agora é o
  // deathsmem.js, na memória do jogo.
  anterior = agora;
  save(estado, stateFile);
  return estado;
}

/**
 * O número de reserva: as mortes vistas pelo save.
 *
 * Quem manda é a memória do jogo, pelo deathsmem.js. Isto aqui cobre o período
 * até a calibração fechar, e os momentos em que o jogo está fechado.
 */
function paraProgresso(estado) {
  const e = estado || {};
  if (typeof e.contadas === 'number' && e.contadas > 0) {
    return {
      known: true,
      count: e.contadas,
      confidence: 'likely',
      how: 'counted',
      desde: e.contandoDesde || null,
    };
  }
  return {
    known: false,
    count: null,
    confidence: 'unknown',
    how: 'learning',
    contadas: 0,
  };
}

/** Zera o payload guardado em memória. Só o teste precisa disso. */
function reset() { anterior = null; }

module.exports = { observar, load, paraProgresso, reset, STATE_FILE };

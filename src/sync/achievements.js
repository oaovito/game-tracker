'use strict';
/*
 * achievements.js - as conquistas do Steam, lidas do disco.
 *
 * Não precisa de chave de API nem de perfil público: o próprio Steam guarda
 * duas coisas em appcache/stats,
 *
 *   UserGameStatsSchema_<app>.bin   o catálogo: id, nome interno, nome exibido
 *   UserGameStats_<conta>_<app>.bin o que esta conta desbloqueou, e quando
 *
 * Os dois são KeyValues binário da Valve, um formato simples de percorrer:
 * cada nó começa por um byte de tipo, seguido do nome terminado em zero, e o
 * fim de um objeto é o byte 0x08.
 *
 *   0x00 objeto aninhado   0x01 string    0x02 int32
 *   0x03 float32           0x04 ponteiro  0x05 wstring
 *   0x06 cor               0x07 uint64    0x08 fim do objeto
 *
 * O arquivo de progresso não guarda nome nenhum: só o número do bloco e a hora.
 * É o esquema que diz que o bloco 14 se chama "Immortal Severance". Por isso os
 * dois são lidos juntos, e por isso uma conquista sem par no esquema entra como
 * desconhecida em vez de sumir da conta.
 */

const fs = require('fs');
const path = require('path');
const instalacao = require('./instalacao');

const APP_ID = '814380';

/** Lê um nome terminado em zero a partir de `off`. */
function lerNome(buf, off) {
  let fim = off;
  while (fim < buf.length && buf[fim] !== 0) fim++;
  return { texto: buf.toString('utf8', off, fim), proximo: fim + 1 };
}

/**
 * Percorre um objeto de KeyValues binário a partir de `off`.
 * Devolve { valor, proximo }. Chave repetida vira lista, porque o esquema
 * repete "bits" para cada conquista.
 */
function lerObjeto(buf, off, prof) {
  const obj = {};
  if ((prof || 0) > 24) return { valor: obj, proximo: buf.length };   // trava
  let i = off;
  while (i < buf.length) {
    const tipo = buf[i];
    if (tipo === 0x08) { i += 1; break; }
    i += 1;
    const n = lerNome(buf, i);
    const chave = n.texto;
    i = n.proximo;
    let valor;
    if (tipo === 0x00) {
      const r = lerObjeto(buf, i, (prof || 0) + 1);
      valor = r.valor; i = r.proximo;
    } else if (tipo === 0x01) {
      const s = lerNome(buf, i); valor = s.texto; i = s.proximo;
    } else if (tipo === 0x02 || tipo === 0x04 || tipo === 0x06) {
      valor = buf.readInt32LE(i); i += 4;
    } else if (tipo === 0x03) {
      valor = buf.readFloatLE(i); i += 4;
    } else if (tipo === 0x05) {
      const s = lerNome(buf, i); valor = s.texto; i = s.proximo;
    } else if (tipo === 0x07) {
      valor = Number(buf.readBigUInt64LE(i)); i += 8;
    } else {
      break;                                   // tipo desconhecido: para aqui
    }
    if (obj[chave] === undefined) obj[chave] = valor;
    else if (Array.isArray(obj[chave])) obj[chave].push(valor);
    else obj[chave] = [obj[chave], valor];
  }
  return { valor: obj, proximo: i };
}

function lerArquivo(caminho) {
  try {
    const buf = fs.readFileSync(caminho);
    return lerObjeto(buf, 0, 0).valor;
  } catch (e) {
    return null;
  }
}

/** Anda pela árvore juntando todo nó que pareça definição de conquista. */
function colher(no, saida, idioma) {
  if (!no || typeof no !== 'object') return saida;
  for (const [chave, valor] of Object.entries(no)) {
    if (!valor || typeof valor !== 'object') continue;
    const bits = valor.bits;
    if (bits && typeof bits === 'object') {
      // `chave` aqui é o número do stat. Ele importa: o Sekiro tem dois grupos,
      // um com 32 bits e outro com 2, e os índices se repetem entre eles. Sem o
      // par (stat, bit) duas conquistas diferentes viram a mesma.
      for (const [idx, def] of Object.entries(bits)) {
        if (!def || typeof def !== 'object') continue;
        const disp = def.display || {};
        const nome = disp.name;
        const desc = disp.desc;
        saida.push({
          stat: Number(chave),
          bloco: Number(idx),
          id: chave + ":" + idx,
          chave: def.name || null,
          nome: (nome && (nome[idioma] || nome.english)) || def.name || ('#' + idx),
          descricao: (desc && (desc[idioma] || desc.english)) || null,
          oculta: String(disp.hidden) === '1' || disp.hidden === 1,
        });
      }
    }
    colher(valor, saida, idioma);
  }
  return saida;
}

/** { total, desbloqueadas, lista } ou null quando não dá para ler. */
function conquistas(opts) {
  const o = opts || {};
  const steam = o.steam || instalacao.steamPath();
  if (!steam) return null;
  const conta = o.conta;
  if (!conta) return null;

  const esquema = lerArquivo(path.join(steam, 'appcache', 'stats', `UserGameStatsSchema_${APP_ID}.bin`));
  const meu = lerArquivo(path.join(steam, 'appcache', 'stats', `UserGameStats_${conta}_${APP_ID}.bin`));
  if (!esquema) return null;

  const defs = colher(esquema, [], o.idioma || 'english');
  if (!defs.length) return null;

  // O progresso mora em algum lugar sob "AchievementTimes": bloco -> instante.
  const tempos = {};
  (function procurar(no, statAtual) {
    if (!no || typeof no !== 'object') return;
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === 'AchievementTimes' && valor && typeof valor === 'object') {
        // O pai deste nó é o número do stat: cache.<stat>.AchievementTimes.<bit>
        for (const [b, t] of Object.entries(valor)) {
          const id = statAtual + ":" + b;
          if (typeof t === 'number') tempos[id] = t;
          else if (t && typeof t === 'object' && typeof t.unlocked === 'number') tempos[id] = t.unlocked;
        }
      }
      if (valor && typeof valor === 'object') procurar(valor, /^\d+$/.test(chave) ? chave : statAtual);
    }
  })(meu, null);

  const lista = defs
    .sort((a, b) => a.stat - b.stat || a.bloco - b.bloco)
    .map((d) => ({
      bloco: d.bloco,
      chave: d.chave,
      nome: d.nome,
      descricao: d.oculta ? null : d.descricao,   // oculta continua oculta
      oculta: d.oculta,
      conquistada: tempos[d.id] !== undefined,
      em: tempos[d.id] ? new Date(tempos[d.id] * 1000).toISOString() : null,
    }));

  return {
    total: lista.length,
    desbloqueadas: lista.filter((a) => a.conquistada).length,
    lista,
    fonte: 'steam-local',
  };
}

module.exports = { conquistas, lerArquivo, lerObjeto, APP_ID };

if (require.main === module) {
  const tempo = require('./tempo');
  const sl2 = require('./sl2');
  const conta = tempo.contaDoSave(sl2.findSavePath());
  const c = conquistas({ conta });
  if (!c) { console.log('  não consegui ler as conquistas'); process.exitCode = 1; }
  else {
    console.log(`  ${c.desbloqueadas}/${c.total} conquistas`);
    for (const a of c.lista) {
      console.log(`  ${a.conquistada ? '[x]' : '[ ]'} ${String(a.bloco).padStart(2)}  ${a.nome}`);
    }
  }
}

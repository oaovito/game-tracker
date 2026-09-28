'use strict';
/*
 * conquistas.js - ícones e dificuldade das conquistas, baixados uma vez.
 *
 * Duas coisas que o cache local do Steam não tem e a página precisa:
 *
 *   ÍCONE     — o arquivo de stats guarda só os bits de quem conquistou o quê.
 *               A arte mora no CDN da Steam, e é baixada uma vez para dentro
 *               do repositório, como a arte dos chefes. Hotlink quebraria no
 *               dia em que o outro lado mudasse de caminho.
 *
 *   DIFICULDADE — o jogo não classifica conquista em fácil, média ou difícil, e
 *               eu também não vou classificar: seria opinião com cara de dado.
 *               O que existe de objetivo é quantos jogadores no mundo têm cada
 *               uma, que a Steam publica. Raridade não é exatamente
 *               dificuldade — uma conquista de fim de jogo é rara também
 *               porque pouca gente termina —, mas é uma medida real, a mesma
 *               para todos, e dá para dizer de onde veio.
 *
 * A fonte é a página pública de estatísticas do jogo, que não pede chave de
 * API e traz ícone, nome, descrição e porcentagem na mesma linha.
 *
 * Roda à mão (`npm run conquistas`), não a cada leitura: é rede, e o número
 * muda devagar.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PAGINA = 'https://steamcommunity.com/stats/814380/achievements/';
const DESTINO = path.join(__dirname, '..', 'docs', 'icones', 'conquistas');
const TABELA = path.join(__dirname, 'conquistas.json');

/*
 * Os cortes de dificuldade, em porcentagem de jogadores que têm a conquista.
 *
 * Escolhidos onde a distribuição do Sekiro tem degraus de verdade: depois das
 * quatro primeiras o número despenca de 86% para 59%, e abaixo de 20% estão as
 * que quase ninguém tem. Não são tercis — tercil dividiria em três partes
 * iguais e chamaria de "difícil" coisas que 30% das pessoas têm.
 */
const CORTES = [
  ['facil', 50],
  ['media', 20],
  ['dificil', 0],
];

/**
 * A chave de ligação entre os dois lados: o nome, reduzido ao essencial.
 *
 * Um lado escreve `Isshin, the Sword Saint` e o outro pode escrever com aspas
 * escapadas ou espaço a mais. Minúsculas sem pontuação sobrevive aos dois, e
 * serve de nome de arquivo sem precisar de outra transformação.
 */
function slug(nome) {
  return String(nome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function dificuldade(percent) {
  for (const [nome, piso] of CORTES) if (percent >= piso) return nome;
  return 'dificil';
}

/*
 * As descrições que o jogo esconde.
 *
 * 23 das 34 conquistas do Sekiro são ocultas: nem o arquivo de stats local nem
 * a página pública da Steam trazem o texto delas antes de você desbloquear. E
 * "hidden until unlocked" na tela não ajuda ninguém a saber o que falta.
 *
 * A mesma lista de conquistas sai como troféus no PlayStation, e ali as
 * descrições são públicas desde sempre — é o mesmo jogo e o mesmo conjunto.
 * Copiadas de lá, palavra por palavra, e não escritas por mim: inventar o
 * texto de uma conquista oculta seria adivinhar o que o jogo pede.
 *
 * Usadas SÓ onde não há descrição vinda do jogo. Onde o próprio Sekiro diz
 * algo, é o Sekiro que manda.
 *
 * Fonte: lista de troféus de Sekiro: Shadows Die Twice (PowerPyx).
 */
const DESCRICOES_DE_RESERVA = {
  'sekiro': 'All achievements have been unlocked.',
  'man-without-equal': 'Defeated all bosses',
  'ashina-traveler': 'Traveled to all areas of the game',
  'master-of-the-prosthetic': 'Upgraded all Prosthetic Tools to their limit',
  'height-of-technique': 'Acquired all skills',
  'all-prosthetic-tools': 'Acquired all Prosthetic Tools',
  'all-ninjutsu-techniques': 'Acquired all Ninjutsu Techniques',
  'peak-physical-strength': 'Upgraded Vitality and Posture to their limit',
  'ultimate-healing-gourd': "Fully upgraded the 'Healing Gourd'",
  'immortal-severance': "Attained the 'Immortal Severance' ending",
  'purification': "Attained the 'Purification' ending",
  'dragon-s-homecoming': "Attained the 'Return' ending",
  'shura': "Attained the 'Shura' ending",
  'sword-saint-isshin-ashina': "Defeated 'Sword Saint Isshin Ashina'",
  'master-of-the-arts': 'Grasped the inner mysteries of any combat style',
  'lazuline-upgrade': 'Used Lapis Lazuli to upgrade any tool to its limit',
  'revered-blade': "Received the 'Kusabimaru' from Kuro",
  'shinobi-prosthetic': 'Acquired the Shinobi Prosthetic',
  'memorial-mob': 'Encountered the Memorial Mob',
  'resurrection': "Returned from the dead using 'Resurrection' for the first time",
  'gyoubu-masataka-oniwa': "Defeated 'Gyoubu Masataka Oniwa'",
  'the-phantom-lady-butterfly': "Defeated 'Lady Butterfly'",
  'genichiro-ashina': "Defeated 'Genichiro Ashina'",
  'guardian-ape': "Defeated the 'Guardian Ape'",
  'guardian-ape-immortality-severed': "Used the Mortal Blade to sever the Guardian Ape's undying",
  'folding-screen-monkeys': 'Caught the Folding Screen Monkeys',
  'great-shinobi-owl': "Defeated 'Great Shinobi – Owl'",
  'father-surpassed': "Defeated 'Great Shinobi – Owl' at the Hirata Estate",
  'corrupted-monk': "Defeated the 'Corrupted Monk'",
  'gracious-gift-of-tears': "Defeated the 'Divine Dragon' and obtained the 'Divine Dragon's Tears'",
  'isshin-ashina': "Defeated 'Isshin Ashina'",
  'demon-of-hatred': "Defeated the 'Demon of Hatred'",
  'great-serpent': "Defeated the 'Great Serpent'",
  'great-colored-carp': "Defeated the 'Great Colored Carp'",
};

/** A descrição de reserva, se houver, para um nome de conquista. */
function descricaoDeReserva(nome) {
  return DESCRICOES_DE_RESERVA[slug(nome)] || null;
}

function buscar(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'trackeroao' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(buscar(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' em ' + url));
      }
      const pedacos = [];
      res.on('data', (c) => pedacos.push(c));
      res.on('end', () => resolve(Buffer.concat(pedacos)));
    }).on('error', reject);
  });
}

/** Lê a página e devolve uma linha por conquista, na ordem em que aparecem. */
function extrair(html) {
  const linhas = [];
  const re = /<div class="achieveRow[^"]*">([\s\S]*?)<div style="clear: both;">/g;
  let m;
  while ((m = re.exec(html))) {
    const bloco = m[1];
    const icone = /<img src="([^"]+)"/.exec(bloco);
    const pct = /<div class="achievePercent">([\d.]+)%/.exec(bloco);
    const nome = /<h3>([\s\S]*?)<\/h3>/.exec(bloco);
    const desc = /<h5>([\s\S]*?)<\/h5>/.exec(bloco);
    if (!icone || !nome) continue;
    const limpo = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    linhas.push({
      nome: limpo(nome[1]),
      descricao: desc ? limpo(desc[1]) : '',
      icone: icone[1],
      percent: pct ? Number(pct[1]) : null,
    });
  }
  return linhas;
}

async function colher(opts) {
  const o = opts || {};
  const html = (await buscar(PAGINA)).toString('utf8');
  const linhas = extrair(html);
  if (!linhas.length) throw new Error('a página mudou de forma: nenhuma conquista reconhecida');

  fs.mkdirSync(DESTINO, { recursive: true });
  const tabela = {};
  let baixados = 0;

  for (const l of linhas) {
    /*
     * A ligação é pelo NOME, e isso foi verificado antes de valer.
     *
     * A primeira versão supôs que a ordem da página fosse a ordem das chaves
     * internas — primeira linha ACH00, segunda ACH01. Conferindo contra os
     * nomes que o save traz, o acerto foi de ZERO em 34: cada ícone teria ido
     * para a conquista errada, calado, e a página mostraria a arte do
     * Gyoubu na conquista de pegar a espada.
     *
     * Os dois lados têm os mesmos 34 nomes, então o nome é a chave boa. A
     * normalização existe porque um lado escapa aspas e o outro não.
     */
    const chave = slug(l.nome);
    const arquivo = chave + '.jpg';
    const caminho = path.join(DESTINO, arquivo);

    if (!fs.existsSync(caminho) || o.forcar) {
      try {
        fs.writeFileSync(caminho, await buscar(l.icone));
        baixados++;
      } catch (e) {
        if (!o.quieto) console.log(`  ${chave}: não baixou (${e.message})`);
      }
    }

    tabela[chave] = {
      nome: l.nome,
      percent: l.percent,
      dificuldade: l.percent === null ? null : dificuldade(l.percent),
      icone: fs.existsSync(caminho) ? 'icones/conquistas/' + arquivo : null,
    };
  }

  fs.writeFileSync(TABELA, JSON.stringify(tabela, null, 1));
  return { total: linhas.length, baixados, tabela: TABELA };
}

/** A tabela já colhida, ou null se ainda não rodou. */
function carregar() {
  try { return JSON.parse(fs.readFileSync(TABELA, 'utf8')); } catch (e) { return null; }
}

module.exports = { colher, carregar, extrair, dificuldade, slug, descricaoDeReserva, DESCRICOES_DE_RESERVA, CORTES, TABELA, DESTINO };

if (require.main === module) {
  colher({ forcar: process.argv.includes('--forcar') }).then((r) => {
    const t = carregar() || {};
    const conta = {};
    for (const v of Object.values(t)) conta[v.dificuldade] = (conta[v.dificuldade] || 0) + 1;
    console.log(`  ${r.total} conquistas, ${r.baixados} ícones baixados agora`);
    console.log(`  fácil ${conta.facil || 0}  |  média ${conta.media || 0}  |  difícil ${conta.dificil || 0}`);
  }).catch((e) => {
    console.error('  ' + e.message);
    process.exitCode = 1;
  });
}

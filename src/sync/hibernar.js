'use strict';
/*
 * hibernar.js - o jogo saiu da máquina, então o serviço sai também.
 *
 * A ideia é separar duas coisas que costumam vir juntas e não deveriam:
 *
 *   - o que RODA (tarefa agendada, processo node, portas abertas, respondedor
 *     de nome na rede) some por completo;
 *   - o que VALE (progresso lido, calibrações descobertas, e o próprio save)
 *     é guardado, e fica esperando.
 *
 * O save é copiado de propósito. Ele mora em %APPDATA%\Sekiro e normalmente
 * sobrevive à desinstalação — mas "normalmente" não é garantia: quem manda o
 * Steam apagar o conteúdo local, ou limpa o AppData, perde onze megabytes que
 * representam o jogo inteiro. Copiar custa pouco e é a única parte disto que
 * não dá para refazer.
 *
 * Nada aqui apaga coisa alguma. Hibernar é acrescentar uma cópia e desligar o
 * que roda; reativar é religar. O caminho de volta está em reativar.ps1.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ARQUIVO = path.join(RAIZ, 'arquivo');
const TAREFA = 'SekiroProgressSync';

/** Arquivos do projeto que valem a pena guardar, e por quê. */
const GUARDAR = [
  ['progress.json', 'a última leitura boa do progresso'],
  ['deaths.json', 'o que a busca do contador de mortes já descobriu'],
  ['sync/offsets.json', 'os offsets e nomes verificados'],
  ['sync/.state.json', 'qual slot é o seu'],
  ['qr-acesso.svg', 'o QR do endereço na rede local'],
];

function copiar(de, para) {
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
  return fs.statSync(para).size;
}

/**
 * Guarda tudo numa pasta com a data. Devolve o relatório do que foi guardado.
 *
 * Pasta nova a cada vez, em vez de sobrescrever: se isto rodar por engano, a
 * hibernação anterior continua intacta ao lado.
 */
function arquivar(opts) {
  const o = opts || {};
  const quando = new Date();
  const base = quando.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // O nome tem resolução de segundo, então duas hibernações no mesmo segundo
  // cairiam na mesma pasta e a segunda escreveria por cima da primeira. Na
  // prática não acontece (o processo encerra depois de hibernar), mas "na
  // prática não acontece" é o que se diz antes de acontecer.
  const raizArquivo = o.destino || ARQUIVO;
  let nome = base;
  let n = 2;
  while (fs.existsSync(path.join(raizArquivo, nome))) nome = `${base}-${n++}`;
  const destino = path.join(raizArquivo, nome);
  fs.mkdirSync(destino, { recursive: true });

  const guardados = [];
  for (const [rel, porque] of GUARDAR) {
    const de = path.join(RAIZ, rel);
    try {
      if (!fs.existsSync(de)) continue;
      const bytes = copiar(de, path.join(destino, 'projeto', rel));
      guardados.push({ arquivo: rel, bytes, porque });
    } catch (e) {
      guardados.push({ arquivo: rel, erro: e.message, porque });
    }
  }

  // O save: a parte insubstituível.
  const saves = [];
  for (const s of (o.saves || [])) {
    try {
      if (!fs.existsSync(s)) continue;
      const bytes = copiar(s, path.join(destino, 'save', path.basename(s)));
      saves.push({ arquivo: path.basename(s), bytes });
    } catch (e) {
      saves.push({ arquivo: path.basename(s), erro: e.message });
    }
  }

  const manifesto = {
    hibernadoEm: quando.toISOString(),
    motivo: o.motivo || 'Sekiro não está mais instalado nesta máquina',
    evidencias: o.evidencias || [],
    projeto: guardados,
    save: saves,
    comoVoltar: 'Reinstale o Sekiro e rode: powershell -ExecutionPolicy Bypass -File reativar.ps1',
    observacao:
      'Nada foi apagado. Esta pasta é cópia. O save original segue em %APPDATA%\\Sekiro ' +
      'se ninguém o removeu, e a cópia aqui existe para o caso de ele ter sido removido.',
  };
  fs.writeFileSync(path.join(destino, 'manifesto.json'), JSON.stringify(manifesto, null, 2));
  return { destino, manifesto };
}

/** Tira a tarefa agendada, que é o que faria o serviço voltar no próximo login. */
function removerTarefa() {
  try {
    execFileSync('schtasks', ['/Delete', '/TN', TAREFA, '/F'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: 'a tarefa não existia ou não pôde ser removida' };
  }
}

module.exports = { arquivar, removerTarefa, ARQUIVO, TAREFA, GUARDAR };

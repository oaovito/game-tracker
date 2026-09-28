# trackeroao

Tracker de progresso que lê o save do jogo e monta uma página com o que
encontrou. Hoje cobre **Sekiro: Shadows Die Twice**.

A página é **somente leitura**: tudo que ela mostra vem do save, do processo do
jogo ou da Steam — não existe marcação manual, e não existe número digitado.
Onde o jogo não registra algo, a página diz que não sabe em vez de estimar.

**Nada é escrito no jogo.** O save é aberto somente para leitura, e o handle do
processo é pedido sem permissão de escrita (`PROCESS_VM_READ` e
`PROCESS_QUERY_INFORMATION`, nada além).

Site publicado: https://oaovito.github.io/trackeroao/

## Instalando

Precisa de Node.js (>= 16). Nenhuma dependência: não existe `npm install` aqui,
e nada é baixado em tempo de execução. Clonar o repositório e rodar basta.

```powershell
git clone https://github.com/oaovito/trackeroao.git
cd trackeroao
.\install-sync-service.ps1
```

Isso registra uma tarefa agendada que sobe **oculta no login**. Depois disso
não precisa abrir mais nada: a página fica no ar o tempo todo e a leitura do
save liga sozinha quando você abre o Sekiro. **Não precisa de administrador** —
o programa só lê arquivos seus e escuta numa porta alta.

Para remover: `.\uninstall-sync-service.ps1`.

### Rodando na mão (para depurar)

```bash
cd tools/completionist && npm start
```

Ou dê dois cliques em `run.bat`. Pare o serviço antes, senão os dois brigam
pela porta 8777.

Isso sobe duas coisas:

- **o poll do processo** — a cada 5s checa se `sekiro.exe` está rodando. Só
  enquanto o jogo está aberto é que o watcher do save existe. Com o jogo
  fechado não há handle aberto no arquivo nem leitura de 11 MB.
- **o servidor** — escuta em `0.0.0.0:8777`, então dá para abrir do celular.
  Ao subir ele imprime o IP da máquina na rede local.

Outros comandos:

```bash
npm run selftest    # confere a leitura do save e o parsing nesta máquina
npm run sync        # lê o save uma vez e escreve progress.json
npm run serve       # só o servidor, sem o watcher
npm run discover    # descoberta por diff (veja abaixo)

```

Se o celular não abrir, libere a porta 8777 no Firewall do Windows para redes
privadas — é o motivo mais comum.

### O endereço pode mudar

O link do celular usa o IP da máquina na rede, e o roteador pode trocar esse
IP num reinício (DHCP). Se isso acontecer, o link salvo no celular para de
funcionar. Duas saídas:

- **Definitiva:** reserve o IP da máquina no roteador (DHCP reservation). Aí o
  endereço nunca muda e o link vale para sempre.

### Diagnóstico

Rodando oculto, a saída vai para `sync/trackeroao.log` (rotaciona em 512 KB).
Um boot saudável tem ~20 linhas e termina com o estado do jogo:

```
  >> Sekiro aberto - sincronização ativa
  [watch] monitorando C:\Users\...\S0000.sl2
```

Para ver se a tarefa está de pé: `Get-ScheduledTask TrackeroaoSync`.

## O que a página lê do save

| Item | Origem | Confiança |
|---|---|---|
| Prayer Beads (coletadas) | save | alta |
| Prayer Necklaces (1–10) | save | alta |
| Gourd Seeds **na bolsa** | save | alta |
| Os 9 materiais de prótese | save | média — nomes deduzidos |
| Chefes principais (com Memory) | save | alta |
| Ferramentas protéticas | save | alta (base) / média (upgrades) |
| Artes de combate | save | alta (básicas) / média (avançadas) |
| Mini-chefes | save (event flag) | alta |
| Great Serpent, Puppeteer Ninjutsu | save (posse do item) | alta |

**Os 62 itens da lista sincronizam automaticamente**, e todos carregam a
etiqueta `auto`. Não há checkbox clicável nem campo digitável: a página é um
reflexo do save. Se algo estiver errado, o lugar de corrigir é o
`offsets.json`, não a interface — assim a correção vale para sempre em vez de
virar uma marcação manual que diverge do jogo.

Como funciona cada um:

- **Prayer Beads.** As contas na bolsa são o item `4000`. As já gastas
  saem do inventário, então o total coletado é calculado como
  `colares × 4 + contas na bolsa`. Os colares são os itens `4100`–`4109`
  (são dez IDs distintos, um por colar — é isso que confirma os 10 colares).
  São **4 contas por colar** e **40 contas no jogo**. (O pedido original dizia
  "/5"; o correto é /4 — dez colares × quatro contas = quarenta.)
- **Gourd Seeds.** Item `4400`. Cuidado: o save só sabe quantas você
  tem **na bolsa**. Quando a Emma usa a semente para melhorar a cabaça, ela
  some do inventário. Então esse número **não** é "quantas você já achou" —
  são 9 sementes no jogo e a cabaça vai de 1 até 10 cargas. Quantas você já
  entregou não é legível, então esse contador mostra estoque, não coleta.
- **Materiais de prótese.** Itens `6000`–`6400`. Ver "confiança" abaixo.
- **Ferramentas protéticas.** Ficam na categoria `weapon` da tabela de itens,
  não em `goods`: `7X000` é a ferramenta base e `7X100`/`7X200`/`7X300` são os
  upgrades. Possuir o registro = ferramenta destravada. Os nomes internos são
  japoneses genéricos (`斧` = machado, `鉄扇` = leque de ferro), então o nome
  em inglês é dedução para algumas.
- **Artes de combate.** Também na categoria `weapon`, como registros de
  `解禁` (destravado): `210000` = Whirlwind Slash, `410000` = Ichimonji, e assim
  por diante. As básicas são inequívocas; as de fim de jogo são dedução a partir
  do japonês. `671000 = 剣聖居合` ("iai do Sword Saint") é **Dragon Flash**, que
  o jogo dá ao derrotar Isshin, the Sword Saint — bate com a descrição dele
  ("corte em alta velocidade a partir da bainha"). `673000 = 見えない居合連撃`
  ("iai invisível em combo") é **One Mind**.
- **Chefes.** Todo chefe principal dá uma *Memory*, que é um item
  (`5200`–`5222` enquanto não usada, `5300`–`5322` depois de gasta num Ídolo).
  Ter qualquer um dos dois = chefe derrotado.
- **Mini-chefes.** Não dão Memory, então vêm de *event flag* — mais precisamente
  da flag da Prayer Bead que cada um larga ao morrer. Ver a seção de event flags
  abaixo.
- **Casos especiais.** Alguns não deixam nenhum dos rastros acima:
  Genichiro (1ª luta) é a flag `9300` e Mist Noble a `9380`, ambas achadas no
  EMEVD (`Comment: End Tutorial Genichiro`, `Comment: Defeating Mist Noble`).
  O Great Serpent não é morto de forma normal, então a prova é ter a
  **Serpent Viscera** (goods `9192`/`9193`). Puppeteer Ninjutsu é ninjutsu e
  não prótese: goods `2110`.

### Sem o save disponível

Como não existe entrada manual, o estado de erro é a única saída da página, e
ele foi feito para não mentir: o total vira `—` com "aguardando o save", cada
seção vira `—/N` e os contadores viram `—`. Nada aparece como zero, porque
zero seria uma medição e o que existe é ausência de dado. A linha no topo diz o
motivo: servidor fora do ar, save não encontrado, ou o erro que o
`progress.json` reportou.

## Confiança dos dados

O formato do `.sl2` não é documentado pela FromSoftware. O que está aqui foi
verificado assim:

**Confirmado byte a byte nesta máquina** — o container é um BND4 comum, *sem
criptografia* (ao contrário de Dark Souls 3). São 12 blocos, `USER_DATA000` a
`USER_DATA011`: dez slots de personagem de 1 MiB, um bloco global e um vazio.
Cada bloco começa com o **MD5 dos bytes seguintes**, e isso foi conferido nos
12 blocos de um save real. Esse MD5 também serve de detector de leitura
partida: se o jogo estiver gravando na hora, o digest não bate e o leitor
tenta de novo em vez de reportar lixo.

**Alta** — os IDs de item vêm do `EquipParamGoods` do próprio jogo, onde os
nomes são inequívocos (`HP/体幹UPの欠片` = fragmento de vitalidade/postura =
Prayer Bead; `ボスソウル_お蝶` = Memory da Lady Butterfly).

**Média — vale conferir** — os nomes dos 9 materiais. O param chama todos de
"material genérico" numerado por tier (`鋼鉄1/2/3`, `化学2/3`, `呪術2/3`), sem
o nome que aparece em inglês no jogo. O mapa aqui segue a ordem dos tiers e
bate com um save real de meio de jogo (os materiais iniciais presentes, os de
fim de jogo todos zerados), mas se algum contador parecer trocado, confirme
com o `discover` e corrija o `offsets.json`.

**Event flags (mini-chefes)** — a área de flags do bloco comum fica no offset
`0x34` do payload, com 10 zonas de 128 bytes. O endereço de uma flag é
`base + zona*128 + word*4`, com `zona = (id/1000)%10`, `word = (id%1000)/32` e
`bit = 31 - ((id%1000)%32)` — a decomposição da FromSoftware, conferida contra
a decompilação do `GetEventFlag` no SoulSplitter.

Os ids vieram de duas fontes: chefes principais do enum `Boss` do SoulSplitter
(`9301`–`9317`) e mini-chefes do dump EMEVD, onde cada inimigo aparece seguido
da flag do item que ele larga ao morrer (`Chained Ogre → flag 6761 (Prayer
Bead)`). Como a conta só aparece quando o mini-chefe morre, essa flag equivale
a "derrotado".

A base foi confirmada de duas formas independentes:

1. As flags `9301`–`9317` batem **exatamente** com as Memories lidas da tabela
   de itens — dois mecanismos diferentes concordando.
2. A contagem de mini-chefes com flag ligada bate com as Prayer Beads do
   inventário: num save com 2 contas coletadas, exatamente 2 mini-chefes
   aparecem mortos. As outras bases candidatas davam 0.

O leitor **revalida isso a cada leitura**: se as flags de chefe discordarem das
Memories (um patch mover o bloco, por exemplo), ele procura uma base que
concorde, e se não achar uma única resposta, não reporta mini-chefe nenhum em
vez de reportar bit lido do lugar errado.

> Aviso: tudo isso é *reverse engineering*. Um patch do jogo pode mudar
> qualquer coisa. O leitor não usa offsets fixos onde dá para evitar — a
> tabela de itens é localizada pela estrutura, não por endereço — mas se algo
> parecer errado depois de uma atualização, rode `npm run selftest`.

## O contador de mortes

O Sekiro não mostra quantas vezes você morreu, e o save não guarda essa conta —
isso foi verificado por busca exaustiva, não suposto: a procura rodou, eliminou
todos os candidatos e o motivo ficou gravado em `deaths.json`.

O jogo guarda, porém, na memória. O número sai do `GameDataMan`, a struct que o
save carrega, no campo `+0x90`. Ela é encontrada por **padrão de bytes**, e não
por endereço fixo: as duas ferramentas públicas de contagem de mortes para
Sekiro gravam o endereço direto, e nenhuma das duas resolve na versão atual —
o ponteiro volta nulo. Procurar pelo padrão sobrevive a atualização do jogo.

A struct foi confirmada, não deduzida. O tempo de jogo interno é campo dela
(`+0x9c`), e dá para conferir contra as horas que a Steam registra: 54,7 h de
tempo interno contra 82,3 h de relógio, com menu e carregamento explicando a
diferença. Observando por uma hora, o tempo interno andou exatamente uma hora e
o campo das mortes não se moveu — o que separa um contador de evento de um
contador de quadro ou de relógio.

Existe também um contador **de sessão**, achado por diferença de snapshots da
memória, que serve de reserva se o padrão deixar de casar numa versão futura.
Ele zera quando o jogo abre, então mede só a partida atual. O escopo viaja
junto com o número (`"escopo": "jornada"` ou `"sessao"`), para a página nunca
mostrar um pelo outro.

```bash
npm run deaths            # mostra jornada, sessão, e compara com a última vez
npm run deaths mark       # tira uma foto da memória
npm run deaths confirm 3  # depois de morrer 3 vezes, cruza e acha o offset
```

O `mark`/`confirm` só é necessário para calibrar a reserva de sessão: a
contagem da jornada funciona sem calibração nenhuma.

**Nada disso escreve.** O handle é aberto com `PROCESS_VM_READ` e
`PROCESS_QUERY_INFORMATION` — sem `PROCESS_VM_WRITE`, sem
`PROCESS_VM_OPERATION`, e o `WriteProcessMemory` nem é importado. A suíte
verifica isso lendo o próprio `mem.ps1`.

## Descobrindo o que falta

Para mapear uma flag (um mini-chefe, um Ídolo) ou confirmar um material:

```bash
node sync/discover.js before
# no jogo: faça UMA coisa só (mate um mini-chefe, pegue um item)
# passe por um Ídolo para forçar o autosave
node sync/discover.js after
```

O `after` já compara com o `before` e mostra duas listas:

- **itens** — "goods 6000: 4 → 5". É assim que se confirma um material: pegue
  um Scrap Iron e veja qual ID subiu.
- **bytes crus** — mudanças de **um bit** primeiro, que é o formato típico de
  uma flag de chefe. Se você fez uma coisa só e aparece um único bit, achou.

Anote o resultado em `offsets.json` → `eventFlags.flags`:

```json
"chainedOgre": { "offset": 123456, "bit": 3, "confidence": "confirmed" }
```

A região comprimida no fim do slot (`0xF0000`–`0x100000`) é ignorada no diff
de bytes: ela se reescreve inteira a cada save e só geraria ruído.

## Onde ele procura o save

- Windows: `%APPDATA%\Sekiro\<steamid>\S0000.sl2`
- Linux / Steam Deck (Proton):
  `~/.local/share/Steam/steamapps/compatdata/814380/pfx/drive_c/users/steamuser/AppData/Roaming/Sekiro/<steamid>/S0000.sl2`
  (também procura em `~/.steam/steam`, no caminho do Flatpak e num prefixo Wine)

Com mais de uma conta Steam, ele pega a pasta modificada mais recentemente.

**Qual slot?** O jogo tem 10 slots. O sincronizador descobre o certo
observando qual bloco muda quando o jogo salva, e guarda isso em
`sync/.state.json`. Antes do primeiro autosave ele chuta o slot mais avançado
e diz no terminal que foi chute. Para fixar, ponha `"slot": 1` no
`offsets.json`.

## Arquivos

O repositório **é** o projeto: clonar e rodar basta, e `docs/` é a saída dele —
a mesma pasta que o GitHub Pages serve. Nada é resolvido fora desta pasta.

```
trackeroao/
  trackeroao.html             a página (abra pelo servidor, não por file://)
  run.bat                     execução manual
  install-sync-service.ps1    registra a tarefa agendada (não precisa de admin)
  uninstall-sync-service.ps1  remove a tarefa e encerra o serviço
  reativar.ps1                volta do arquivamento, se o jogo for reinstalado
  package.json                scripts npm (sem dependências)

  docs/                       o que vai para o ar (GitHub Pages)
    index.html                cópia da página, gerada
    progress.json             progresso saneado, sem nada de máquina ou conta
    icones/                   arte dos chefes, baixada uma vez

  sync/
    main.js                   poll do processo + watcher + servidor + publicação
    parse.js                  junta tudo e monta o progress.json

    sl2.js                    container BND4, MD5, acha o save
    inventory.js              tabela de itens (id + quantidade)
    flags.js                  event flags (chefes, mini-chefes, itens)
    offsets.json              toda a configuração e os IDs

    memoria.js                ponte para o leitor de memória (somente leitura)
    mem.ps1                   o leitor em si: P/Invoke, varredura por padrão
    deathsmem.js              contagem de mortes lida da memória do jogo
    deaths.js                 contagem por save, reserva do método acima

    achievements.js           conquistas da Steam (KeyValues binário)
    tempo.js                  tempo de jogo, do localconfig.vdf da Steam
    bosskills.js              conta cada vez que um chefe cai
    icones.js                 baixa a arte dos chefes uma vez

    publish.js                monta docs/ e barra o que identificaria a máquina
    serve.js                  servidor estático + IP da LAN
    mdns.js                   nome .local na rede, sem dependência

    oculto.vbs                sobe o serviço sem janela, via wscript do Windows

    instalacao.js             detecta se o jogo foi desinstalado
    hibernar.js               arquiva tudo e remove a tarefa agendada
    discover.js               descoberta de offsets por diff
    auditoria.js              relatório do que está público

    selftest.js               a suíte inteira
    pagetest.js               roda a página num DOM de brinquedo
    domshim.js                esse DOM de brinquedo
```

Fora do git, porque nascem em tempo de execução e carregam dados da máquina:
`progress.json` (a leitura crua, com o caminho do save), `deaths.json`,
`deaths-mem.json`, `bosskills.json`, `sync/trackeroao.log`, `sync/snapshots/`.

## Se der problema

- **"não achou o save"** — rode `npm run selftest`. Se o jogo nunca rodou
  nesta máquina, a pasta não existe.
- **a página diz "sem sincronização"** — ela não está falando com o serviço.
  Causas, da mais comum para a menos: o PC está desligado ou dormindo; o
  serviço caiu (veja `sync/trackeroao.log` e
  `Get-ScheduledTask TrackeroaoSync`); ou você abriu o arquivo HTML direto
  por `file://`, e aí o `fetch('progress.json')` não funciona — use o endereço
  do servidor.
- **números errados** — provavelmente é o slot. Veja qual o terminal escolheu
  e fixe com `"slot": N` no `offsets.json`.

# Sekiro — tracker de progresso com sync do save

Lê o save do Sekiro (`S0000.sl2`), extrai o que dá para extrair com confiança e
alimenta o `sekiro-progresso.html`. A página é **somente leitura**: tudo que
ela mostra vem do save, não existe marcação manual.

**O save nunca é escrito.** Todo o código abre o arquivo somente para leitura.

## Instalando (o jeito normal)

Precisa de Node.js (>= 16). Nenhuma dependência: não existe `npm install` aqui.

```powershell
cd C:\BrincadeiraDeCrianca\tools\completionist
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
  Ao subir ele imprime o IP da máquina na rede e desenha um QR code no
  terminal; aponte a câmera e abre direto.

Outros comandos:

```bash
npm run selftest    # confere QR, leitura do save e parsing nesta máquina
npm run sync        # lê o save uma vez e escreve progress.json
npm run serve       # só o servidor, sem o watcher
npm run discover    # descoberta por diff (veja abaixo)
npm run qr          # grava qr-acesso.svg com o endereço da LAN
```

Se o celular não abrir, libere a porta 8777 no Firewall do Windows para redes
privadas — é o motivo mais comum.

### O endereço pode mudar

O link do celular usa o IP da máquina na rede, e o roteador pode trocar esse
IP num reinício (DHCP). Se isso acontecer, o link salvo no celular para de
funcionar. Duas saídas:

- **Definitiva:** reserve o IP da máquina no roteador (DHCP reservation). Aí o
  endereço nunca muda e o link vale para sempre.
- **Paliativa:** o serviço regrava `qr-acesso.svg` a cada boot com o endereço
  atual, e o log sempre traz a URL nas primeiras linhas.

### Diagnóstico

Rodando oculto, a saída vai para `sync/sekiro-sync.log` (rotaciona em 512 KB).
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

```
tools/completionist/
  sekiro-progresso.html   a página (abra pelo servidor, não por file://)
  progress.json           gerado pelo sync; a página lê daqui
  run.bat                 execução manual
  install-sync-service.ps1    registra a tarefa agendada
  uninstall-sync-service.ps1  remove a tarefa e encerra o serviço
  package.json            scripts npm (sem dependências)
  sync/
    main.js               poll do processo + watcher + servidor
    sl2.js                container BND4, MD5, acha o save
    inventory.js          tabela de itens (id + quantidade)
    parse.js              monta o progress.json
    discover.js           descoberta por diff
    serve.js              servidor estático + IP da LAN + QR
    qr.js                 gerador de QR sem dependências
    qrfile.js             grava o QR como SVG (npm run qr)
    selftest.js           testes contra o save real
    flags.js              event flags (mini-chefes)
    offsets.json          toda a configuração e os IDs
    sekiro-sync.log       saída do serviço quando roda oculto (gerado)
    .state.json           slot aprendido (gerado)
    snapshots/            snapshots do discover (gerado)
```

## Se der problema

- **"não achou o save"** — rode `npm run selftest`. Se o jogo nunca rodou
  nesta máquina, a pasta não existe.
- **a página diz "sem sincronização"** — ela não está falando com o serviço.
  Causas, da mais comum para a menos: o PC está desligado ou dormindo; o
  serviço caiu (veja `sync/sekiro-sync.log` e
  `Get-ScheduledTask TrackeroaoSync`); ou você abriu o arquivo HTML direto
  por `file://`, e aí o `fetch('progress.json')` não funciona — use o endereço
  do servidor.
- **números errados** — provavelmente é o slot. Veja qual o terminal escolheu
  e fixe com `"slot": N` no `offsets.json`.
- **o QR não aparece direito** — o terminal precisa de cores ANSI. O endereço
  é impresso em texto logo abaixo do QR de qualquer jeito.

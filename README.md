# trackeroao

Tracker de progresso que lê o save do jogo e monta uma página com o que
encontrou. Hoje cobre **Sekiro: Shadows Die Twice**.

A página é somente leitura no sentido forte da palavra: tudo que ela mostra vem
do save, do processo do jogo ou da Steam, e não existe marcação manual nem
campo digitável em lugar nenhum. Onde o jogo não registra alguma coisa, a
página diz que não sabe — nunca estima. Essa regra é o que a torna útil: um
número que pode ser palpite não serve de referência para nada.

Nada é escrito no jogo. O save é aberto somente para leitura e o handle do
processo é pedido sem permissão de escrita (`PROCESS_VM_READ` e
`PROCESS_QUERY_INFORMATION`, nada além disso).

Site publicado: https://oaovito.github.io/trackeroao/

## Instalando

O projeto não tem dependência nenhuma. Não existe `npm install` aqui, nada é
baixado em tempo de execução, e clonar o repositório e rodar basta. O único
pré-requisito é Node.js 16 ou mais novo.

Para quem já tem git e Node na máquina:

```powershell
git clone https://github.com/oaovito/trackeroao.git
cd trackeroao
.\install-sync-service.ps1
```

Para quem não tem, existe `trackeroao-instalador.exe`, que resolve tudo sozinho:
instala o Node via winget se não houver, baixa a versão atual do projeto sem
exigir git, registra o serviço e roda a suíte no fim para provar que funcionou
naquela máquina. Ele atualiza uma instalação existente em vez de zerá-la,
preservando os arquivos de estado. O executável é gerado por
`construir-exe.ps1` a partir do `instalar.ps1`.

Toda release sai sozinha: uma tag `vX.Y.Z` enviada ao GitHub dispara
`.github/workflows/release.yml`, que confere se o `.exe` foi gerado do
`instalar.ps1` daquela tag e publica a release com ele anexado. As notas vêm de
`releases/<tag>.md`, e sem esse arquivo nada é publicado.

Em qualquer dos dois caminhos, o que se registra é uma tarefa agendada que sobe
oculta no login. Depois disso não é preciso abrir mais nada: a página fica no ar
o tempo todo e a leitura do save liga sozinha quando o jogo abre. Não é preciso
administrador — o programa só lê arquivos do próprio usuário e escuta numa
porta alta. Para remover, `.\uninstall-sync-service.ps1`.

### Rodando na mão, para depurar

```bash
npm start
```

Ou dois cliques em `run.bat`. Pare o serviço antes, senão os dois disputam a
porta 8777.

Isso sobe duas coisas ao mesmo tempo. A primeira é o poll do processo, que a
cada cinco segundos checa se o `sekiro.exe` está rodando; o watcher do save só
existe enquanto o jogo está aberto, de modo que com o jogo fechado não há
handle aberto no arquivo nem leitura de 11 MB acontecendo à toa. A segunda é o
servidor, que escuta em `0.0.0.0:8777` e por isso também responde ao celular —
ao subir, ele imprime o endereço da máquina na rede local.

Os outros comandos:

```bash
npm run selftest    # confere a leitura do save e o parsing nesta máquina
npm run sync        # lê o save uma vez e escreve progress.json
npm run serve       # só o servidor, sem o watcher
npm run deaths      # a contagem de mortes, lida da memória
npm run discover    # descoberta de offsets por diff (adiante)
npm run auditoria   # relatório do que o link público entrega
```

O instalador já libera a porta 8777 na rede local. Se o celular não abrir a
página — porque a instalação foi feita à mão, ou porque o pedido de
administrador foi recusado na hora —, o caminho é uma ação:

```powershell
.\liberar-porta.ps1
```

Ele pede administrador, cria a regra para os perfis de rede que a máquina está
usando de fato, e limita a origem ao próprio segmento de rede. Essa última
parte é o que torna aceitável a regra valer também no perfil Public: alcança o
celular na mesma casa e não a rede inteira de um lugar público. Rodar duas
vezes não faz nada na segunda.

Vale lembrar que o link do celular usa o endereço da máquina na rede, e o
roteador pode trocar esse endereço num reinício por causa do DHCP — quando isso
acontece, o link salvo para de funcionar. A solução definitiva é reservar o
endereço da máquina no próprio roteador, e aí ele nunca mais muda.

### Diagnóstico

Rodando oculto, a saída vai para `sync/trackeroao.log`, que rotaciona a cada
512 KB. Um boot saudável tem cerca de vinte linhas e termina com o estado do
jogo:

```
  >> Sekiro aberto - sincronização ativa
  [watch] monitorando C:\Users\...\S0000.sl2
```

Para conferir se a tarefa está de pé, `Get-ScheduledTask TrackeroaoSync`.

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
| Headless | save (posse do Spiritfall) | alta |
| Sino Demoníaco e Dragonrot | save (posse do item) | alta |
| Great Serpent, Puppeteer Ninjutsu | save (posse do item) | alta |

Os 62 itens da lista sincronizam automaticamente e todos carregam a etiqueta
`auto`. Se algum estiver errado, o lugar de corrigir é o `offsets.json` e não a
interface: assim a correção vale para sempre, em vez de virar uma marcação
manual que diverge do jogo na próxima partida.

O mecanismo muda de item para item, e a diferença importa porque a confiança de
cada número vem dela.

As **Prayer Beads** na bolsa são o item `4000`, mas as já gastas saem do
inventário — então o total coletado tem de ser reconstruído como
`colares × 4 + contas na bolsa`. Os colares são os itens `4100` a `4109`, dez
IDs distintos, um por colar, e é essa distinção que confirma que são dez. São
quatro contas por colar e quarenta contas no jogo inteiro.

As **Gourd Seeds** são o item `4400`, e aqui há uma limitação que a página
declara em vez de esconder: o save só sabe quantas estão na bolsa. Quando a
Emma usa uma semente para melhorar a cabaça, ela some do inventário. O número,
portanto, é estoque e não coleta — são nove sementes no jogo, a cabaça vai de
uma a dez cargas, e quantas já foram entregues não é legível de forma direta.

Os **materiais de prótese** são os itens `6000` a `6400`, e são o caso de menor
confiança do projeto; a seção seguinte explica por quê.

As **ferramentas protéticas** não ficam em `goods`, e sim na categoria `weapon`
da tabela de itens: `7X000` é a ferramenta base e `7X100`, `7X200` e `7X300`
são os upgrades. Possuir o registro equivale a ter destravado. Como os nomes
internos são japoneses genéricos (`斧` é machado, `鉄扇` é leque de ferro), o
nome em inglês é dedução para algumas delas.

As **artes de combate** também vivem em `weapon`, como registros de `解禁`
(destravado): `210000` é Whirlwind Slash, `410000` é Ichimonji, e assim por
diante. As básicas são inequívocas; as de fim de jogo exigiram interpretar o
japonês. `671000 = 剣聖居合`, literalmente "iai do Sword Saint", é Dragon Flash,
que o jogo entrega ao derrotar Isshin — a descrição em inglês fala em corte em
alta velocidade a partir da bainha, o que fecha. `673000 = 見えない居合連撃`,
"iai invisível em combo", é One Mind.

Os **chefes** principais dão uma Memory, que é um item: `5200` a `5222`
enquanto não usada e `5300` a `5322` depois de gasta num Ídolo. Ter qualquer um
dos dois prova a morte do chefe.

Os **mini-chefes** não dão Memory, então vêm de event flag — mais precisamente
da flag da Prayer Bead que cada um larga ao morrer.

Os **Headless** não têm flag legível: as recompensas deles usam flags de bloco
de área cuja base ninguém mapeou. Mas cada um larga um Spiritfall exclusivo e
permanente, e possuir o item prova a morte. Em NG+ o item vem junto, de modo
que conta como derrotado mesmo antes de matá-lo de novo no ciclo novo.

O **Sino Demoníaco** e o **Dragonrot** seguem o mesmo raciocínio, e é por isso
que aparecem no bloco de mortes como estado e não como número. Tocar o sino põe
o item `Bell Demon` (`3730`) no inventário e o deixa lá enquanto o efeito valer;
devolvê-lo num Ídolo tira o item. A podridão, por sua vez, não tem contador
legível, mas cada NPC adoecido larga uma Rot Essence exclusiva — dezessete
delas, `9500` a `9526`, cada uma nomeando uma pessoa. A página mostra quantas
estão no inventário e de quem são, e não afirma mais que isso: se a essência
some ao curar o NPC, nenhuma fonte consultada diz, e as duas leituras ("quem
está doente agora" e "quem já adoeceu") não são a mesma frase.

Alguns casos não deixam nenhum dos rastros acima. Genichiro na primeira luta é
a flag `9300` e o Mist Noble é a `9380`, ambas localizadas no EMEVD pelos
comentários do próprio dump (`End Tutorial Genichiro`, `Defeating Mist Noble`).
O Great Serpent não é morto de maneira convencional, então a prova é possuir a
Serpent Viscera, goods `9192` ou `9193`. Puppeteer Ninjutsu é ninjutsu e não
prótese, e mora em goods `2110`.

### Sem o save disponível

Como não existe entrada manual, o estado de erro é a única saída da página, e
ele foi feito para não mentir. O total vira `—` com "aguardando o save", cada
seção vira `—/N`, e os contadores viram `—`. Nada aparece como zero, porque
zero seria uma medição e o que existe ali é ausência de dado. A linha no topo
diz o motivo: servidor fora do ar, save não encontrado, ou o erro que o próprio
`progress.json` reportou.

## Confiança dos dados

O formato do `.sl2` não é documentado pela FromSoftware. Tudo que está aqui é
engenharia reversa, e cada afirmação carrega o grau de certeza com que foi
obtida — inclusive no `offsets.json`, onde cada entrada tem um campo
`confidence`. Vale a pena dizer como cada grau foi alcançado.

O **container** foi confirmado byte a byte nesta máquina. É um BND4 comum, sem
criptografia, ao contrário do Dark Souls 3. São doze blocos, de `USER_DATA000`
a `USER_DATA011`: dez slots de personagem de 1 MiB, um bloco global e um vazio.
Cada bloco começa com o MD5 dos bytes seguintes, e o digest foi conferido nos
doze blocos de um save real. Esse mesmo MD5 acabou virando detector de leitura
partida: se o jogo estiver gravando no instante da leitura, o digest não bate e
o leitor tenta de novo em vez de reportar lixo.

Os **IDs de item** têm confiança alta porque vêm do `EquipParamGoods` do
próprio jogo, onde os nomes são inequívocos — `HP/体幹UPの欠片` é fragmento de
vitalidade e postura, ou seja, Prayer Bead; `ボスソウル_お蝶` é a Memory da Lady
Butterfly.

Os **nomes dos nove materiais** são o ponto de confiança média, e vale conferir.
O param chama todos de material genérico numerado por tier (`鋼鉄1/2/3`,
`化学2/3`, `呪術2/3`), sem o nome que aparece em inglês no jogo. O mapa segue a
ordem dos tiers e bate com um save real de meio de jogo — os materiais iniciais
presentes, os de fim de jogo todos zerados —, mas se algum contador parecer
trocado, o caminho é confirmar com o `discover` e corrigir o `offsets.json`.

As **event flags** dos mini-chefes mereceram cuidado extra porque erram em
silêncio. A área de flags do bloco comum fica no offset `0x34` do payload, com
dez zonas de 128 bytes, e o endereço de uma flag é `base + zona*128 + word*4`,
com `zona = (id/1000)%10`, `word = (id%1000)/32` e `bit = 31 - ((id%1000)%32)`.
Essa decomposição é da FromSoftware e foi conferida contra a decompilação do
`GetEventFlag` no SoulSplitter. Os ids vieram de duas fontes independentes: os
chefes principais do enum `Boss` do SoulSplitter, `9301` a `9317`, e os
mini-chefes do dump EMEVD, onde cada inimigo aparece seguido da flag do item que
larga ao morrer — `Chained Ogre → flag 6761 (Prayer Bead)`. Como a conta só
aparece quando o mini-chefe morre, essa flag equivale a "derrotado".

A base do bloco foi confirmada de duas maneiras que não dependem uma da outra.
As flags `9301` a `9317` batem exatamente com as Memories lidas da tabela de
itens, que é um mecanismo completamente diferente; e a contagem de mini-chefes
com flag ligada bate com as Prayer Beads do inventário — num save com duas
contas coletadas, exatamente dois mini-chefes aparecem mortos, enquanto as
outras bases candidatas davam zero.

O leitor revalida isso a cada leitura. Se as flags de chefe discordarem das
Memories, por exemplo porque um patch moveu o bloco, ele procura uma base que
concorde; se não achar uma resposta única, não reporta mini-chefe nenhum em vez
de reportar bit lido do lugar errado.

> O aviso que vale para tudo acima: isto é engenharia reversa, e um patch do
> jogo pode mudar qualquer coisa. O leitor evita offset fixo onde dá — a tabela
> de itens é localizada pela estrutura e não por endereço —, mas se algo parecer
> errado depois de uma atualização, o primeiro passo é `npm run selftest`.

## O contador de mortes

O Sekiro não mostra quantas vezes se morreu, e o save não guarda essa conta.
Isso não é suposição: a busca exaustiva rodou, eliminou todos os candidatos, e o
motivo ficou registrado em `deaths.json`.

O jogo guarda a conta na memória. O número sai do `GameDataMan`, a struct que o
save carrega, no campo `+0x90`. Ela é encontrada por padrão de bytes e não por
endereço fixo, e a razão é concreta: as duas ferramentas públicas de contagem de
mortes para Sekiro gravam o endereço direto, e nenhuma das duas resolve na
versão atual — o ponteiro volta nulo. Procurar pelo padrão sobrevive a
atualização do jogo.

A struct foi confirmada, não deduzida. O tempo interno de jogo é campo dela,
`+0x9c`, e dá para conferir contra as horas que a Steam registra: 54,7 h de
tempo interno contra 82,3 h de relógio de parede, com menu e carregamento
explicando a diferença. Observando por uma hora, o tempo interno andou
exatamente uma hora e o campo das mortes não se moveu — que é justamente o que
separa um contador de evento de um contador de quadro ou de relógio.

Existe também um contador de sessão, achado por diferença de snapshots da
memória, mantido como reserva para o caso de o padrão deixar de casar numa
versão futura. Ele zera quando o jogo abre, então mede só a partida atual. O
escopo viaja junto com o número (`"escopo": "jornada"` ou `"sessao"`), para a
página nunca mostrar um pelo outro.

```bash
npm run deaths            # mostra jornada, sessão, e compara com a última vez
npm run deaths mark       # tira uma foto da memória
npm run deaths confirm 3  # depois de morrer 3 vezes, cruza e acha o offset
```

O par `mark`/`confirm` só é necessário para calibrar a reserva de sessão; a
contagem da jornada funciona sem calibração nenhuma.

Nada disso escreve. O handle é aberto com `PROCESS_VM_READ` e
`PROCESS_QUERY_INFORMATION`, sem `PROCESS_VM_WRITE` e sem
`PROCESS_VM_OPERATION`, e o `WriteProcessMemory` sequer é importado. A suíte
verifica essa afirmação lendo o próprio `mem.ps1`, porque uma garantia dessas
escrita só no README envelhece mal.

## A Steam é opcional

O projeto nasceu numa máquina com Steam e por um tempo tratou a Steam como
parte do ambiente. Isso era um defeito com data marcada: instalado em outro
computador, o tracker anunciava o progresso de outra pessoa com o nome de quem
escreveu a página, e perdia as horas de jogo se o `localconfig.vdf` não
existisse. Hoje cada coisa que vinha de lá tem caminho próprio, e a Steam,
quando existe, serve de gabarito em vez de ser a única fonte.

O **nome no cabeçalho** é o `PersonaName` do `config/loginusers.vdf`, que é o
apelido público da conta. Quando há mais de uma conta no arquivo, quem decide é
o SteamID64 do save que está sendo lido, porque pegar a primeira daria o
apelido de outra pessoa numa máquina de família. O `AccountName`, que é o nome
de login, não é lido em momento nenhum. Sem Steam identificada não há apelido, e
aí a linha some inteira e o cabeçalho fica só com o título — um "player"
genérico ocuparia o mesmo espaço dizendo nada.

O **tempo de jogo** tem duas fontes que medem coisas diferentes e por isso não
se substituem em silêncio. A Steam grava relógio de parede, com menu, pausa e
carregamento incluídos, e só até o minuto. O tempo interno do jogo vive no
próprio save, em segundos, no bloco de stats do slot — esse offset não estava
publicado em lugar nenhum e foi localizado aqui, varrendo o slot atrás do valor
que a leitura de memória já fornecia. Quando as duas existem, a da Steam é a que
a página mostra, porque é a que o usuário reconhece do próprio perfil, e a
interna vira conferência: relógio de parede é sempre maior que tempo interno, e
se essa relação se inverter, uma das duas leituras está errada. A suíte cobra
essa desigualdade a cada execução, que é o modo de usar a Steam como gabarito
enquanto ela está por perto.

As **conquistas** são lidas do cache local do Steam, em KeyValues binário, sem
chave de API e sem depender de o perfil ser público. Numa máquina sem Steam elas
simplesmente não existem, e o bloco se comporta como qualquer outro dado
ausente: fica `—`, não fica zero.

## Descobrindo o que falta

Para mapear uma flag — um mini-chefe, um Ídolo — ou confirmar um material:

```bash
node sync/discover.js before
# no jogo: faça UMA coisa só (mate um mini-chefe, pegue um item)
# passe por um Ídolo para forçar o autosave
node sync/discover.js after
```

O `after` já compara com o `before` e mostra duas listas. A de itens diz coisas
como "goods 6000: 4 → 5", e é assim que se confirma um material: pega-se um
Scrap Iron e observa-se qual ID subiu. A de bytes crus mostra primeiro as
mudanças de um único bit, que é o formato típico de uma flag de chefe — se você
fez uma coisa só e aparece um bit só, achou.

O resultado se anota no `offsets.json`, em `eventFlags.flags`:

```json
"chainedOgre": { "offset": 123456, "bit": 3, "confidence": "confirmed" }
```

A região comprimida no fim do slot, de `0xF0000` a `0x100000`, fica de fora do
diff de bytes: ela se reescreve inteira a cada save e só geraria ruído.

## Onde ele procura o save

No Windows, em `%APPDATA%\Sekiro\<steamid>\S0000.sl2`. No Linux e no Steam Deck,
sob o prefixo do Proton, em
`~/.local/share/Steam/steamapps/compatdata/814380/pfx/drive_c/users/steamuser/AppData/Roaming/Sekiro/<steamid>/S0000.sl2`
— e também em `~/.steam/steam`, no caminho do Flatpak e num prefixo Wine comum.
Havendo mais de uma conta Steam, ele fica com a pasta modificada mais
recentemente.

O jogo tem dez slots, e descobrir o certo é feito por observação: o
sincronizador vê qual bloco muda quando o jogo salva e guarda a resposta em
`sync/.state.json`. Antes do primeiro autosave ele chuta o slot mais avançado, e
diz no terminal que foi chute. Para fixar, basta pôr `"slot": 1` no
`offsets.json`.

## Arquivos

O repositório é o projeto: clonar e rodar basta, e `docs/` é a saída dele, a
mesma pasta que o GitHub Pages serve. Nada é resolvido fora desta pasta, e há
teste na suíte cobrando isso.

```
trackeroao/
  trackeroao.html             a página (abra pelo servidor, não por file://)
  run.bat                     execução manual
  install-sync-service.ps1    registra a tarefa agendada (não precisa de admin)
  uninstall-sync-service.ps1  remove a tarefa e encerra o serviço
  reativar.ps1                volta do arquivamento, se o jogo for reinstalado
  liberar-porta.ps1           abre a porta 8777 na rede local (pede administrador)
  instalar.ps1                instalação do zero em máquina nova
  construir-exe.ps1           compila o instalador num .exe
  package.json                scripts npm (sem dependências)

  docs/                       o que vai para o ar (GitHub Pages)
    index.html                cópia da página, gerada
    progress.json             progresso saneado, sem nada de máquina ou conta
    icones/                   arte dos chefes e dos Headless, baixada uma vez

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
    conquistas.js             ícones, descrição e dificuldade das conquistas
    tempo.js                  tempo de jogo: Steam, e o save quando não há Steam
    jogador.js                de quem é o progresso (apelido do Steam)
    efeitos.js                efeitos temporários acionados pela sessão
    bosskills.js              conta cada vez que um chefe cai
    icones.js                 baixa as artes uma vez

    publish.js                monta docs/ e barra o que identificaria a máquina
    serve.js                  servidor estático + endereço na LAN
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

Ficam fora do git, porque nascem em tempo de execução e carregam dados da
máquina: o `progress.json` cru, com o caminho do save; os arquivos de estado dos
contadores, que carregam carimbo de hora; o log; os despejos de memória; e as
cópias de hibernação, que contêm o save e portanto o Steam ID.

## Se der problema

Quando a mensagem é **"não achou o save"**, o caminho é `npm run selftest`. Se o
jogo nunca rodou nesta máquina, a pasta simplesmente não existe.

Quando a página diz **"sem sincronização"**, ela não está falando com o serviço.
As causas, da mais comum para a menos: o computador está desligado ou dormindo;
o serviço caiu, e aí `sync/trackeroao.log` e `Get-ScheduledTask TrackeroaoSync`
dizem o que houve; ou o arquivo HTML foi aberto direto por `file://`, caso em
que o `fetch('progress.json')` não funciona e é preciso usar o endereço do
servidor.

Quando os **números parecem errados**, o suspeito quase sempre é o slot. Vale
ver qual o terminal escolheu e fixá-lo com `"slot": N` no `offsets.json`.

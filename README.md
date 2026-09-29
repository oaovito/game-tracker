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
.\windows\install-sync-service.ps1
```

Para quem não tem, a [última release](https://github.com/oaovito/trackeroao/releases/latest)
traz um único arquivo, `trackeroao-instalador.exe`, que resolve tudo sozinho:
instala o Node via winget se não houver, baixa o código da release mais recente
sem exigir git, registra o serviço e roda a suíte no fim para provar que
funcionou naquela máquina. Ele atualiza uma instalação existente em vez de
zerá-la, preservando os arquivos de estado. O executável é gerado por
`instalador/construir-exe.ps1` a partir de `instalador/instalar.ps1` e
`instalador/desinstalar.ps1`, e não fica versionado: nasce a cada release.

Toda release sai sozinha. Basta o arquivo de notas `releases/vX.Y.Z.md`
chegar à `main`: `.github/workflows/release.yml` valida a sintaxe de todos os
scripts do PowerShell, compila o `.exe` num runner Windows a partir dos
scripts daquela mesma versão e publica a release `vX.Y.Z` com ele anexado. A
primeira linha do arquivo é o título, e o resto é o corpo.

Em qualquer dos dois caminhos, o que se registra é uma tarefa agendada que sobe
oculta no login. Depois disso não é preciso abrir mais nada: a página fica no ar
o tempo todo e a leitura do save liga sozinha quando o jogo abre. Não é preciso
administrador — o programa só lê arquivos do próprio usuário e escuta numa
porta alta.

### Atualização

A instalação se mantém atual sem intervenção. O serviço confere se há release
nova vinte segundos depois de subir e, a partir daí, a cada seis horas; uma
falha de rede adia a próxima tentativa para dez minutos depois. A conferência
acontece sempre entre duas rodadas de verificação do jogo, nunca no meio de
uma, e nunca com o jogo aberto: enquanto se joga, ela simplesmente espera. Há
versão nova, o código da tag é baixado, copiado por cima da instalação e o
serviço se reinicia sozinho, sem janela, sem aviso e sem tocar nos arquivos de
estado. O que aconteceu fica apenas no log. Num clone do repositório, a mesma
rotina só avança a `main` por fast-forward, e só com a árvore limpa. A
variável de ambiente `TRACKEROAO_SEM_ATUALIZAR` desliga tudo isso.

Instalações anteriores à v1.5.0 não têm essa rotina e precisam de uma única
reinstalação com o instalador da v1.5.0 ou posterior; dali em diante, elas se
atualizam sozinhas.

### Desinstalando

O instalador deixa uma cópia de si mesmo na pasta da instalação, com o nome
`trackeroao-desinstalador.exe`, e registra o trackeroao em "Aplicativos
instalados" do Windows. Remover por lá, ou rodar esse executável, desfaz na
ordem inversa tudo o que o instalador fez: a tarefa agendada, os processos e o
ícone da bandeja, o atalho, a regra de firewall e a pasta. Antes de apagar, ele
pergunta se deve guardar uma cópia do progresso nos Documentos. O Node.js e o
save do jogo ficam como estão. Num clone, `.\windows\uninstall-sync-service.ps1`
remove só a tarefa agendada.

### Rodando na mão, para depurar

```bash
npm start
```

Ou dois cliques em `windows\run.bat`. Pare o serviço antes, senão os dois disputam a
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
.\windows\liberar-porta.ps1
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

## Quanto a aplicação consome

A aplicação foi desenhada para ficar ligada o tempo inteiro sem que isso se
perceba, e o consumo acompanha essa intenção: com o jogo fechado ela quase não
existe, e com o jogo aberto trabalha apenas quando o save é gravado. Os números
abaixo vêm de duas origens, que convém distinguir. A memória do servidor foi
medida diretamente; o tempo do `tasklist` foi medido nesta máquina durante o
desenvolvimento; os demais valores são estimativas feitas a partir do código e
do comportamento conhecido do PowerShell no Windows. Onde o número é estimado,
o texto diz.

### Com o jogo fechado

Resta um único processo `node`, que ocupa algo entre 50 e 60 MB de memória
(medido) e mantém o uso de CPU praticamente em zero. Ele faz quatro coisas, e
nenhuma delas é contínua:

- **Procura o jogo a cada cinco segundos.** Uma chamada ao `tasklist`, sem
  filtro, devolve cerca de 9 KB e leva aproximadamente 190 ms. Em média, isso
  representa bem menos de 1% de um núcleo. A chamada é uma só,
  independentemente de quantos jogos estejam sendo vigiados, e a comparação
  com o catálogo é feita dentro do próprio serviço.
- **Serve a página** na porta 8777, e também na porta 80 quando ela está livre.
  Sem ninguém com a página aberta, o servidor fica parado à espera de conexão.
  Com a página aberta na rede local, cada aba pede o `progress.json` a cada
  cinco segundos, o que custa uma leitura de arquivo pequena por pedido.
- **Responde pelo nome na rede local** (mDNS), através de um socket UDP que
  apenas escuta e atende perguntas. O custo é desprezível.
- **Confere a rede a cada 15 segundos** e **a instalação do jogo a cada dez
  minutos**. São verificações baratas, que existem para anunciar o endereço
  certo quando o Wi-Fi associa depois do boot e para perceber quando o jogo foi
  desinstalado.

Com o jogo fechado, nenhum handle fica aberto sobre o arquivo do save. O
observador do arquivo só existe enquanto o jogo está rodando.

### Com o jogo aberto

Ao processo `node` somam-se três coisas.

- **O ícone da bandeja**, que é um `powershell` residente com Windows Forms. A
  estimativa é de 60 a 90 MB de memória, com CPU quase nula. O único trabalho
  periódico dele é conferir, a cada dois segundos, se o serviço que o abriu
  continua vivo, para não deixar na bandeja um ícone que não leva a lugar
  nenhum.
- **A leitura do save**, a cada gravação feita pelo jogo. Gravações próximas
  são reunidas numa só, com uma espera de 0,9 s, porque o Sekiro costuma gravar
  várias vezes em sequência. Cada leitura percorre os cerca de 11 MB do arquivo,
  sempre em modo somente leitura.
- **A leitura da memória do jogo**, que acompanha a leitura do save e é a parte
  mais custosa do conjunto. O Node não consegue chamar `ReadProcessMemory` por
  conta própria, e o projeto não usa dependência nativa. Por isso, cada
  consulta à memória abre um `powershell` curto, que compila a ponte com o
  Windows, lê o que foi pedido e termina. Uma leitura completa faz algumas
  dessas consultas em sequência (localizar o processo, resolver os ponteiros,
  ler os valores). A estimativa é de cerca de um segundo de CPU por consulta,
  e a memória volta ao sistema assim que cada processo termina. Essas chamadas
  são síncronas: enquanto duram, o servidor espera, e uma página aberta naquele
  instante recebe a resposta com esse atraso.

Por fim, quando há algo novo, o progresso é publicado no GitHub Pages por meio
do `git`, **no máximo uma vez a cada três minutos**. O intervalo existe para
não encher o histórico de commits enquanto se joga.

### O que não acontece

A aplicação não escreve nada no jogo, não mantém o save aberto fora das
leituras e não baixa nada em tempo de execução. Também não abre janela nem
navegador por conta própria: quando o jogo começa, o único sinal visível é o
ícone na bandeja.

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

O **nome no cabeçalho** pode ser escolhido na própria página, no computador
que roda o serviço: um clique na linha abaixo do título a transforma em campo
de texto, e o nome escolhido fica em `jogador.json`. É o caminho que funciona
sem Steam, e, quando ela existe, o nome escolhido continua mandando, por ser
uma decisão de quem usa. Sem escolha, vale o `PersonaName` do
`config/loginusers.vdf`, o apelido público da conta. Quando há mais de uma conta
no arquivo, quem decide é o SteamID64 do save que está sendo lido, porque pegar
a primeira daria o apelido de outra pessoa numa máquina de família. O
`AccountName`, que é o nome de login, não é lido em momento nenhum. Sem nome
escolhido e sem Steam, o link público mostra só o título, e a página local
mostra um convite discreto para dar o nome.

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

As **conquistas** saem do save. O jogo concede cada uma por uma instrução
`AwardAchievement(N)` nos próprios scripts de evento, e junto com a concessão
grava no save algo que a prova. Para os chefes e para os quatro finais há uma
flag da faixa 68xx, a mesma que o `common.emevd` consulta para conceder o Man
Without Equal, e os finais ocupam 6830 a 6833. A primeira ressurreição liga a
flag 8250, e a Ashina Traveler corresponde às visitas que o evento 130 registra.
As demais são de inventário: as dez próteses e suas trinta melhorias, as de
lazulita, os três ninjutsu, as 48 habilidades e o mistério de cada estilo, a
cabaça com dez cargas e os dez colares. As regras estão em
`sync/conquistasave.js`, com a fonte de cada uma. Duas conquistas não deixam
prova confiável no save: o Memorial Mob, que depende de diálogo, e a Great
Serpent, cuja víscera é consumível. Sem Steam, essas duas aparecem marcadas
como impossíveis de provar pelo save, em vez de figurarem como não obtidas.

Quando a Steam existe, o cache local dela (KeyValues binário, lido sem chave de
API e sem exigir perfil público) confere o que o save diz. Uma conquista vale se
qualquer dos dois a tiver, porque a Steam registra o que a conta obteve em
qualquer save e em qualquer ciclo, enquanto o save conhece apenas o personagem
atual. Onde os dois discordam, a página indica o desencontro na própria linha da
conquista.

A **detecção de que o jogo foi desinstalado**, que leva à hibernação, também
tem caminho sem Steam. A varredura de jogos registra a pasta em que o Sekiro
foi encontrado; se essa pasta deixa de existir e a varredura seguinte não o
encontra em outro lugar, o jogo é dado como removido. Sem nunca ter visto a
pasta, a resposta permanece "não sei", e "não sei" jamais aciona a hibernação.

## A tela de jogos

Antes da página de progresso há uma tela com os jogos desta máquina. Cada jogo
aparece com dois pinos: instalado neste computador e vigiado, isto é, capaz de
acender a aplicação na bandeja quando abre. Os jogos que o tracker sabe ler por
inteiro, hoje só o Sekiro, levam à página de progresso; os demais servem para a
detecção de abertura. O botão "All games" leva à lista completa, dividida entre
o que está no computador e o que está na biblioteca da Steam. No computador que
roda o serviço, tocar no pino de vigia liga e desliga a vigia daquele jogo, e
"Search again" pede uma nova varredura.

Essa tela tem identidade visual própria, deliberadamente distinta da página do
Sekiro: por ser a porta de entrada para qualquer jogo, ela não herda o papel, o
vermelho e o dourado daquela página. O tema é o dos jogos em geral, com fundo
noturno de painel, uma grade fina ao fundo, destaques em violeta e ciano e
tipografia técnica (Chakra Petch nos títulos, Inter no texto). Abre sempre no
modo escuro, e o botão de tema no canto alterna para o claro; a escolha é
guardada à parte, de modo que o tema escolhido para a página do Sekiro não
interfere no desta tela, e vice-versa.

A lista vem de `sync/biblioteca.js`, que consulta três fontes de nomes: a
biblioteca da Steam da pessoa, quando existe (os `appmanifest` de cada
biblioteca e o que a conta já jogou, segundo o `localconfig.vdf`); o catálogo
geral da Steam, obtido da lista pública de aplicativos e guardado por uma
semana; e os jogos mais jogados do momento, que se atualizam diariamente e
somam-se a uma lista fixa em `sync/populares.json`. Essa lista fixa cobre os
títulos que nem estão na Steam, como Valorant, League of Legends, Fortnite e
Minecraft, e garante reconhecimento mesmo sem rede.

Com esses nomes, a varredura percorre as pastas onde jogos costumam ser
instalados em cada disco, os programas registrados no Windows e os manifestos
da Epic. Pastas dedicadas a jogos (Games, XboxGames, Epic Games, GOG,
`steamapps\common`) aceitam qualquer nome do catálogo; pastas genéricas como
Program Files aceitam apenas jogos da biblioteca da pessoa e populares, para
que um programa vendido também na Steam não seja tomado por jogo. De cada jogo
instalado, o executável é o maior `.exe` da pasta que não seja instalador,
atualizador, anti-cheat ou relatório de erro. A varredura roda um pouco depois
de o serviço subir e, daí em diante, uma vez por dia, sempre entre duas rodadas
de verificação e nunca com um jogo aberto. O resultado fica em
`biblioteca.json`, fora do git. Para rodá-la à mão, `npm run jogos`.

## No celular, como aplicativo

O link de progresso pode ser instalado como aplicativo no iPhone e no Android.
No iPhone, pelo Safari: Compartilhar e depois "Adicionar à Tela de Início". No
Android, pelo Chrome: o menu oferece "Instalar app". O trackeroao passa a abrir
em tela cheia, com o ícone da chama do Ídolo. O service worker (`docs/sw.js`)
busca sempre a leitura mais nova quando há rede e, sem rede, abre a última que
recebeu, em vez de uma tela de erro. A instalação exige https, o que o link
público oferece; pelo endereço da rede local, que é http, a página continua
funcionando normalmente, apenas sem virar aplicativo.

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
  package.json                scripts npm (sem dependências)

  instalador/                 o que vira o .exe da release
    instalar.ps1              instalação do zero, ou por cima de uma existente
    desinstalar.ps1           o oposto exato do instalar.ps1
    construir-exe.ps1         compila os dois num .exe só

  windows/                    atalhos para quem roda a partir de um clone
    run.bat                   execução manual
    install-sync-service.ps1  registra a tarefa agendada (não precisa de admin)
    uninstall-sync-service.ps1  remove a tarefa e encerra o serviço
    reativar.ps1              volta do arquivamento, se o jogo for reinstalado
    liberar-porta.ps1         abre a porta 8777 na rede local (pede administrador)

  releases/                   uma nota por versão; cada uma vira uma release

  docs/                       o que vai para o ar (GitHub Pages)
    index.html                cópia da página, gerada
    progress.json             progresso saneado, sem nada de máquina ou conta
    icones/                   arte dos chefes e dos Headless, baixada uma vez
    manifest.webmanifest      o que faz o link virar aplicativo no celular
    sw.js                     abre a última leitura quando falta rede
    app/                      ícones do aplicativo

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

    conquistasave.js          as 34 conquistas provadas pelo save
    conquistas-lista.json     nomes e descrições das 34, sem depender da Steam
    achievements.js           conquistas da Steam, que conferem as do save
    conquistas.js             ícones, descrição e dificuldade das conquistas
    tempo.js                  tempo de jogo: Steam, e o save quando não há Steam
    jogador.js                de quem é o progresso (nome escolhido ou da Steam)
    biblioteca.js             varre os jogos da máquina e da conta
    populares.json            populares reconhecidos sem rede e sem Steam
    jogos.js / jogos.json     jogos vigiados e o que cada um sabe ler
    efeitos.js                efeitos temporários acionados pela sessão
    bosskills.js              conta cada vez que um chefe cai
    icones.js                 baixa as artes uma vez

    publish.js                monta docs/ e barra o que identificaria a máquina
    serve.js                  servidor estático + endereço na LAN
    mdns.js                   nome .local na rede, sem dependência

    oculto.vbs                sobe o serviço sem janela, via wscript do Windows

    instalacao.js             detecta se o jogo foi desinstalado
    hibernar.js               arquiva tudo e remove a tarefa agendada
    atualizar.js              atualização silenciosa para a release mais nova
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

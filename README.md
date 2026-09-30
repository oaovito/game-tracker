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

Também nada é publicado. O progresso não sai do computador que joga: ele é
visto na janela do Trackeroao, nesse mesmo computador, e nos celulares da
casa, pela rede local. Não existe site nem link público, e o serviço não envia
o progresso a lugar nenhum. O que o serviço busca na internet é o que ele
precisa para funcionar — a versão mais nova do próprio programa, a arte dos
jogos e os catálogos de nomes descritos adiante —, e nenhum desses pedidos
leva dado do save.

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

Dentro do instalador vai também a janela do Trackeroao, descrita adiante, que
é um programa compilado e por isso não viaja com o código. Ela é gerada antes,
por `instalador/construir-janela.ps1`, e seus arquivos entram no `.exe` como
recursos; na instalação, são postos em `<instalação>\app`. A mesma pasta
recebe o aplicativo de Android, que o computador entrega ao celular. A release
traz dois arquivos: o instalador do Windows, `trackeroao-instalador.exe`, e o
aplicativo de Android, `trackeroao.apk`.

Toda release sai sozinha. Basta o arquivo de notas `releases/vX.Y.Z.md`
chegar à `main`: `.github/workflows/release.yml` valida a sintaxe de todos os
scripts do PowerShell, gera a janela e compila o `.exe` num runner Windows a
partir dos arquivos daquela mesma versão, confere num Windows de verdade que o
instalador abre, instala e deixa a janela de pé, e publica a release `vX.Y.Z`
com os dois arquivos anexados. O título de toda release é apenas o nome do
aplicativo e a versão, como "Trackeroao 1.6.9"; o texto do arquivo de notas,
da terceira linha em diante, é o corpo. A cada execução, o fluxo também
acerta para esse formato o título de qualquer release antiga que esteja
diferente.

### A janela do instalador

Com dois cliques no `.exe`, a pessoa vê uma única caixa pequena, escura e sem
bordas do sistema, com o nome do Trackeroao, o passo em andamento ("Baixando o
Trackeroao", "Criando o atalho na área de trabalho"), uma barra de progresso
com a porcentagem e uma linha de detalhe sobre o passo. Nenhum console aparece.
O PowerShell roda oculto e informa o andamento por linhas iniciadas em `@@` na
saída padrão, que a janela converte em texto e progresso; o restante da saída
vai para o registro em `%TEMP%\trackeroao-instalar.log`, que só permanece
quando a instalação falha. Reinstalar ou atualizar substitui no lugar o que já
existe (arquivos, tarefa agendada, atalho, regra de firewall e registro em
"Aplicativos instalados"), sem criar cópias, e as pastas temporárias de uma
execução interrompida são removidas na execução seguinte. O pedido de
administrador é feito uma única vez pelo próprio executável, antes de o script
começar. Se for recusado, a instalação prossegue e a liberação da porta 8777
passa a constar como pendência no fim. Ao terminar, a caixa oferece "Abrir o
Trackeroao", que abre a janela do programa, e "Fechar"; em caso de erro,
mostra o motivo e oferece o registro.

O desinstalador usa a mesma caixa, com o mesmo desenho, e também não abre
nenhuma outra janela. Como ele reside na pasta que precisa apagar, copia a si
mesmo para a pasta temporária e entrega a execução à cópia.

As duas caixas falam os mesmos doze idiomas da página. O script não escreve
frases: manda à caixa um identificador de texto, e é a classe `Textos`, dentro
de `instalador/construir-exe.ps1`, que o converte na frase do idioma em uso.
Esse idioma é o escolhido na página, quando uma instalação anterior guardou a
escolha, e, na falta dela, o do Windows. O nome Trackeroao nunca é traduzido.

Para que o Windows Defender reconheça o arquivo como um instalador comum, o
executável leva um manifesto (execução como o usuário, versões do Windows
suportadas e escala de tela), propriedades preenchidas (produto, descrição,
autor e versão da release) e o ícone do aplicativo, e o script é gravado em
disco e chamado por `-File`, nunca por comando codificado. O aviso azul do
SmartScreen ("O Windows protegeu o computador") é de outra natureza: aplica-se
a todo executável baixado sem assinatura digital de código e só desaparece com
um certificado de assinatura, o que não se resolve no código.

Em qualquer dos dois caminhos, o que se registra é uma tarefa agendada que sobe
oculta no login. Depois disso não é preciso abrir mais nada: o serviço fica de
pé o tempo todo, servindo a página na rede de casa, e a leitura do save liga
sozinha quando o jogo abre. Não é preciso administrador — o programa só lê
arquivos do próprio usuário e escuta numa porta alta.

### A janela do Trackeroao

No Windows, o progresso é visto numa janela própria, e não numa aba do
navegador: sem barra de endereço, sem abas e sem link à vista. O programa é
`<instalação>\app\Trackeroao.exe`, compilado a partir de
`instalador/janela/Trackeroao.cs`. Por dentro, a janela é o WebView2, o
componente de página que o Windows 10 e o 11 já trazem, com o mesmo motor do
Edge; ela mostra a página que o serviço serve no próprio computador, num
endereço interno que nunca aparece. Links para fora, como a loja de um jogo,
abrem no navegador da pessoa, e dentro da janela fica somente o Trackeroao.

A moldura da janela também é do Trackeroao, e não a do Windows: uma barra fina
com o ícone, o nome e os botões de minimizar, maximizar e fechar, no estilo dos
aplicativos de jogo. A barra toma a cor do fundo da página, que é a cor das
pontas da tela, e o contorno da janela a acompanha. Quando a página muda, por
exemplo da tela inicial para a do Sekiro ou do tema escuro para o claro, a
página informa a nova cor à janela, e a barra passa de uma cor para a outra
em cerca de um terço de segundo. Sobre um fundo claro, o texto e os botões da
barra escurecem para continuar legíveis. A barra não tem linha de divisão embaixo: na tela
inicial e na biblioteca, a arte desfocada do fundo começa na cor exata da barra
e clareia num degradê ao longo dos primeiros 6 rem; na página de cada jogo, o
brilho do alto da página nasce da mesma cor, no mesmo espaço. Com uma lista
aberta sobre a página, que escurece o que está atrás, a barra escurece na mesma
medida. Assim a barra e a página se leem sempre como uma superfície só.

A janela tem três estados, e só três: o tamanho padrão, de 1320 por 860 pixels
(ou menos, numa tela menor que isso), a tela cheia, e escondida na bandeja. As
bordas não redimensionam, e o encaixe do Windows nas laterais da tela não muda
o tamanho dela. Minimizar e o X escondem a janela na bandeja, sem encerrar
nada; ela volta pelo ícone, no mesmo lugar e no mesmo estado. Encerrar de
verdade é só pelo "Fechar" do menu da bandeja. Escondida, a página para de
desenhar e o componente devolve memória ao sistema, como acontecia ao
minimizar.

A janela abre onde estava da última vez: na mesma tela, na mesma posição e em
tela cheia se estava assim, inclusive depois de reiniciar o computador ou de
uma atualização. O lugar fica em `%LOCALAPPDATA%\trackeroao\janela.txt`. Se
aquela tela não existe mais, por exemplo um monitor desligado, ela abre no
meio da tela principal.

Ela abre por dois caminhos, e só por eles: o atalho "Trackeroao" da área de
trabalho, ou o ícone da bandeja. Nenhuma outra coisa a abre, nem o jogo, nem a
atualização, nem o logon. Existe uma única janela de cada vez: abrir de novo
apenas traz à frente a que já estava aberta.

Abrir a janela também põe o serviço de pé. Se ele foi encerrado, a janela
grava o pedido de abertura (`sync/abrir.pedido`) e o inicia pela tarefa
agendada, que roda com o usuário e a pasta certos, espera que responda e só
então carrega a página; enquanto isso, mostra uma tela de espera, sem texto
além do nome.

Nada do Trackeroao inicia sozinho com o Windows, a menos que a caixa "Iniciar
com o Windows" do menu da bandeja esteja marcada, e ela vem desmarcada. A
tarefa agendada continua registrada com o gatilho de logon, porque é por ela
que a janela sobe o serviço, mas o serviço decide ao subir se pode ficar
(`podeSubir`, em `sync/main.js`): fica quando há um pedido de abertura com
menos de dois minutos, quando é o reinício de uma atualização, ou quando a
caixa está marcada (`sync/iniciar-com-windows.flag`) e a aplicação não foi
fechada pela bandeja desde que o computador ligou. Em qualquer outro caso,
inclusive no logon sem a caixa marcada, ele sai na hora, sem ícone e sem
janela. Com a caixa marcada, o logon põe o serviço de pé e acende o ícone da
bandeja, sem abrir a janela.

Num Windows 10 antigo, sem o componente WebView2 instalado, a página abre numa
janela de aplicativo do Edge, igualmente sem barra de endereço.

`instalador/construir-janela.ps1` gera a janela a cada release. Para compilar
e rodar, ela precisa de três arquivos do SDK público do WebView2, distribuído
pela Microsoft no NuGet sob licença BSD. O pacote é baixado numa versão fixa e
conferido pelo SHA-256 antes de qualquer uso, de modo que um pacote diferente
do esperado interrompe a construção; e, como a licença permite redistribuir
desde que o seu texto acompanhe os arquivos, ele segue junto, em
`app\LICENSE-WebView2.txt`. O executável é de 32 bits de propósito, para
rodar igual em Windows de 32 e de 64 bits com um único carregador.

Num clone do repositório, ou numa instalação feita rodando o `instalar.ps1`
pela linha de comando, a janela não existe, porque não é versionada e só o
`.exe` a carrega. Nesses casos, o atalho, quando há, aponta para
`sync\abrir.vbs`, que põe o serviço de pé e abre a página local no navegador
padrão, e os dois cliques na bandeja fazem o mesmo.

### O ícone da bandeja

O ícone na área de notificação, com o desenho do Trackeroao, é o sinal de
que a aplicação está aberta. Ele acende quando o serviço sobe e fica aceso
enquanto o Trackeroao estiver de pé, inclusive com o jogo fechado e com a
janela escondida, porque é por ele que a janela escondida volta. Um clique nele
abre a janela. Ao passar o mouse, ele mostra o nome e a versão instalada
("Trackeroao 1.7.8").

O desenho do ícone é um T branco dentro de um anel verde-limão fechado. O anel
aberto em arco fica reservado para um único estado: enquanto uma atualização
pedida pela bandeja está em andamento, o arco gira no lugar do anel, e o ícone
volta ao normal quando ela termina (ou em até três minutos, se o serviço não
responder).

No Windows 11, um ícone novo nasce escondido no menu da seta da área de
notificação. Na primeira vez que o Windows registra o ícone do Trackeroao, em
`HKCU\Control Panel\NotifyIconSettings`, ele é posto à vista (`IsPromoted`), e
a entrada recebe a marca `TrackeroaoVisivel`. Dali em diante a escolha é de
quem usa: escondido à mão, o ícone continua escondido, inclusive depois das
atualizações. No Windows 10 essa preferência não tem registro acessível, e
vale a configuração da própria barra de tarefas.

O clique com o botão direito abre o menu do Trackeroao. Ele é desenhado no
estilo da aplicação, e não no do Windows: fundo escuro, texto claro, cantos
arredondados no Windows 11 e o verde-limão como destaque do item sob o mouse
(vermelho, no "Fechar"). A organização segue a do menu da Steam. No topo fica
a linha com o ícone, o nome e a versão; abaixo dela, os jogos instalados ou
vigiados, do jogado por último ao mais antigo, até cinco, cada um com o
logotipo oficial do jogo, o PNG de fundo transparente da Steam, sem a margem
vazia em volta e encaixado numa faixa de 44 por 22 pixels. O serviço baixa o
logotipo uma vez (rota local `/logo-bandeja`) e o guarda em
`sync/cache/logos`; jogo sem logotipo conhecido fica com um selo da cor dele e
a inicial do nome. Um clique num jogo abre a janela na página de
progresso dele, ou na tela inicial para quem ainda não tem página. A lista
vem da rota local `/bandeja.txt` e é lida em segundo plano, ao acender o ícone
e a cada vez que o menu fecha, de modo que abrir o menu não espera nada.

Depois dos jogos vem o consumo do próprio Trackeroao naquele momento: CPU, GPU
e RAM. O número soma todos os processos da aplicação: o serviço
(`node`), os `Trackeroao.exe` da janela e do ícone, e os processos que eles
abriram, como o motor da página (`msedgewebview2`). A CPU é a fração do
processador inteiro, calculada pela diferença do tempo de processador entre
duas medidas; a GPU vem dos contadores "GPU Engine" do Windows, a mesma fonte
do Gerenciador de Tarefas, e mostra o motor mais ocupado; a RAM é o conjunto de
trabalho privado somado, o mesmo número da coluna "Memória" do Gerenciador de
Tarefas. O conjunto de trabalho inteiro contaria de novo, em cada processo do
WebView2, as páginas de memória que eles dividem entre si. O menu abre na
hora, e a medida roda fora dele, numa linha de execução própria: os números
chegam logo depois de o menu aparecer e se renovam a cada segundo enquanto ele
está aberto. Nada é medido com ele fechado. O consumo do computador como um todo
não aparece aqui: para isso existe o Gerenciador de Tarefas.

Abaixo do consumo vêm as ações:

- **Abrir o Trackeroao** mostra a janela, onde ela estava.
- **Forçar atualização** pede ao serviço, pela rota `POST /atualizar`, que
  confira a release mais nova naquele instante, sem esperar a próxima rodada e
  mesmo com o jogo aberto, já que foi a pessoa quem pediu. Havendo versão nova,
  ela é aplicada, e o serviço se reinicia e acende o ícone de novo, já com o
  anel fechado. Durante a conferência e a aplicação, o anel do ícone gira. Se a
  instalação já está na última versão, um aviso pequeno aparece ao lado do
  ícone, dizendo qual é a versão instalada, e some sozinho.
- **Iniciar com o Windows** é uma caixa, desmarcada de início. Marcada, o
  Trackeroao sobe no logon, com o ícone na bandeja e sem janela; desmarcada,
  nada dele inicia sozinho.
- **Fechar** encerra tudo de verdade: a janela, o ícone e o serviço. Antes de
  sair, grava `sync/fechado.flag`, e o serviço não volta por conta própria até
  a pessoa abrir o Trackeroao à mão ou, com a caixa marcada, até o computador
  reiniciar.

Os textos do menu seguem o idioma escolhido na página ou, sem escolha, o do
Windows.

### Atualização

A instalação se mantém atual sem intervenção. O serviço confere se há release
nova vinte segundos depois de subir, a partir daí a cada cinco minutos,
também logo que a janela é aberta e logo que um jogo acompanhado é fechado;
uma falha de rede apenas repete a tentativa cinco minutos depois. Uma release
só é publicada depois que a instalação completa passou num Windows limpo, e a
consulta a `/releases/latest` nunca devolve rascunhos nem pré-lançamentos, de
modo que o que chega à máquina é sempre uma versão estável. A conferência
acontece sempre entre duas rodadas de verificação do jogo, nunca no meio de
uma, e nunca com o jogo aberto: enquanto se joga, ela simplesmente espera. Há
versão nova, o código da tag é baixado, copiado por cima da instalação e o
serviço se reinicia sozinho, sem janela, sem aviso e sem tocar nos arquivos de
estado. O que aconteceu fica apenas no log. A única exceção à espera é o
"Forçar atualização" da bandeja, que roda na folga seguinte mesmo com o jogo
aberto.

A janela do Trackeroao não vem no pacote de código, porque é binária. Quando a
versão dela, registrada em `app\versao.txt`, fica para trás, o serviço baixa o
instalador daquela mesma release e o chama no modo `/so-janela` (a função
`trocarJanela` de `sync/atualizar.js`). Nesse modo o instalador não mostra
janela nem roda script: extrai a janela nova para uma pasta ao lado e a põe no
lugar de `<instalação>\app`, que é substituída inteira. Nada fica duplicado, e
nenhuma cópia antiga sobra ao lado da nova. A janela nunca é fechada debaixo
de quem está olhando para ela: a conferência só troca nada quando não há versão
nova, e, havendo, a troca espera enquanto a janela está à vista. A janela
informa o próprio estado em `sync/janela.estado` ("vista" ou "escondida") e
no sinal `Local\TrackeroaoAVista`; à vista, o serviço nem começa a troca, e o
instalador, se chamado, sai com o código 3. Escondida na bandeja, ela é
fechada, a pasta é trocada e a janela nova volta escondida, no mesmo lugar,
sem que nada apareça na tela. O instalador daquela versão fica guardado na
pasta temporária entre uma tentativa e outra, um só, para não ser baixado de
novo a cada cinco minutos, e sai quando a troca termina ou quando outra versão
chega. O ícone da bandeja, que é o mesmo `.exe`, sai durante a troca e volta
em seguida. Reinstalar pelo `.exe` segue a mesma regra: a pasta
`app` é trocada no lugar, depois de fechada uma janela que estivesse aberta.

Num clone do repositório, a mesma rotina só avança a `main` por fast-forward,
e só com a árvore limpa. A variável de ambiente `TRACKEROAO_SEM_ATUALIZAR`
desliga tudo isso.

Instalações anteriores à v1.5.0 não têm essa rotina e precisam de uma única
reinstalação com o instalador da v1.5.0 ou posterior; dali em diante, elas se
atualizam sozinhas.

### Desinstalando

O instalador deixa uma cópia de si mesmo na pasta da instalação, com o nome
`trackeroao-desinstalador.exe`, e registra o trackeroao em "Aplicativos
instalados" do Windows. Remover por lá, ou rodar esse executável, desfaz na
ordem inversa tudo o que o instalador fez: a tarefa agendada, os processos, a
janela e o ícone da bandeja, o atalho, a regra de firewall e a pasta, com a
janela do Trackeroao dentro dela. Antes de apagar, ele
guarda uma cópia do progresso nos Documentos; pela linha de comando, o script
pergunta antes. O Node.js e o
save do jogo ficam como estão. Num clone, `.\windows\uninstall-sync-service.ps1`
remove só a tarefa agendada.

### Rodando na mão, para depurar

```bash
npm start
```

Ou dois cliques em `windows\run.bat`. Pare o serviço antes, senão os dois disputam a
porta 8777.

Os dois passam `--manual` ao serviço. Sem essa marca, no Windows, o serviço só
fica de pé quando foi aberto pela janela, pelo atalho, na volta de uma
atualização ou com "Iniciar com o Windows" marcado; qualquer outro início sai
na hora, e é isso que impede o Trackeroao de subir sozinho.

Isso sobe duas coisas ao mesmo tempo. A primeira é o poll do processo, que a
cada cinco segundos checa se o `sekiro.exe` está rodando; o watcher do save só
existe enquanto o jogo está aberto, de modo que com o jogo fechado não há
handle aberto no arquivo nem leitura de 11 MB acontecendo à toa. A segunda é o
servidor, que escuta em `0.0.0.0:8777` e por isso também responde ao celular —
ao subir, ele imprime o endereço da máquina na rede local e o nome pelo qual
ela atende, `http://trackeroao.local`.

Os outros comandos:

```bash
npm run selftest    # confere a leitura do save e o parsing nesta máquina
npm run sync        # lê o save uma vez e escreve progress.json
npm run serve       # só o servidor, sem o watcher
npm run deaths      # a contagem de mortes, lida da memória
npm run discover    # descoberta de offsets por diff (adiante)
npm run jogos       # varre os jogos instalados nesta máquina
npm run auditoria   # relatório do que o repositório público expõe
```

O `auditoria` é anterior ao fim do site: ele monta, num arquivo de texto fora
do git, o inventário do que o repositório e o antigo endereço do site
entregam a quem os visita. Hoje não há progresso publicado, e o relatório
serve apenas para conferir o que o próprio repositório expõe.

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

Na rede de casa, o computador atende pelo nome `trackeroao.local`, anunciado
por mDNS (a lista está em `NOMES_REDE`, em `sync/main.js`; os demais nomes
dela ficam para quem já usava os antigos). É por esse nome que o iPhone chega
à página e o aplicativo de Android encontra o computador, de modo que a troca
de endereço que o roteador faz num reinício, por causa do DHCP, não quebra
nada. Três endereços do servidor existem por causa do celular: `/rede`
responde o IP e a porta da máquina; `/qr.svg` devolve, só para a própria
máquina, um código QR montado na hora com o endereço dela na rede atual
(`?para=pagina` ou `?para=android`, gerado por `sync/qr.js`, sem dependência
externa); e `/android.apk` entrega o aplicativo de Android guardado em
`<instalação>\app\trackeroao.apk`. O restante da pasta `app`, que é a janela
do Windows, não é servido.

### Diagnóstico

Rodando oculto, a saída vai para `sync/trackeroao.log`, que rotaciona a cada
512 KB. Um boot saudável tem cerca de vinte linhas e termina com o estado do
jogo:

```
  >> Sekiro aberto - sincronização ativa
  [watch] monitorando C:\Users\...\S0000.sl2
```

Para conferir se a tarefa está de pé, `Get-ScheduledTask TrackeroaoSync`. Se
o serviço não sobe no logon e o log não registra tentativa nenhuma, vale ver se
existe `sync\fechado.flag`: é a marca deixada pelo "Fechar" da bandeja, e ela
some quando o Trackeroao é aberto pelo atalho.

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

Sem a janela aberta e sem ícone na bandeja, resta um único processo `node`,
que ocupa algo entre 50 e 60 MB de memória
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

### Com a janela aberta

A janela do Trackeroao só existe enquanto está aberta, e só abre quando a
pessoa a abre. Enquanto isso, somam-se o processo `Trackeroao.exe` e os
processos auxiliares do WebView2 (`msedgewebview2`), que o componente cria
como qualquer vista baseada no Edge. O consumo é o de uma página aberta num
navegador moderno, e a página pede o `progress.json` ao serviço a cada cinco
segundos. Ao fechar a janela, todos esses processos terminam; a pasta de
dados do componente é uma só, sempre a mesma, e não cresce de uma abertura
para a outra. O ícone da bandeja, descrito a seguir, fica aceso enquanto o
Trackeroao estiver de pé, com ou sem janela, e só se apaga quando a pessoa
escolhe "Fechar". Fechar a janela pelo X apenas a esconde: a página deixa de
ser desenhada e o componente devolve memória ao sistema, como na janela
minimizada.

Até a versão 1.7.3, a tela inicial pesava mais do que devia: a trama do fundo
era animada pela posição de uma máscara numa camada várias vezes maior que a
tela, e o "oao" do título respirava numa animação infinita. As duas coisas
obrigavam o navegador a redesenhar e recompor a página a cada quadro, sessenta
vezes por segundo, e o vidro desfocado por cima refazia o desfoque a cada vez.
O menu da bandeja chegou a mostrar, com a janela aberta, cerca de 7% a 10% de
CPU, 28% de GPU e 350 MB de RAM. A partir da 1.7.4:

- a trama é desenhada uma única vez, numa camada só um pouco maior que a tela,
  e depois apenas se move, cinco passos por segundo, sem novo desenho;
- a respiração do título é uma animação curta disparada a cada sete segundos,
  e não uma animação infinita com pausas longas;
- com a janela fora de foco ou escondida, toda animação da página para, e a
  cor da barra deixa de ser conferida;
- com a janela minimizada, a página deixa de ser desenhada e o componente é
  instruído a devolver memória ao sistema (`MemoryUsageTargetLevel` baixo);
- o WebView2 usa um único processo de página, sem processo de reserva e sem as
  tarefas de rede de fundo do navegador.

Cada release agora passa por um orçamento de recursos antes de ser publicada:
no Windows limpo da integração contínua, com a janela aberta e parada, o
Trackeroao inteiro (serviço, janela, ícone e os processos do WebView2) é medido
por vinte segundos, e a release não sai se passar de 2% de CPU ou de 400 MB de
memória privada. A referência é a de um aplicativo leve de uso contínuo, como
o Spotify no computador; subir esse orçamento é uma decisão do dono do
projeto, tomada só quando algo realmente relevante for acrescentado. O
`selftest` também barra, antes disso, qualquer animação da tela inicial que
volte a redesenhar a página a cada quadro.

Medido no Chromium, sobre a mesma tela inicial em três segundos de janela
parada, o número de rasterizações caiu de 4.345 para 24, e o de pinturas de
360 para 6. Os números da bandeja no Windows dependem da placa de vídeo e do
tamanho da janela; a medida certa é a do próprio menu, depois da atualização.

A medida da bandeja também ficou mais leve. Antes, ela criava um contador do
Windows para cada motor da placa de vídeo e refazia a lista a cada cinco
segundos, o que custava processador ao próprio ícone, que entra na soma. Agora
ela lê a categoria "GPU Engine" inteira de uma vez por segundo, e só enquanto o
menu está aberto.

### Com o jogo aberto

Ao processo `node` somam-se três coisas.

- **O ícone da bandeja**, que é um `powershell` residente com Windows Forms. A
  estimativa é de 60 a 90 MB de memória, com CPU quase nula. O único trabalho
  periódico dele é conferir, a cada dois segundos, se o serviço que o abriu
  continua vivo, para não deixar na bandeja um ícone que não leva a lugar
  nenhum. Ele não abre a janela sozinho; a janela só aparece com dois cliques
  nele ou no atalho.
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

Cada leitura termina gravando o `progress.json` no disco, e é só isso. Não há
publicação, `git` nem envio de nada para fora do computador depois de uma
leitura.

### O que não acontece

A aplicação não escreve nada no jogo, não mantém o save aberto fora das
leituras, não baixa dependência em tempo de execução e não publica o progresso
em lugar nenhum. Também não abre janela nem navegador por conta própria:
quando o jogo começa, o único sinal visível é o ícone na bandeja, e a janela
do Trackeroao só aparece quando a pessoa a abre.

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
escolhido e sem Steam, a janela do computador mostra um convite discreto para
dar o nome, e no celular aparece só o título, já que o nome não se escolhe de
lá.

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

Na página do Sekiro, o tempo de jogo aparece numa barra única, dividida em
oito trechos iguais até o limite da escala, preenchida na proporção exata das
horas jogadas, com a escala marcada no começo, no meio e no fim. Tudo o que se
abre com um clique (os quadros de progresso, os anéis e o seletor de estado)
leva um "+" dourado bem visível no canto, que gira quando o detalhe está
aberto.

A **detecção de que o jogo foi desinstalado**, que leva à hibernação, também
tem caminho sem Steam. A varredura de jogos registra a pasta em que o Sekiro
foi encontrado; se essa pasta deixa de existir e a varredura seguinte não o
encontra em outro lugar, o jogo é dado como removido. Sem nunca ter visto a
pasta, a resposta permanece "não sei", e "não sei" jamais aciona a hibernação.

## A tela de jogos

Antes da página de progresso há uma tela com os jogos desta máquina. Cada jogo
mostra se está instalado neste computador; a vigia (a capacidade de acender a
aplicação na bandeja quando o jogo abre) continua funcionando, mas não tem
indicador em tela nenhuma. Os jogos que o tracker sabe ler por inteiro, hoje só
o Sekiro, levam à página de progresso por um botão preenchido em verde-limão;
os demais servem para a detecção de abertura. O botão "All games" leva à lista
completa, dividida entre o que está no computador e o que não está. No
computador que roda o serviço, o botão com o ícone de recarregar, abaixo das
listas, pede uma nova varredura.

No canto de cima da lista completa, "Search games" abre um campo de busca pelo
nome. A busca é feita pelo serviço (`/buscar.json`, em `sync/busca.js`) e cobre
tudo o que o aplicativo conhece: os jogos desta máquina, a biblioteca da Steam,
a base de jogos da release e o catálogo geral da Steam guardado em cache, sem
consultar a rede. Os jogos desta máquina e da biblioteca vêm primeiro, depois
os populares, e em cada nível o nome que começa pelo que foi digitado. A base
tem perto de duzentos mil nomes; ela só entra na memória na primeira busca e
sai sozinha um minuto depois da última. Os resultados ocupam o lugar das duas
listas, em duas colunas e em páginas, e a lista de sempre volta quando a busca
fecha (pelo ✕ ou pela tecla Esc).

Quando o tracker lê algo novo no save desde a última vez que a pessoa abriu a
página do jogo (um chefe, um ídolo, uma prótese, uma arte, uma conta de oração,
uma semente ou uma conquista), o pôster do jogo ganha um selo verde-limão,
"New", no canto de baixo à esquerda, que pulsa devagar. Ele some quando a página
do jogo é aberta. A comparação usa só o que já é lido do save, e a lista do que
foi visto fica no próprio navegador; na primeira vez não há com o que
comparar, então nada aparece.

No alto de todas as páginas há três botões de navegação: voltar, avançar e
início. Voltar e avançar percorrem o histórico do próprio navegador, que
registra cada troca de tela; início leva à tela de jogos, ou ao progresso
quando não há lista de jogos. Nos navegadores que informam se há para onde ir,
o botão sem destino aparece apagado.

Ao lado do relógio da tela inicial ficam dois ícones pequenos, de traço fino.
O globo escolhe o idioma, como descrito na seção seguinte. O celular, visível
apenas na janela do próprio computador, abre o passo a passo para levar o
Trackeroao ao telefone, descrito mais adiante.

No pé de todas as páginas há a mesma assinatura, "made by oaovito", que não
muda com o idioma. Na tela inicial ela aparece com destaque, separada por um
fio e na tipografia dos títulos; nas demais, fica pequena e apagada, quase
imperceptível.

Essa tela tem identidade visual própria, deliberadamente distinta da página do
Sekiro: por ser a porta de entrada para qualquer jogo, ela não herda o papel, o
vermelho e o dourado daquela página. O modelo é a tela inicial de um console. O
jogo em foco ocupa um palco no alto, com a arte larga do título, o logotipo
recortado e o que se sabe dele; o fundo da tela inteira é essa mesma arte,
desfocada, de modo que a cor ambiente muda conforme o jogo escolhido; e os
jogos ficam logo abaixo, num trilho de pôsteres. Por trás de tudo, uma trama
quase invisível repete o nome "Trackeroao" em diagonal e desliza devagar. A interface em si é neutra,
com vidro escuro, texto claro e um único verde-limão para foco e ação, para
que a cor venha dos jogos e não da página. A tipografia é a Unbounded nos
títulos e a Sora no texto. A tela abre sempre no modo escuro, e o botão de
tema no canto alterna para o claro; a escolha é guardada à parte da página do
Sekiro.

No computador, a tela inicial cabe inteira na janela, sem barra de rolagem: o
palco ocupa a altura que sobra, e os pôsteres são medidos também pela altura da
janela, de modo que o título, o palco, os jogos instalados, os dois botões e o
rodapé aparecem juntos em qualquer tamanho de janela. No celular, estreito
demais para isso, a tela continua rolando.

A regra vale para toda a aplicação no computador: nenhuma tela rola, a não ser
onde o dono do projeto pedir. A página de progresso de cada jogo se reorganiza
numa grade que ocupa a altura da janela; em janelas baixas, os dois quadros de
progresso ficam lado a lado. O que não cabe de uma vez é folheado em vez de
rolado: as listas das janelas de detalhe (chefes, itens, conquistas) se
distribuem em colunas e páginas, a lista completa de jogos se divide em
páginas por grupo, e o trilho de pôsteres, quando há mais jogos do que cabem,
passa de página em página. Em todos os casos, as setas ‹ e › com o número da
página, a roda do mouse e as setas do teclado fazem a troca. No celular, a
disposição de sempre continua, com a rolagem mínima que já tinha.

Quando um jogo está em foco, a arte dele ocupa a tela inteira, e a trama
animada do "Trackeroao" se desliga enquanto isso, voltando só quando não há
arte. O palco não tem moldura nem imagem própria no computador: ele é o trecho
em foco dessa mesma arte. São três camadas da mesma imagem, no mesmo lugar,
pixel sobre pixel: nítida numa elipse larga centrada no palco, meio desfocada
numa elipse maior e bem desfocada no resto da tela. A passagem de uma para a
outra é gradual e não tem canto, corte ou diagonal; o alto da tela fica fora da
camada nítida, para a barra da janela continuar na cor da página. As camadas
são estáticas e não pedem novo desenho enquanto a tela está parada.

Nos pôsteres sem arte, o nome do jogo nunca se parte no meio de uma palavra.
Quando uma palavra não cabe na largura do pôster, apenas a letra diminui, sem
que o pôster cresça. Títulos longos aparecem pelo nome curto mais conhecido
("Sekiro", "Skyrim", "GTA V"), ou pelo nome sem o subtítulo, e o nome completo
continua sob o pôster.

Cada jogo aparece pela própria arte, na maior resolução disponível. Para os
títulos da Steam, `sync/arte.js` monta, para cada peça, uma lista de endereços
em ordem decrescente de tamanho: a arte do topo da biblioteca em 3840×1240,
depois em 1920×620; o pôster em 1200×1800, depois em 600×900; o logotipo em
dobro de resolução, depois o normal. A página tenta o primeiro endereço e só
desce na lista quando ele não existe, de modo que nenhuma imagem pequena é
esticada quando há uma grande. Para os jogos que não estão na Steam
(Valorant, Fortnite, Minecraft e outros), `sync/populares.json` registra o site
oficial, e a arte usada é a imagem de divulgação que o próprio site declara
(`og:image`); um jogo achado no disco sem identificador passa ainda por uma
busca exata de nome na loja da Steam. O que é resolvido fica guardado por
trinta dias em `sync/cache/arte.json`. Sem rede, ou sem arte conhecida, o jogo
ganha um pôster tipográfico com o próprio nome, numa cor derivada dele.

A lista vem de `sync/biblioteca.js`, que consulta três fontes de nomes: a
biblioteca da Steam da pessoa, quando existe (os `appmanifest` de cada
biblioteca e o que a conta já jogou, segundo o `localconfig.vdf`); a base de
jogos que acompanha cada release, `sync/catalogo-jogos.json.gz`, somada ao
catálogo geral da Steam quando há rede (a lista pública de aplicativos,
guardada por uma semana); e os jogos mais jogados do momento, que se atualizam diariamente e
somam-se a uma lista fixa em `sync/populares.json`. Essa lista fixa cobre os
títulos que nem estão na Steam, como Valorant, League of Legends, Fortnite e
Minecraft, e garante reconhecimento mesmo sem rede.

A base de jogos é gerada por `sync/gerar-catalogo.js` na integração contínua,
a partir da lista pública de aplicativos da Steam (com a lista de jogos
mantida em `jsnli/steamappidlist` como reserva), sem demonstrações, trilhas
sonoras, ferramentas e servidores. Ela é refeita antes de toda release e entra
no próprio commit que a release marca, de modo que cada instalação sai com a
lista do seu dia e reconhece jogos sem depender da rede. A regra do projeto é
que a base nunca fique mais de quinze dias sem release: a rotina
`.github/workflows/catalogo.yml` roda todo dia e, quando a última release tem
quinze dias ou mais, refaz a base, escreve as notas da versão seguinte e
dispara a publicação, que passa pelo mesmo teste num Windows limpo de qualquer
outra release. Uma base com mais de quinze dias, sem fonte que responda, segura
a release em vez de publicá-la velha.

Com esses nomes, a varredura procura jogos em qualquer plataforma: nos
`appmanifest` da Steam, nos manifestos da Epic, nos programas registrados no
Windows e no disco. No disco, ela percorre em cada unidade as pastas onde
jogos costumam ser instalados (Games, XboxGames, Epic Games, GOG,
`steamapps\common`, Riot Games, Ubisoft, EA), as pastas de jogos que a própria
pessoa costuma criar, no idioma dela (Jogos, Juegos, Jeux, Spiele e as
demais), as mesmas pastas dentro do perfil do usuário e a raiz de cada disco,
onde muita gente instala o jogo direto (`D:\Sekiro`). Nas pastas de jogos, uma
subpasta a mais também é olhada (`D:\Jogos\RPG\Celeste`). O nome da pasta é
comparado de várias formas: inteiro, sem o que vem entre parênteses ou
colchetes e sem a versão ou o sufixo que vem depois do nome ("Hollow Knight
v1.5.78 [GOG]" é o Hollow Knight). Pastas dedicadas a jogos aceitam qualquer
nome da base; na raiz do disco, o nome da base só vale para uma pasta que
tenha o executável de um jogo, e as pastas do sistema (Windows, Users,
ProgramData e semelhantes) nunca contam; pastas genéricas como Program Files
aceitam apenas jogos da biblioteca da pessoa e populares, para que um programa
vendido também na Steam não seja tomado por jogo. De cada jogo
instalado, o executável é o maior `.exe` da pasta que não seja instalador,
atualizador, anti-cheat ou relatório de erro. A varredura roda um pouco depois
de o serviço subir e, daí em diante, uma vez por dia, sempre entre duas rodadas
de verificação e nunca com um jogo aberto. O resultado fica em
`biblioteca.json`, fora do git. Para rodá-la à mão, `npm run jogos`.

## Idiomas

A página fala doze idiomas: inglês, português do Brasil, espanhol, francês,
alemão, italiano, russo, polonês, turco, japonês, coreano e chinês
simplificado (a lista é `IDIOMAS`, em `trackeroao.html`). Por padrão, ela
segue o idioma do sistema, tal como o navegador o informa, e cai no inglês
quando o do sistema não está entre os doze. O globo da tela inicial abre a
lista, com cada idioma escrito no próprio nome, e a escolha feita ali passa a
valer no lugar da do sistema; a primeira opção da lista volta a seguir o
sistema.

A escolha é guardada em dois lugares. No navegador, para que aquele aparelho a
lembre; e no serviço, pela rota `/idioma`, que a grava em `sync/idioma.json`
por meio de `sync/idioma.js`. É desse arquivo que o menu da bandeja e as
caixas do instalador e do desinstalador tiram o idioma, de modo que todas as
partes do programa falam a mesma língua. Consultar o idioma guardado vale de
qualquer aparelho da rede, e um navegador sem escolha própria adota o que o
serviço guardou; mudá-lo, porém, só é aceito a partir do próprio computador.

O que não se traduz, e isso é deliberado: o nome da página, a assinatura do
rodapé, o nome de cada jogo e tudo o que o Sekiro batiza — chefes, itens,
áreas, conquistas, estados como Sinister Burden. São títulos, e aparecem como
o jogo os escreve. Um texto que falte num idioma cai no inglês, em vez de
sumir da tela.

## No celular, como aplicativo

O progresso chega ao celular pela rede de casa, a partir do próprio
computador, e não por um site. Na janela do computador, o ícone de celular ao
lado do globo mostra o passo a passo, que começa sempre pelo mesmo ponto: o
telefone precisa estar no mesmo Wi-Fi que o computador, o que se faz uma
única vez. Nenhum endereço aparece escrito na tela, para ser copiado: o painel
tem um botão para o iPhone e outro para o Android, e cada um mostra um código
QR com o endereço deste computador na rede em que ele está naquele momento.
O endereço varia de pessoa para pessoa e de rede para rede, e o código é
montado pelo serviço a cada vez que o botão é tocado; basta apontar a câmera
do telefone para ele.

**No iPhone**, lê-se o código com a câmera, abre-se o endereço no Safari, toca-se em
Compartilhar e depois em "Adicionar à Tela de Início". O Trackeroao passa a
abrir como um aplicativo à parte, com o ícone do Trackeroao e sem a barra
do navegador. Em casa, ele mostra a leitura corrente, atualizada a cada cinco
segundos.

Cada leitura bem-sucedida fica guardada no próprio aparelho, no armazenamento
local do navegador, sob a chave `ultima-leitura` (a constante `COPIA_CHAVE`,
em `trackeroao.html`). Quando o computador deixa de responder — o celular
longe de casa, o PC desligado —, a página exibe essa cópia, com um aviso de
que se trata da última leitura guardada, em vez de uma tela vazia. Há um
limite, que convém declarar: o endereço da rede de casa é `http`, e o Safari
só registra o service worker (`docs/sw.js`) em `https` ou no próprio
computador. Assim, o iPhone não guarda a página em si para abri-la do zero
sem conexão com o computador; a cópia é exibida quando a página já está
carregada e perde o contato com ele.

**No Android**, o Trackeroao é um aplicativo nativo, cujo código está em
`android/`. Ele encontra o computador sozinho, perguntando por
`trackeroao.local` por mDNS na rede de casa, sem que ninguém precise digitar
endereço algum, e guarda o último endereço que funcionou para responder mais
depressa da próxima vez. Tudo o que a página pede passa por ele: cada resposta
bem-sucedida vira uma cópia local, de modo que, longe de casa, o aplicativo
abre com a última leitura. Links para outros sites abrem no navegador do
telefone. O aplicativo apenas lê: não envia nenhum pedido que altere o
computador, e não pede outra permissão além das de rede e Wi-Fi.

O aplicativo de Android chega ao celular por dois caminhos, nenhum deles uma
loja: pelo próprio computador, cujo painel do celular, ao lado do globo da
tela inicial, mostra no botão do Android o código QR do endereço de onde
baixá-lo, na forma `http://<IP do computador>:8777/android.apk`; ou pela página da release, onde
o mesmo `trackeroao.apk` fica ao lado do instalador do Windows. Usa-se o IP, e não o nome
`.local`, porque nem todo navegador de Android resolve esse nome; o
aplicativo, depois de instalado, resolve.

O aplicativo é compilado sem Gradle, por `android/construir.sh`, que usa
apenas as ferramentas de linha de comando do SDK do Android: `aapt2`, `javac`,
`d8`, `zipalign` e `apksigner`.

Na release, ele é construído num runner Linux do GitHub e levado para dentro
do instalador e anexado à release. A assinatura usa uma chave criada no momento da construção e
descartada em seguida; nenhuma chave é guardada no repositório. A
consequência prática é pequena, porque o aplicativo é apenas um invólucro e
tudo o que ele exibe vem do computador: as atualizações da página chegam ao
celular sem que o aplicativo mude. Nas raras vezes em que uma versão nova do
aplicativo precisar ser instalada, o Android pedirá que a anterior seja
desinstalada antes.

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

O repositório é o projeto: clonar e rodar basta. Nada é resolvido fora desta
pasta, e há teste na suíte cobrando isso. `docs/` guarda os arquivos
estáticos que acompanham a página — ícones, artes, o manifesto e os ícones do
aplicativo —, e é o `sync/serve.js` que os serve, no próprio computador e na
rede de casa. Nenhum site é montado a partir dela.

```
trackeroao/
  trackeroao.html             a página (abra pelo servidor, não por file://)
  package.json                scripts npm (sem dependências)

  instalador/                 o que vira o .exe da release
    instalar.ps1              instalação do zero, ou por cima de uma existente
    desinstalar.ps1           o oposto exato do instalar.ps1
    construir-exe.ps1         compila os dois num .exe só, com a janela dentro
                              e os textos das caixas em doze idiomas (Textos)
    construir-janela.ps1      compila a janela do Windows; baixa o SDK do
                              WebView2 do NuGet, em versão fixa e conferida
                              pelo SHA-256
    janela/
      Trackeroao.cs           a janela do Trackeroao (vira app\Trackeroao.exe)

  android/                    o aplicativo de Android
    construir.sh              gera o .apk sem Gradle (aapt2, javac, d8,
                              zipalign, apksigner)
    AndroidManifest.xml       só permissões de rede e de Wi-Fi
    src/                      a tela, a busca do computador por mDNS e a
                              cópia local das leituras
    res/                      ícones e tema

  windows/                    atalhos para quem roda a partir de um clone
    run.bat                   execução manual
    install-sync-service.ps1  registra a tarefa agendada (não precisa de admin)
    uninstall-sync-service.ps1  remove a tarefa e encerra o serviço
    reativar.ps1              volta do arquivamento, se o jogo for reinstalado
    liberar-porta.ps1         abre a porta 8777 na rede local (pede administrador)

  releases/                   uma nota por versão; cada uma vira uma release

  docs/                       arquivos estáticos da página, servidos localmente
    icones/                   arte dos chefes, dos Headless e das conquistas
    manifest.webmanifest      nome, cores e ícones do aplicativo de tela inicial
    sw.js                     abre a última leitura quando falta rede
    app/                      ícones do aplicativo (tela inicial e janela)
    index.html                cópia da página, remanescente do antigo site
    progress.json             progresso saneado, remanescente do antigo site

  sync/
    main.js                   poll do processo + watcher + servidor + mDNS
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
    conquistas.json           ícone, raridade e dificuldade de cada conquista
    achievements.js           conquistas da Steam, que conferem as do save
    conquistas.js             ícones, descrição e dificuldade das conquistas
    tempo.js                  tempo de jogo: Steam, e o save quando não há Steam
    jogador.js                de quem é o progresso (nome escolhido ou da Steam)
    biblioteca.js             varre os jogos da máquina e da conta
    arte.js                   banner, pôster e logotipo de cada jogo, do maior ao menor
    populares.json            populares reconhecidos sem rede e sem Steam
    jogos.js / jogos.json     jogos vigiados e o que cada um sabe ler
    efeitos.js                efeitos temporários acionados pela sessão
    bosskills.js              conta cada vez que um chefe cai
    icones.js                 baixa as artes uma vez

    serve.js                  servidor estático + endereço na LAN + rotas
                              locais (/rede, /idioma, /android.apk, ...)
    mdns.js                   nome .local na rede, sem dependência
    idioma.js                 o idioma escolhido no globo, para todas as partes
    publish.js                saneamento do progresso e detector de vazamentos,
                              hoje usado só pela suíte

    bandeja.ps1               o ícone da bandeja e o seu menu
    abrir.vbs                 abertura pelo navegador, onde não há a janela
    oculto.vbs                sobe o serviço sem janela, via wscript do Windows

    instalacao.js             detecta se o jogo foi desinstalado
    hibernar.js               arquiva tudo e remove a tarefa agendada
    atualizar.js              atualização silenciosa para a release mais nova,
                              janela incluída
    discover.js               descoberta de offsets por diff
    auditoria.js              relatório do que o repositório expõe

    selftest.js               a suíte inteira
    pagetest.js               roda a página num DOM de brinquedo
    domshim.js                esse DOM de brinquedo
```

Numa instalação feita pelo `.exe`, soma-se a esta árvore a pasta `app\`, com a
janela do Trackeroao, as bibliotecas do WebView2, o texto da licença delas e
o registro da versão da janela. Ela não existe no repositório.

Dois arquivos de `docs/` são sobras do tempo em que havia um site. O
`index.html` é uma cópia da página que o atualizador ainda exige no pacote
de cada release, como sinal de que o download veio inteiro; o `progress.json`
é uma versão saneada do progresso, sem nada que identifique máquina ou conta,
que a suíte usa como amostra quando um clone ainda não leu nenhum save. Nenhum
dos dois é gerado ou atualizado pelo serviço. Do mesmo tempo vem o
`publish.js`: ele já não publica nada, mas as suas funções de saneamento e de
detecção de dados da máquina continuam a servir à suíte, que as aplica ao
código e aos arquivos de `docs/`.

Ficam fora do git, porque nascem em tempo de execução e carregam dados da
máquina: o `progress.json` cru, com o caminho do save; os arquivos de estado dos
contadores, que carregam carimbo de hora; o log; os despejos de memória; as
cópias de hibernação, que contêm o save e portanto o Steam ID; o idioma
escolhido (`sync/idioma.json`); a marca de "Fechar" (`sync/fechado.flag`); e o
que o `android/construir.sh` gera, em `android/build/`.

## Se der problema

Quando a mensagem é **"não achou o save"**, o caminho é `npm run selftest`. Se o
jogo nunca rodou nesta máquina, a pasta simplesmente não existe.

Quando a página diz **"sem sincronizar"**, ou quando o celular mostra a
última leitura guardada, ela não está falando com o serviço. As causas, da
mais comum para a menos: o celular não está no Wi-Fi de casa; o computador
está desligado ou dormindo; o Trackeroao foi fechado pelo menu da bandeja, e
só volta quando aberto pelo atalho; o serviço caiu, e aí
`sync/trackeroao.log` e `Get-ScheduledTask TrackeroaoSync` dizem o que houve;
ou o arquivo HTML foi aberto direto por `file://`, caso em que o
`fetch('progress.json')` não funciona e é preciso usar o endereço do servidor.

Quando o **iPhone não encontra `trackeroao.local`**, os dois aparelhos quase
sempre estão em redes diferentes (a rede de convidados do roteador, por
exemplo), ou a porta 8777 não foi liberada no firewall; o `liberar-porta.ps1`,
descrito acima, resolve o segundo caso.

Quando os **números parecem errados**, o suspeito quase sempre é o slot. Vale
ver qual o terminal escolheu e fixá-lo com `"slot": N` no `offsets.json`.

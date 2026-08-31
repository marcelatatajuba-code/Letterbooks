# Letterbooks

Um "Letterboxd para livros". PWA em JavaScript puro, sem framework e sem etapa
de build: os arquivos que estão no repositório são os que rodam no navegador.

Este arquivo existe para uma sessão nova não redescobrir, no susto, o que já
custou caro descobrir uma vez.

---

## Antes de qualquer coisa: o que este ambiente NÃO alcança

A política de rede do contêiner bloqueia **openlibrary.org** e
**supabase.co**. Isso não é defeito do app — o navegador da usuária alcança os
dois normalmente.

Consequências práticas, e elas mudam como se trabalha aqui:

- **Nunca julgue layout pelas capas.** Todo teste roda contra capas geradas em
  `docs/fixtures.py`, que são retângulos chapados. Capa de verdade tem outra
  proporção, outra cor e às vezes não existe. Três defeitos só apareceram num
  print do celular da usuária: assuntos sujos, fundo lavado e capa cortada.
- **Nenhum teste prova que o contrato com o Supabase está certo.** Os mocks
  imitam o formato do PostgREST, não o comportamento dele. A primeira conta de
  verdade é a prova.
- Para conferir SQL, há um Postgres local: veja `servidor/provar.sql`.

## Como rodar as verificações

Todas precisam de um servidor local na porta 8899:

```
cd /home/user/letterbooks && python3 -m http.server 8899 --bind 127.0.0.1 &
```

Depois, de dentro de `docs/`:

| suíte | o que cobre |
|---|---|
| `python3 testar.py` | ~100 verificações da parte local: telas, diário, listas, escala de aplicativo, capas |
| `python3 testar_nuvem.py` | conta, sessão, renovação de token, migração do diário |
| `python3 testar_social.py` | sincronização com fila, feed, seguir, curtir, comentar |
| `python3 jornada_e2e.py` | a jornada inteira com DUAS contas, do cadastro ao comentário |
| `python3 testar_regressao.py` | as FORMAS de dado que já quebraram: livro sem capa, leitura órfã, perfil só com @, resenha no limite do corte |
| `python3 rastreador.py` | anda o app sozinho: cobertura, acessibilidade, alvos de toque |
| `psql ... -f servidor/provar-v3.sql` | a view de avisos: quem vê o quê, num Postgres de verdade |
| `psql ... -f servidor/provar-v2.sql` | a identidade das listas, num Postgres de verdade |
| `node testar-chave.js` | a trava que recusa a chave errada do Supabase |
| `node testar-assuntos.js` | a limpeza de assuntos da Open Library |

**Rode as cinco primeiras antes de todo commit.** A `jornada_e2e` é a mais
barata em achados por minuto: as outras provam que cada peça funciona, ela
prova que funcionam juntas — e foi a única que pegou o bug da leitura
duplicada.

Depois de mexer em CSS ou JS, suba a versão do cache em `sw.js`
(`var CACHE = 'letterbooks-vN'`), senão o navegador serve a versão velha.

## Regras que vieram de errar

**Um rótulo que mente é pior que um espaço vazio.** A ficha do livro mostrou
por um dia inteiro o histograma das notas da PRÓPRIA leitora — igual em todo
livro do acervo — sob o título "Avaliações". Ninguém viu, porque a tela estava
cheia e bonita. Quando o dado da tela não é o dado que o rótulo promete, o
conserto vem antes de qualquer coisa que falte.

**A ferramenta de verificação mente calada, e é o defeito mais longevo que
esta casa tem.** Cinco dos defeitos mais duradouros do projeto não estavam no
app: estavam em quem media. Um portão que só conferia se o arquivo de prova
EXISTIA. Um `provar.sql` que morria na linha 133 e ninguém lia o status. Um
rastreador que ACEITAVA os diálogos do navegador em vez de acusá-los. Um mock
que ignorava `limit` e `offset` — então a janela de 40 linhas, o defeito que um
item inteiro existia para evitar, era invisível para a suíte. E doze provas de
privacidade escritas como `select count(*)` seguido de `\echo '   ^ 0'`, que
imprimem "2" onde devia ser 0 e saem com status zero: **verde**.

A regra que sai daí: **toda ferramenta nova nasce com o conserto desfeito
pelo menos uma vez.** Implemente o defeito de propósito e veja a asserção ficar
VERMELHA antes de acreditar que ela mede algo. Prova em SQL leva `do $$ ...
raise exception` e um CONTROLE NEGATIVO — afrouxe a política de propósito, veja
a prova estourar, e devolva. E prefira a asserção que compara com a FONTE (a
contagem da tela contra a contagem que a API tem) à que compara a tela consigo
mesma: "tem dez colunas" passa nas duas implementações; "40 na tela, 57 na API"
só passa na certa.

**O inventário também apodrece, e ele é a entrada do portão.** O commit que
criou a descida da nuvem tocou seis arquivos e três suítes, marcou o item como
`entregue` no backlog — e não tocou o `produto.json`. A feature ficou `ausente`
por doze entregas e a paridade foi medida PARA BAIXO todo esse tempo. A
auditoria que devia pegar isso escolheu sozinha o próprio escopo ("as 11
features parciais") e, por construção, não olhava para uma `ausente` que tinha
sido entregue.

Duas regras saem daí. A primeira: **feature só vira `completo` quando a
evidência aponta para uma asserção com NOME**, e não para uma linha de código —
linha prova que existe, asserção prova que funciona. A segunda: o elo entre o
que foi entregue e o que o portão conta é um **campo explícito** (`fecha`), e
não casamento por palavra; casar por palavra já falhou aqui uma vez, com as
especificações, e foi trocado por um campo `item` pelo mesmo motivo. O portão 1
confere esse elo e não pode fechar enquanto a própria entrada dele não for
conferível.

**Quando a especificação e o defeito discordam, vá ao dado.** O convite "envie
o diário deste aparelho" disparava em `logs + listas + marcações > 0`. A frase
estava certa no dia em que foi escrita e virou mentira quando a sincronização
ganhou volta: o número passou a contar justamente o que tinha ACABADO DE DESCER
da conta. A resposta ("o que só existe aqui") já estava gravada em toda linha,
no campo `remoto`, e ninguém perguntava a ela. Antes de acrescentar coluna ou
estado para responder uma pergunta, procure se o dado já responde.

**Prove a forma que o CLIENTE emite.** O índice único de `leituras` era
parcial (`where cliente_id is not null`), e o `provar-v1.sql` escrevia o
`ON CONFLICT` **com** o predicado — verde, por cento e cinquenta dias. Só que o
aplicativo não tem como mandar isso: ele manda `?on_conflict=perfil,cliente_id`
na URL, o PostgREST traduz para `ON CONFLICT (perfil, cliente_id)` sem
predicado, e o Postgres responde 42P10. Nenhuma leitura subia. A prova usava
uma sintaxe mais poderosa que a do chamador, e por isso provava o autor da
prova, não o chamador.

Vale para além do SQL: quando a verificação pode escolher a própria forma de
chamar, ela vai escolher a que funciona. Escreva a chamada como o cliente a
escreve, ou verifique com o cliente de verdade.

**Duas contagens do mesmo fato divergem — sempre.** A tela contava as leituras
sem `remoto`; o envio contava as mesmas menos as que não tinham o livro no
cache. A tela dizia 3, o fio mandava 2, e a suíte afirmava **as duas**, verdes,
sobre o mesmo diário. Depois disso a marca de migrado escondia o botão e a
leitura descartada não tinha mais caminho nenhum de volta. O conserto não é
acertar as duas contas: é ter **uma conta só** — a tela imprime o `length` do
objeto que o fio envia. Foi o mesmo defeito do mapa que existia em duas cópias
e já tinha divergido.

**Saber descrever bem um conserto não é prova de que ele funciona.** O commit
da V13 explicava com todas as letras que a régua de 44px passava a ser paga na
raiz: uma regra no lugar de três, duas linhas a menos de CSS, a dívida sem
poder reaparecer. Estava errado do jeito que importa — a regra ficou num
`@media` ANTES da declaração base, com a mesma especificidade, então a de baixo
vencia e ela nunca aplicou; e os três remendos que de fato funcionavam foram
apagados junto. Todo botão do aplicativo passou a medir 34px no celular,
inclusive a porta de entrada.

Sobreviveu porque o rastreador classifica alvo miúdo como gravidade MÉDIA e o
portão só conta ALTA: a ferramenta via a dívida e relatava verde. Só apareceu
quando alguém mediu o **computado** em vez de acreditar no relatório.

**Uma asserção de DOM prova que a linha existe; nunca que ela funciona.** Todo
o "Compartilhar" do app foi dado por bom durante meses com base em asserções
que contavam botões e liam rótulos. O que ninguém mediu foi a CARGA: o objeto
que chega ao `navigator.share`. Quando a medição finalmente existiu, apareceu
que a ficha do livro mandava a imagem sem link nenhum — e que a pior das três
portas era a única que a usuária de fato alcança, porque `.painel` some abaixo
de 720px e no celular só a folha rápida existe. **Antes de acreditar que uma
tela entrega alguma coisa, pergunte o que sai por ela e escreva a asserção
sobre isso.**

**O caminho que a plataforma de teste não tem é o caminho que ninguém mediu.**
O Chromium headless de Linux não implementa `navigator.share` nem `canShare`.
Consequência: a linha "Mandar" nunca era desenhada, e o ramo principal do
celular — o único que importa no aparelho da usuária — não era tocado por
suíte nenhuma. Foi lá que morava um `canShare({files})` perguntando por uma
carga e um `share({files, title, url})` mandando outra. Um stub de quatro
linhas devolveu esse ramo ao alcance da medição. **Ausência de API na suíte
não é ausência de risco: é ausência de olho.**

**Quando os especialistas derrubam o enunciado, o enunciado é que estava
errado.** Nesta volta os três derrubaram o mesmo ponto por caminhos
diferentes: oferecer o link do LIVRO no lugar do link da resenha é entregar
outra coisa com cara de entrega, porque quem recebe abre uma ficha onde a
resenha não está. O que existe de verdade naquele estado é o TEXTO. A folha
passou a oferecer o texto primeiro, o link nomeado pelo que ele abre, e um
aviso dizendo o que o link não leva. **Quando a troca é honesta, é a redação
que a torna honesta — e a redação é testável.**

A regra que sai daí: **conserto de CSS se prova medindo o computado, na
largura em que a regra vale.** E o corolário é mais amplo — quando o commit
descreve o conserto com confiança e nenhuma asserção o mede, a confiança é do
autor, não do código.

**Espera de teste tem que casar só com o destino.** Duas vezes uma
`wait_for_selector` casou com a tela ANTERIOR (`.conta h1`, depois
`.grade .cartao` — que a busca também desenha) e o teste virou moeda. O sinal
de espera tem que ser algo que só o destino tem.

**Corrigiu um defeito? Ele vira um caso em `docs/dados_teste.py`.** As suítes
provam FLUXOS; a de regressão prova FORMAS DE DADO, que é o que apodrece
calado. Um caso são ~10 linhas de dicionário — dado, rota e o que se afirma —
e nenhuma linha de código no runner. Se o defeito não for alcançável por dado
(pixel, CSS, defeito de mock), escreva o motivo em `SO_DE_TELA`: o
`conferir.py` falha de propósito quando um defeito não tem nem caso nem
motivo. Foi assim que a suíte nasceu já achando dois defeitos vivos.

**Um acento tem um trabalho só, e destruir não é acento.** `--a3` pintava
curtida, favorito, o botão "Apagar" e a caixa de erro — quatro significados num
token. `--perigo` existe só para o que vai sumir, e não aparece por decoração
em lugar nenhum.

**Fila é array que troca embaixo de você.** `enfileirar()` substitui o array
inteiro quando uma mudança supera outra. Tirar o item enviado por POSIÇÃO
(`shift()`) descartava justamente o que tinha acabado de entrar. Tire por
identidade, sempre — e desconfie de qualquer código que assume que o índice 0
de agora é o mesmo de antes do `await`.

**Meça, não olhe.** Três vezes seguidas o layout foi ajustado no olho e errou
do mesmo jeito: peça grande demais, densidade de site num aplicativo. O que
resolveu foi medir os quadros do vídeo do app original. As ferramentas estão
em `docs/` (`extrair.py`, `agrupar.py`, `cores.py`) e o método em
`docs/LEIA-ME.md`. A seção 12 de `testar.py` trava os números medidos.

**Confira QUAL quadro está na mesa.** Um erro real: o perfil foi comparado com
um quadro já rolado para baixo do retrato, e daí saiu a conclusão errada de que
o app não centraliza o avatar. Ele centraliza (quadro `t084`).

**Local primeiro, sempre.** O que a pessoa escreve tem que estar salvo antes de
qualquer coisa depender da rede. `js/sinc.js` põe cada mudança numa fila no
aparelho e esvazia quando dá. Nunca faça uma escrita depender da resposta do
servidor para acontecer.

**Nunca comprometa dado por conveniência de leitura.** A view `feed` precisa de
`security_invoker = on`; sem isso ela roda com os poderes de quem a criou e o
RLS das tabelas de baixo é ignorado.

## Convenções

- **Idioma.** Nomes de função, variável e classe em português. Comentários **sem
  acento** (convenção do arquivo); textos de interface **com acento**.
- **Comentários explicam POR QUÊ**, não o quê. O padrão do repositório é
  registrar a decisão e o que ela evita.
- **Cores por token.** A paleta está no `:root` de `css/app.css` e foi medida
  nos pixels do app original. Cada acento tem trabalho fixo:
  **verde `#00e054`** = o que você fez (lido, registrar, salvar);
  **laranja `#ff8000`** = o que você gostou (curtida, favorito);
  **azul `#40bcf4`** = onde você está (aba ativa, links).
  Não invente papel novo para cor existente nem cor nova para papel existente.
  A paleta anterior ("coral sobre café") continua no arquivo: basta
  `data-tema="cafe"` no `<html>`.
- **Área de toque mínima de 44px.** Cresça por `inset` num pseudo-elemento, não
  por largura fixa centrada — em controle colado na margem direita isso vaza da
  tela e cria rolagem lateral.
- **Capa vai inteira.** Pôster de cinema é sempre 2:3; capa de livro não.
  `object-fit: contain` por cima de uma cópia desfocada da mesma imagem.
- **`js/config.js` só aceita a chave `anon`.** A `service_role` ignora todas as
  políticas de RLS e **nunca** pode ir para o repositório. `js/nuvem.js` lê o
  papel escrito dentro da chave e se recusa a subir com a errada.

## Mapa dos arquivos

```
index.html            casca: topo, barra de abas
css/app.css           tokens no :root, depois componentes
js/config.js          URL e chave anon do Supabase
js/api.js             Open Library (busca, obra, autor, limpeza de assuntos)
js/dados.js           estado local + observador de mudanças
js/nuvem.js           conta, sessão, escrita, social
js/sinc.js            fila local → nuvem
js/app.js             roteador por hash + todas as telas  (~3000 linhas)
sw.js                 cache do app + acervo
servidor/esquema.sql  10 tabelas, RLS, view feed, gatilho de cadastro
servidor/provar.sql   prova o esquema num Postgres local
docs/                 medição, mapa das telas do original, suítes
```

`js/app.js` é o gargalo: quase toda tela passa por ele. Duas frentes mexendo
nele ao mesmo tempo colidem — trabalhe em série ali.

## O processo, medido

`docs/processo/` registra **como** este projeto foi feito, não o quê:
`defeitos.csv` tem os 32 defeitos com quem detectou cada um e quanto tempo
ficaram latentes; o `LEIA-ME.md` compara os três modos de execução com dados
do `git log`. `conferir.py` confere os números afirmados no documento contra a
fonte — rode depois de mexer no processo, nas suítes ou no registro.

A conclusão que os dados sustentam é uma só: **a usuária deixou de ser o
detector** (3 em 10 → 4 em 13 → 0 em 9). Todo o resto da tabela tem confundidor
e está anotado como tal.

## O ciclo de trabalho

Existem papéis definidos em `.claude/agents/` (produto, mercado, design, GPM,
tech lead, tester, harness) e o ciclo SDD que os orquestra. Para uma volta
completa, use a skill `/ciclo`. Para só verificar, `/verificar`.

**Duas armadilhas, as duas já pisadas:**

0. **O portão agora mede isto.** `portoes.py` tem o critério "entregas com a
   squad acionada": toda entrega marcada `entregue` no backlog precisa de uma
   especificação de design ligada a ela pelo campo `item` em
   `especificacoes.json`. Rastro é medível; boa intenção não é. Ele já nasce
   VERMELHO, nomeando as duas entregas (V5 e V6) que passaram sem squad — a
   dívida fica visível até alguém escrever as duas especificações que faltam.
   Era o único ponto cego que nenhuma outra medição via, porque todas elas
   olham o app, e o app dessas duas estava certo: o que faltou foi o caminho.
1. Os agentes só se registram quando a sessão abre NESTE diretório. Numa sessão
   que começou noutra pasta, `Agent(subagent_type: "design")` falha com "not
   found" — e a squad inteira fica invisível sem ninguém perceber. Solução:
   agente `general-purpose` com o conteúdo do arquivo do papel colado no começo
   do prompt.
2. "A implementação fica fora do script" é sobre a EDIÇÃO ser serial, não sobre
   trabalhar sozinho. Especificar, validar, planejar teste e revisar são dos
   agentes. As entregas V5 e V6 saíram sem nenhum papel acionado por causa
   dessa leitura errada.

**Um portão que não pode ficar vermelho não é um portão.** O critério "RLS
provado em Postgres real" conferia se os arquivos `provar*.sql` EXISTIAM. Ele
passou verde por seis entregas enquanto o `provar.sql` morria na linha 133 e
metade do arquivo nunca rodava — o psql parava ali e saía com status diferente
de zero, e ninguém lia o status. Não foi o psql que ficou calado; fomos nós que
não escutamos. Todo critério tem que RODAR o que ele afirma medir, e "não deu
para medir" nunca conta como passou.

**A ferramenta de teste também é código, e ela também mente.** O rastreador
aceitava todo diálogo do navegador (`d.accept()`), e aceitar um `prompt` sem
texto devolve **string vazia**: a cada rodada, por nove entregas, ele vinha
clicando "Apagar tudo", apagando registros e zerando a bio do perfil. Nada
afirmava nada sobre isso depois, então nunca apareceu. Quando uma ferramenta
"anda pelos caminhos destrutivos" de propósito, alguém tem que conferir o que
ela deixa para trás — e o conserto certo foi inverter: diálogo agora é achado
de gravidade alta, e é a única coisa no repositório que pega um `prompt()`
reintroduzido daqui a seis entregas.

**Conte as portas antes de estimar.** O item entrou como "P, seis portas". Eram
doze, em quatro naturezas diferentes, e quatro delas eram interface morta que
sobrevivia porque nenhuma suíte passava por lá. Os dois especialistas chegaram
a "é M" por caminhos independentes. Um item cujo enunciado nunca foi conferido
contra o código não tem estimativa — tem chute.

**"O caro já foi feito no servidor" merece ser medido, não acreditado.** O
item de denunciar foi para o backlog como esforço P, com a tabela, a política
e a função da nuvem dadas como prontas. Nenhuma das três estava: a política
deixava assinar denúncia no nome de outra pessoa, faltava a de select (sem
ela o `return=representation` REVERTE o insert, com 403), e a função usava
dado de chamada como nome de coluna e não olhava o motivo. Código que nunca
foi chamado por ninguém não é código pronto — é código não testado com uma
capa de pronto.

**Provar que nasce não é provar que atualiza.** As seis provas em Postgres
começavam todas de um banco vazio, e por isso nenhuma via o caminho que a dona
do banco realmente faz: colar o `esquema.sql` num banco que já existe, com
dados dentro e com a forma de alguma entrega antiga. Foi por aí que passou o
`cannot change name of view column` — `create or replace view` não muda a lista
de colunas de uma view existente, e a `feed` começa com `l.*`, então ela muda
sozinha a cada coluna nova em `leituras`. Por isso as views agora levam
`drop view if exists` antes do `create`, e por isso existe o `provar-v5.sql`.
A regra geral: **a verificação tende a medir o que é fácil de montar, não o que
a pessoa faz.** Quando as duas divergem, é a segunda que conta.

**Especialista errado não é especialista inútil.** O tech lead afirmou que
apagar a conta era inviável sem a `service_role`, e listou três motivos
independentes. O GPM tinha dito, sem justificar, que devia ser uma RPC. A RPC
funciona: `security definer` roda como dono do banco, alcança `auth.users`, e a
chave anon basta. Foi preciso ir ao Postgres decidir — a especificação mais
detalhada não é automaticamente a certa, e reconciliar é testar a discordância,
não escolher o parecer mais longo.

**Não redesenhe a tela para agradar a ferramenta.** O rastreador acusou de
"sumido" tudo que vinha depois de "Sair desta conta" — ele clica em ordem, e o
logout mata a sessão. A ordem da tela (destrutivo por último) estava certa;
quem tinha que aprender era o rastreador. Ele também fechava folha pelo
primeiro `.botao:not(.perigo)`, que na folha nova era "Exportar": a saída
DECLARADA (`data-fechar`) tem que ganhar do palpite.

**Quando parar de dar voltas:** não é quando o backlog acabar — ele sempre
volta a encher. É quando `python3 docs/processo/portoes.py` fechar os dois
portões que ele mede (fidelidade e solidez). Hoje: fidelidade **aberto** em
72% de paridade e 12 itens, solidez **fechado**.

Marque o item do backlog com `entregue` ao publicá-lo. Sem isso o portão conta
para sempre os mesmos itens e não pode fechar nunca.

O terceiro portão — mercado — não é medível daqui e não se fecha com volta de
agente nenhuma. Precisa de gente usando.

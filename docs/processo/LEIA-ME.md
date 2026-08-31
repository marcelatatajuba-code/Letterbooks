# O processo, medido

Registro do como — não do quê. O quê está nos commits e em `docs/kb/`.

Tudo aqui saiu de `git log` e das próprias suítes. Nenhum número foi
estimado. Onde a medida é fraca, está escrito que é fraca.

---

## Por que não é Scrum

Story point, velocity e burndown supõem que o recurso escasso é **hora de
gente**. Aqui não é. Três coisas limitaram este projeto, e nenhuma delas
aparece num burndown:

| o que limita | como se manifestou |
|---|---|
| **Ponto cego** | o ambiente não alcança a Open Library nem o Supabase. Três rodadas de retrabalho de layout saíram daí, e três defeitos só apareceram num print do celular. |
| **Colisão de arquivo** | `js/app.js` tem ~3.000 linhas e quase toda tela passa por ele. Isso limita o paralelismo mais do que qualquer capacidade de time. |
| **Capacidade de detecção** | defeito existe desde que foi escrito; o que muda é quando alguém consegue vê-lo. **26 dos 37** defeitos da última fase foram injetados antes dela e ficaram latentes de 1h20 a 25h. |

Então as métricas aqui medem **essas três coisas**, e não esforço:

- **quem detectou** cada defeito (usuária, suíte, agente, eu)
- **latência**: quanto tempo o defeito ficou vivo antes de ser visto
- **razão verificação/app**: quanto de código existe para provar o outro

## As fases do SDLC, e quem executou cada uma

O ciclo é SDD — especificação antes de código. O mapeamento para as fases
clássicas, com o executor real de cada uma:

| fase SDLC | o que é aqui | executor | artefato |
|---|---|---|---|
| Requisitos | inventário do Letterboxd contra o que o app faz | agente `produto` | `docs/kb/produto.json` |
| Análise de mercado | concorrentes e oportunidades, **com procedência** | agente `mercado` | `docs/kb/mercado.json` |
| Priorização | backlog único, fidelidade ganha de novidade | orquestrador de curadoria | `docs/kb/backlog.json` |
| Design | história, DoR, DoD, casos de uso, spec de tela | agentes `gpm` + `design` | `docs/kb/especificacoes.json` |
| Arquitetura | viabilidade, ordem, colisões | agente `tech-lead` | `docs/kb/plano-tecnico.json` |
| Plano de teste | casos, antes de existir código | agente `qa` | fase Revisão do ciclo |
| Implementação | **uma frente só, em série** | eu | commits |
| Verificação | sete suítes + rastreador autônomo | ferramenta | `/verificar` |
| Publicação | push; o Pages publica sozinho | ferramenta | — |

A implementação fica fora do script de propósito: agentes editando `app.js`
em paralelo se sobrescrevem, e trabalho perdido em silêncio custa mais do que
o paralelismo rende.

## Os três modos de execução, medidos

| | vibecoding | instrumentado | time híbrido |
|---|---|---|---|
| commits | 9 | 12 | 3 |
| linhas de app | 3.447 | 2.861 | 252 |
| linhas de verificação | **0** | 1.465 | 1.187 |
| linhas de conhecimento | 173 | 203 | 2.279 |
| defeitos registrados | 10 | 13 | 37 |
| **achados pela usuária** | **3 de 10** | **4 de 13** | **2 de 37** |
| graves achados por ferramenta | 1 | 4 | 6 |

As colunas por fase acima são um retrato do commit `dee44a2`, quando a
comparação foi escrita; só a de defeitos segue viva, porque `conferir.py` a lê
do `defeitos.csv`. Os totais do projeto — asserções, razão, defeitos — são os
de hoje e estão conferidos contra a fonte mais abaixo.

**A coluna de achados pela usuária deixou de ser zero, e o motivo importa.**
Ela ficou em 0 enquanto o que se media eram defeitos DO APP: as suítes, o
rastreador e os agentes pegavam tudo antes dela. Os dois que ela achou (D54,
D55) são defeitos **do processo**, não do aplicativo — a squad tinha parado de
ser acionada e ninguém dentro do processo percebeu, porque nenhuma das
verificações mede se o processo está sendo seguido. Um harness que verifica o
produto e não verifica a si mesmo tem esse ponto cego por construção, e foi
exatamente por ele que passaram duas entregas inteiras.

### Como ler isto sem se enganar

**1. As fases não fazem o mesmo trabalho.** A primeira era campo aberto — o
primeiro commit tem 2.420 linhas. A última é endurecimento e correção. Linha
por hora não compara.

**2. "Defeitos por fase" mede DETECÇÃO, não injeção.** **26 dos 37**
defeitos da última fase nasceram antes dela e ficaram latentes de 1h20 a 25h —
o mais antigo é o histograma da ficha, que mostrava as notas da leitora sob o
rótulo "Avaliações" desde o primeiro dia. O time híbrido não os evitou: ele os
**tornou visíveis**. Ler a tabela como "a última fase teve menos defeitos" é
ler ao contrário.

**3. Hora de parede não é esforço.** A última fase mostra 9,5 horas porque
inclui 73 minutos de agentes rodando e um intervalo longo sem trabalho nenhum.
Não divida nada por essas horas.

**4. O que a tabela sustenta de verdade** é uma coisa só, e ela é forte:
**a usuária parou de ser o detector.** De 3 em 10, para 4 em 13, para 0 em 9.
Isso não é opinião — é a coluna de detector do `defeitos.csv`.

## A curva da verificação

Asserções ao longo do projeto, ditas pelos próprios commits:

```
29/08 23:02   34   ▓▓▓
29/08 23:08   45   ▓▓▓▓
29/08 23:40   55   ▓▓▓▓▓
29/08 23:49   73   ▓▓▓▓▓▓▓
30/08 00:21   81   ▓▓▓▓▓▓▓▓
30/08 01:48  +46   suíte de nuvem nasce
30/08 05:04  +35   suíte social nasce
30/08 05:41   —    jornada de ponta a ponta nasce
30/08 05:59   —    rastreador autônomo nasce
30/08 15:39  103   suíte local hoje
30/08 19:__  111   V3: o bloco de avaliações da comunidade
30/08 20:__  +46   suíte de regressão nasce (12 casos de dado)
30/08 21:__  298   V4: um endereço só para a resenha
30/08 23:__  323   V5: listas na nuvem
31/08 00:__  333   V6: a aba Resenhas vira a da rede
31/08 01:__  340   a squad volta a ser acionada: 2 defeitos vivos na 1ª leitura
31/08 02:__  360   V7: avisos, com a especificação reconciliada dos três papéis
```

Hoje: **360 asserções** em quatro suítes, mais **46 checagens** em 12 casos de
regressão, o rastreador (que não assere: mede e relata) e quatro provas em
Postgres. **4.368 linhas de verificação para 7.579 de app** — razão de 0,58.

**18 de 60 defeitos** tem caso de regressão que os prende. Os outros 42 estão
listados um a um em `dados_teste.SO_DE_TELA`, cada um com o motivo de não ser
alcançável por dado — pixel, CSS, defeito de mock ou de processo. "Sem caso"
sem motivo escrito faz `conferir.py` falhar de propósito: dívida invisível é a
que ninguém paga.

Os três números acima foram conferidos contra a fonte depois de escritos, e os
três estavam errados na primeira versão deste arquivo: 251 contava os achados
do rastreador como asserção, 0,55 somava o script de orquestração como
verificação, e "4 de 10" atribuía à usuária um defeito que fui eu quem viu
(D04, o site atrasado). Ficam registrados porque um documento de métrica que
não confere os próprios números não vale a leitura.

## O que nenhuma métrica daqui alcança

- **Se o app está bonito.** O rastreador mede estrutura, alcance do dedo, nome
  acessível e erro de execução. Julgamento de desenho continua sendo trabalho
  de olhar, e o print do seu celular vale mais que qualquer suíte.
- **Se o contrato com o Supabase está certo.** Os mocks imitam o formato do
  PostgREST, não o comportamento. Três vezes um mock frouxo quase deixou passar
  defeito — e uma dessas vezes ele acusou o app de um erro que não existia.
- **Quanto custou.** Não meço horas de gente nem dinheiro. O que existe é o
  consumo do ciclo de agentes: 14 agentes, 1,95 milhão de tokens, 73 minutos.

## Quando o ciclo para

Não para quando o backlog acaba — backlog sempre volta a encher. Para quando
**três portões fecham**, e dois deles são medidos por
`python3 docs/processo/portoes.py`.

### Portão 1 — Fidelidade · *o app faz o que o original faz*

| critério | hoje | meta |
|---|---|---|
| paridade de features | **52%** (28 de 54) | ≥ 90% |
| itens de fidelidade em aberto | 10 | 0 |
| telas do original alcançadas | 14 de 14 | todas |

Parcial conta como não-feito: meia feature não compete com feature inteira.
Hoje há 14 parciais e 12 ausentes.

### Portão 2 — Solidez · *o que existe não quebra nem corrompe*

| critério | hoje | meta |
|---|---|---|
| asserções nas suítes | 360 | ≥ 200 |
| achados graves do rastreador | 0 | 0 |
| defeitos de corrupção em aberto | 0 | 0 |
| RLS provado em Postgres real | sim | sim |

**Este portão já está fechado.** Ele reabre sozinho no dia em que uma suíte
ficar vermelha — é por isso que ele é medido, e não declarado.

### Portão 3 — Mercado · *não é medível daqui*

Estes quatro critérios precisam de gente de verdade usando, e **nenhuma volta
de agente substitui nenhum deles**:

- alguém que não seja você usa por uma semana sem pedir ajuda — é o teste de
  que a interface se explica sozinha;
- 10 pessoas se cadastram e 3 voltam na semana seguinte — abaixo disso o feed
  nunca enche, e rede social com feed vazio não retém ninguém;
- cobertura do acervo em português medida em 50 títulos — é a entrega 1 do
  item 12 do backlog, e o proxy deste ambiente bloqueia a medição;
- alguém compartilha um link de resenha por vontade própria — o link público
  existe desde o começo e ninguém nunca usou.

### O que muda quando os dois primeiros fecham

O ciclo **não termina** — ele troca de combustível. Sai de "o que falta em
relação ao original" e entra em "o que as pessoas fizeram com o app". A
descoberta deixa de ser o agente de produto lendo o mapa das 24 telas e passa
a ser o que aparecer no portão 3.

Dizer que o app está competitivo com os dois primeiros portões fechados seria
o mesmo erro que a tabela dos três modos evita: confundir o que dá para medir
daqui com o que decide a coisa.

## Os arquivos

| arquivo | o que é |
|---|---|
| `defeitos.csv` | os 60 defeitos, com fase, gravidade, **quem detectou** e latência |
| `portoes.py` | mede os portões 1 e 2, e diz que o 3 não é medível daqui |
| `conferir.py` | confere os números deste arquivo contra a fonte |
| `../kb/` | a saída de uma volta do ciclo SDD |
| `../../CLAUDE.md` | as regras que vieram de errar |
| `../../.claude/agents/` | os sete papéis |

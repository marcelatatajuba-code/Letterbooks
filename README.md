# Letterbooks — diário de leitura (PWA)

O que o Letterboxd faz por filmes, para livros: buscar no acervo, registrar o
que você leu, dar estrelas, escrever resenha e montar listas.

A arquitetura é a do original, seguida de perto — página do livro em três
colunas com painel de ações à direita, diário em tabela com a célula do mês
atravessando as linhas, listas com pôsteres numerados, e avaliação de meia em
meia estrela. No celular, a barra de baixo repete o desenho do Letterboxd:
quatro ícones e o botão de registrar em destaque no meio. A paleta é própria: **coral sobre café**, um fundo marrom-tinta
com o trio **coral · oliva · rosa**, no lugar do azul-ardósia com verde-limão.
A marca são três lombadas numa prateleira, e não os três pontos.

> **Aviso.** Projeto independente, sem vínculo com o Letterboxd. A inspiração é
> declarada: a arquitetura de navegação e a gramática de avaliação vêm de lá.

---

## No ar

**https://marcelatatajuba-code.github.io/Letterbooks/**

O GitHub Pages publica a `main` direto, sem workflow: cada push republica.

## Como abrir

Não tem build, não tem dependência, não tem servidor. É HTML, CSS e JavaScript
servidos como estão.

```bash
# a partir da pasta letterbooks/
python3 -m http.server 8000
# depois abra http://localhost:8000
```

Publicando em **GitHub Pages**, funciona igual — o app usa caminhos relativos e
navegação por hash justamente para isso.

## Telas

| Tela | O que faz |
|---|---|
| **Início** | Suas leituras recentes, a fila de "quero ler", os livros em alta na semana e um resumo de onde você está no ano. |
| **Busca** | Título, autor ou ISBN, com paginação. Cola um ISBN de 10 ou 13 dígitos e ele busca pelo campo certo, não pelo texto livre. |
| **Ficha do livro** | Fundo formado pela própria capa, ampliada e desfocada — o lugar que no original é do still do filme. Sem abas: sinopse (que esmaece no fim, não corta), assuntos e detalhes empilhados, e o histograma de avaliações com a média grande ao lado. No computador as ações ficam num painel à direita; no celular, numa barra fixa que abre o cartão das quatro funções. |
| **Registro de leitura** | Nota de meia a cinco estrelas, data em que terminou, resenha, marcação de releitura e aviso de spoiler. Um livro pode ter vários registros — cada releitura é uma linha nova. O "+" da barra abre a busca, com as **buscas recentes** guardadas para repetir sem redigitar, e emenda direto aqui. |
| **Diário** | No computador, uma tabela com a célula do mês atravessando as linhas daquele mês. No celular vira o que é no original: faixa de mês de largura inteira e linhas enxutas, com ♥ (curtida), ↺ (releitura) e ≡ (tem resenha) ao lado da nota. Spoiler fica coberto até você tocar. |
| **Resenha** | Cada resenha tem endereço próprio: fundo, autoria, livro, nota, data e o texto inteiro. É onde ficam editar e apagar. Abre pelo ≡ do diário. |
| **Autor** | O equivalente ao *cast & crew*: tocar no nome de quem escreveu abre a pessoa — retrato, datas, biografia e todas as obras dela no acervo, já marcadas com o que você leu. |
| **Estante** | Quatro prateleiras: quero ler, lidos, curtidos e favoritos. |
| **Listas** | Agrupamentos livres, com pôsteres **numerados** — a ordem importa. A capa do primeiro livro vira o fundo do cabeçalho. |
| **Perfil** | É o eixo, na ordem do original: controle segmentado (perfil · diário · listas · estante), avatar centralizado, fileira de favoritos, fileira de atividade recente com nota e marcadores sob cada capa, e então números, meta e histograma. |

## A avaliação em meia-estrela

Como no Letterboxd: clicar na metade esquerda de uma estrela vale meia nota, na
metade direita vale a estrela inteira. Pelo teclado, as setas sobem e descem de
0,5 em 0,5 — o controle tem `role="slider"` e anuncia o valor.

A nota que aparece na capa e na ficha é sempre a da **leitura mais recente**.
As notas antigas continuam no diário, e é a distribuição delas que alimenta o
histograma do perfil e do painel.

## Compartilhar

Na ficha de cada livro há **Compartilhar**, que monta uma imagem 1080×1920 com a
capa, o título, a autoria e a sua nota — para o story ou para qualquer conversa.

A imagem é desenhada no próprio aparelho, num `canvas`, e entregue à folha de
compartilhamento do sistema. Nada é enviado a servidor nenhum. Onde o navegador
não oferece o compartilhamento nativo, o arquivo é baixado.

## O desenho

A home não empilha grades: cada seção é um **trilho** que rola de lado, com só
as capas — é o ritmo do original. As grades com título ficam nas telas de
buscar, estante e listas, onde se varre com o olho em vez de folhear.

Há dois níveis de título, e a diferença importa: **seção da home** é negrito
em caixa normal com um `›`; **rótulo dentro da página** — avaliações,
favoritos, atividade recente, detalhes — é versalete cinza. Usar versalete em
tudo foi o que dava ao app cara de painel administrativo. Quase não há bordas: o que separa é espaço e
imagem. Na ficha do livro, o histograma de avaliações fica no corpo com a média
grande ao lado, e no celular o painel lateral dá lugar a uma **barra de ação
fixa** que abre um cartão com as quatro funções — lido, curtir, quero ler e
favoritar.

## Navegação

No computador, tudo fica na barra do topo. No celular, a barra de baixo tem
**Livros · Buscar · (+) · Diário · Perfil**, e o topo fica só com a marca.

O diário no celular perde o cabeçalho de colunas, o ano e os botões de editar
e apagar — essas ações vivem na página da resenha, que o ≡ abre. O que sobra é
espaço para o título, que antes quebrava em quatro linhas.

Estante e listas não aparecem na barra: elas vivem dentro do perfil, como no
Letterboxd. O perfil traz uma fileira de atalhos para elas.

## Duas escolhas que fogem do original

**As grades mostram o título abaixo da capa.** O Letterboxd mostra só os
pôsteres. Aqui não funciona igual: livro se reconhece bem menos pela capa do que
filme por pôster, e boa parte do acervo da Open Library não tem capa cadastrada.
Voltar à grade só de capas é trocar um `display` em `.cartao-legenda`.

**A paleta é quente.** O original é azul-ardósia frio com verde-limão. Todas as
cores moram no bloco `:root` de `css/app.css` — marca, degradê do herói e todos
os componentes saem dessas variáveis, então trocar o tema inteiro é reescrever
esse bloco e mais nada.

## De onde vêm os livros

Do acervo da [Open Library](https://openlibrary.org), o catálogo aberto do
Internet Archive: mais de 40 milhões de edições, com capas, autoria, ano e
sinopse. A API é pública e não exige chave nem cadastro — é ela que faz aqui o
papel que o TMDB faz no Letterboxd.

Nem toda obra tem capa por lá. Quando falta, o app desenha uma lombada com o
título em vez de mostrar um retângulo cinza.

## Onde ficam os seus dados

**Só no seu navegador**, no `localStorage`. Não existe servidor, conta nem senha,
e nada do que você escreve sai do aparelho.

A contrapartida é que o diário **não sincroniza entre aparelhos** e some se você
limpar os dados do site. Por isso o perfil tem **Exportar diário**, que baixa um
`.json` com tudo, e **Importar diário**, que lê esse arquivo de volta — é assim
que se leva a conta para outro celular ou se faz uma cópia de segurança.

## Offline

O *service worker* usa duas estratégias, porque as duas coisas têm naturezas
diferentes:

- **O app** (HTML, CSS, JS, ícones) é *cache-first*: abre instantâneo e funciona
  sem rede. Publicar uma atualização é trocar a versão do cache em `sw.js`.
- **O acervo** (buscas, fichas e capas) é *rede-primeiro com cache de reserva*:
  os dados chegam sempre frescos quando há conexão, mas os livros que você já
  abriu continuam acessíveis no avião.

O seu diário não passa por aí — ele já é local.

## Estrutura

```
letterbooks/
├── index.html              casca do app: cabeçalho, navegação e a marca em SVG
├── css/app.css             a paleta (bloco :root) e todos os componentes
├── js/
│   ├── api.js              Open Library: busca, tendências, ficha e capas
│   ├── dados.js            localStorage: leituras, listas, estatísticas
│   └── app.js              roteador por hash e as telas
├── icons/                  ícones do PWA (192, 512, maskable, apple-touch)
├── manifest.webmanifest
└── sw.js
```

Sem framework e sem etapa de build, de propósito: o arquivo que está no
repositório é exatamente o que roda no navegador.

## Limitações conhecidas

- **Um aparelho por vez.** Sem conta, não há sincronização; a ponte é o
  exportar/importar.
- **Nada é social.** Não há perfis de outras pessoas, seguir, comentar nem
  resenhas alheias — a parte comunitária do Letterboxd está fora do escopo.
- **O acervo é o da Open Library.** Livros muito recentes ou de editoras
  pequenas podem não estar lá, ou aparecer sem capa e sem sinopse.
- **A busca é a da Open Library.** Ela responde melhor a título e autor do que a
  frases soltas.

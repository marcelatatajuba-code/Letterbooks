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
| **Ficha do livro** | Três colunas: capa, conteúdo e painel de ações. O fundo atrás do título é a própria capa, ampliada e desfocada — o lugar que no original é do still do filme. O conteúdo tem abas de sinopse, detalhes e assuntos; o painel concentra lido, curtir, quero ler, registrar, listas, favoritar e o histograma das suas notas. |
| **Registro de leitura** | Nota de meia a cinco estrelas, data em que terminou, resenha, marcação de releitura e aviso de spoiler. Um livro pode ter vários registros — cada releitura é uma linha nova. O botão da ponta do cabeçalho abre a busca e emenda direto aqui. |
| **Diário** | Uma tabela: mês, dia, capa, livro, ano, nota, curtida. A célula do mês atravessa as linhas daquele mês. Resenhas com spoiler ficam cobertas até você tocar. |
| **Autor** | O equivalente ao *cast & crew*: tocar no nome de quem escreveu abre a pessoa — retrato, datas, biografia e todas as obras dela no acervo, já marcadas com o que você leu. |
| **Estante** | Quatro prateleiras: quero ler, lidos, curtidos e favoritos. |
| **Listas** | Agrupamentos livres, com pôsteres **numerados** — a ordem importa. A capa do primeiro livro vira o fundo do cabeçalho. |
| **Perfil** | É o eixo: fileira de números, atalhos para diário, estante e listas, meta de leitura, histograma de como você avalia, favoritos e prévia do diário. |

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

## Navegação

No computador, tudo fica na barra do topo. No celular, a barra de baixo tem
**Livros · Buscar · (+) · Diário · Perfil**, e o topo fica só com a marca.

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

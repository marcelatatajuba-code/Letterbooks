# Ligar a nuvem do Letterbooks

Enquanto este passo não é feito, o Letterbooks funciona como sempre funcionou:
diário, listas e resenhas guardados só no navegador, sem conta e sem servidor.
Nada aqui é obrigatório para o app rodar — isto liga a parte de **rede social**
(perfil público, feed, seguir, curtir, comentar).

São 10 minutos, e todo o plano gratuito do Supabase dá conta de começar.

---

## 1. Criar o projeto

1. Entre em <https://supabase.com> e crie uma conta.
2. **New project**. Dê um nome (`letterbooks`), escolha uma senha para o banco
   — guarde-a, você não precisa dela no dia a dia mas não dá para recuperar — e
   a região mais perto de você (`South America (São Paulo)`).
3. Espere uns dois minutos até o projeto ficar verde.

## 2. Criar as tabelas

1. No menu da esquerda: **SQL Editor** → **New query**.
2. Abra o arquivo `servidor/esquema.sql` deste repositório, copie **tudo**, cole
   na janela e clique em **Run**.
3. Deve aparecer *Success. No rows returned*. É isso mesmo: o arquivo cria
   tabelas, não devolve linhas.

O arquivo pode ser rodado de novo sem medo — ele recria as políticas do zero e
usa `if not exists` nas tabelas. Se você mudar alguma coisa nele depois, é só
rodar outra vez.

O que ele cria:

| tabela | para quê |
|---|---|
| `perfis` | uma linha por conta: `@usuario`, nome, bio, meta do ano |
| `livros` | cache comum do acervo da Open Library |
| `leituras` | o diário: cada leitura ou releitura é uma linha |
| `marcadores` | quero ler, curtida e favorito |
| `listas`, `lista_itens` | as listas e o que tem dentro |
| `seguidores` | quem segue quem |
| `curtidas`, `comentarios` | as reações às resenhas |
| `denuncias` | a porta de moderação que cadastro aberto exige |

E mais duas coisas que não são tabelas:

- a **view `feed`**, que junta leitura + perfil + livro + contagens numa
  consulta só;
- o **gatilho `ao_cadastrar`**, que cria o perfil no momento em que a conta
  nasce, com um `@usuario` tirado do e-mail. Sem ele, a pessoa entraria e não
  existiria em lugar nenhum.

## 3. Conferir as regras de acesso

Ainda no SQL Editor, rode:

```sql
select tablename, count(*) as politicas
  from pg_policies where schemaname = 'public'
 group by tablename order by tablename;
```

Todas as dez tabelas têm que aparecer. Se alguma faltar, o `esquema.sql` não
rodou inteiro — role a saída procurando o erro e rode de novo.

**Por que isso importa:** as regras de quem pode ler e escrever o quê estão no
banco (RLS), não no aplicativo. Isso quer dizer que valem mesmo para quem
chamar a API por fora do site, com a chave pública na mão. Se as políticas não
existirem, o Supabase bloqueia tudo — e o app vai parecer quebrado. Se
existirem erradas, o contrário. Não pule esta conferência.

A regra que atravessa o arquivo é: **leitura pública, escrita só do dono.**
Perfil e diário são públicos porque foi essa a decisão do projeto, igual ao
Letterboxd. E-mail e senha não são: eles vivem em `auth.users`, que o app
nunca lê.

## 4. Cadastro por e-mail

**Authentication** → **Sign In / Providers** → **Email**.

- Deixe **Enable email provider** ligado.
- **Confirm email**: ligado é mais seguro (ninguém cria conta com o e-mail dos
  outros); desligado é mais rápido para testar. O app trata os dois casos — com
  a confirmação ligada, ele mostra a tela "confirme o e-mail" em vez de entrar
  direto.

Em **URL Configuration**, ponha o endereço do site publicado em **Site URL**
(por exemplo `https://marcelatatajuba-code.github.io/Letterbooks/`). É para lá
que vão os links de confirmação e de troca de senha.

## 5. Colar as duas linhas

**Project Settings** → **API**. Copie:

- **Project URL** → `supabaseUrl`
- **anon public** → `supabaseChave`

E cole em `js/config.js`:

```js
var CONFIG = {
  supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
  supabaseChave: 'eyJhbGciOi...'
};
```

> A chave `anon` é **pública por natureza** — ela nasce para ficar no navegador
> de quem visita o site, e está no código-fonte de qualquer app que use
> Supabase. Quem protege os dados são as políticas do passo 3.
>
> A chave que **nunca** pode ir para o repositório é a `service_role`, logo
> abaixo dela na mesma tela: essa ignora todas as políticas de RLS. Se você
> colar a errada, qualquer visitante pode apagar o banco inteiro. Confira que o
> que você copiou está escrito `anon`.

Faça o commit e o push. O site publicado passa a mostrar a tela de conta.

## 6. Primeira conta e a migração

1. Abra o app → **Perfil** → **Criar conta**.
2. Crie a sua conta (e confirme o e-mail, se você ligou a confirmação).
3. Na tela da conta vai aparecer **"Trazer o diário deste aparelho"**, com a
   contagem do que você já registrou. Clique em **Enviar para a conta**.

O envio copia, nesta ordem: os livros (o acervo precisa existir antes das
leituras, é o que a chave estrangeira exige), as leituras, os marcadores e as
listas. Em lotes de 50 linhas, para não bater no limite do servidor.

**Nada é apagado do aparelho.** Se o envio falhar no meio, o diário local
continua inteiro e dá para tentar de novo. Depois de um envio completo, a data
fica guardada e o botão não volta a aparecer — é o que impede o diário de
duplicar a cada visita.

---

## Se der errado

**"Sem conexão com o servidor."** — a URL em `config.js` está errada ou o
projeto do Supabase está pausado. Projeto gratuito sem uso pausa sozinho depois
de uma semana; é só despausar no painel.

**"Erro 401"** ao entrar — a chave em `config.js` não é a do projeto, ou é a
`service_role` em vez da `anon`.

**Erro `permission denied for table ...`** — as políticas do passo 3 não estão
lá. Rode `servidor/esquema.sql` de novo.

**Erro `violates foreign key constraint "leituras_livro_fkey"`** durante a
migração — uma leitura aponta para um livro que não está no cache local. O
código já filtra esses casos; se acontecer, é sinal de que o diário local está
inconsistente, e o `Exportar diário` do perfil serve para você me mandar o
arquivo.

**A conta foi criada mas o perfil não existe** (`meuPerfil` volta vazio) — o
gatilho `ao_cadastrar` não foi criado. Rode a última parte do `esquema.sql` de
novo e crie outra conta; as contas feitas antes do gatilho precisam de uma
linha em `perfis` inserida na mão.

## Desligar

Apague os dois valores de `js/config.js` e faça o push. O app volta ao modo
local na hora, sem perder nada do que está no aparelho. Os dados que já
subiram continuam no Supabase, esperando você religar.

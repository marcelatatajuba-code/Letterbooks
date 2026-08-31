-- ============================================================================
-- Letterbooks — esquema do banco
--
-- Rode este arquivo inteiro uma vez, no editor de SQL do Supabase
-- (Dashboard → SQL Editor → New query → cole tudo → Run).
-- É seguro rodar de novo: tudo usa "if not exists" ou "or replace".
--
-- A decisão que atravessa o arquivo: perfil e diário são PÚBLICOS para ler,
-- e só o dono escreve. Isso está nas políticas de RLS, não no aplicativo —
-- ou seja, vale mesmo que alguém chame a API por fora do site.
-- ============================================================================

-- ---------------------------------------------------------------- perfis ---
-- Um por conta. O "usuario" é o @ que aparece no endereço do perfil.

create table if not exists perfis (
  id         uuid primary key references auth.users on delete cascade,
  usuario    text unique not null
             check (usuario ~ '^[a-z0-9_]{3,20}$'),
  nome       text,
  bio        text,
  local      text,
  meta_ano   int  default extract(year from now()),
  meta_total int  default 12,
  criado_em  timestamptz not null default now()
);

comment on column perfis.usuario is
  'Minúsculas, números e _, de 3 a 20. É o endereço público do perfil.';

-- ---------------------------------------------------------------- livros ---
-- Cache compartilhado do acervo da Open Library. Não é dado de ninguém:
-- qualquer pessoa lê, e qualquer pessoa autenticada pode inserir um livro
-- que ainda não esteja aqui.

create table if not exists livros (
  chave       text primary key,          -- '/works/OL1917719W'
  titulo      text not null,
  autores     text[] default '{}',
  autores_ids text[] default '{}',
  ano         int,
  capa        text,
  capa_grande text,
  paginas     int,
  edicoes     int,
  assuntos    text[] default '{}',
  sinopse     text,
  visto_em    timestamptz not null default now()
);

-- -------------------------------------------------------------- leituras ---
-- O diário. Cada releitura é uma linha nova, como no original.

create table if not exists leituras (
  id        uuid primary key default gen_random_uuid(),
  perfil    uuid not null references perfis on delete cascade,
  livro     text not null references livros(chave),
  nota      numeric(2,1) check (nota is null or (nota >= 0.5 and nota <= 5.0)),
  resenha   text,
  lido_em   date not null default current_date,
  relido    boolean not null default false,
  spoiler   boolean not null default false,
  criado_em timestamptz not null default now()
);

-- O id que o APARELHO deu a esta leitura. É o que amarra a linha daqui à linha
-- de lá, e é o que faz a decisão de subir ser por ITEM, e não por aparelho.
--
-- Sem ele a migração era por aparelho (uma marca no localStorage) e isso
-- duplicava: quem migrava e depois editava uma resenha ganhava uma segunda
-- linha, porque o app não sabia que já tinha mandado aquela leitura.
--
-- Ele é PÚBLICO junto com o resto da linha (o diário é público por RLS), então
-- tem que continuar opaco — gerado no aparelho, sem nada derivado de e-mail ou
-- de perfil dentro. Não "melhore" este id.
alter table leituras add column if not exists cliente_id text;

comment on column leituras.cliente_id is
  'Id opaco gerado no aparelho. Publicamente legível: nunca derive de e-mail.';

-- Índice único parcial: o Postgres permite N nulos num índice único, e uma
-- linha sem cliente_id nunca colidiria. Com o "where not null" explícito fica
-- claro que linha antiga (sem id) fica de fora até o backfill passar.
create unique index if not exists leituras_cliente
  on leituras (perfil, cliente_id) where cliente_id is not null;

create index if not exists leituras_perfil_data on leituras (perfil, lido_em desc);
create index if not exists leituras_livro       on leituras (livro);
create index if not exists leituras_recentes    on leituras (criado_em desc);

-- ------------------------------------------------------------ marcadores ---
-- Quero ler, curtida e favorito numa tabela só: são a mesma forma.

create table if not exists marcadores (
  perfil    uuid not null references perfis on delete cascade,
  livro     text not null references livros(chave),
  tipo      text not null check (tipo in ('quero', 'curtida', 'favorito')),
  criado_em timestamptz not null default now(),
  primary key (perfil, livro, tipo)
);

create index if not exists marcadores_perfil on marcadores (perfil, tipo);

-- ---------------------------------------------------------------- listas ---

create table if not exists listas (
  id        uuid primary key default gen_random_uuid(),
  perfil    uuid not null references perfis on delete cascade,
  nome      text not null,
  descricao text,
  criado_em timestamptz not null default now()
);

-- Mesma coluna, mesmo motivo das leituras, e o mesmo defeito esperando do
-- outro lado: até esta linha existir, migrar mandava a lista com
-- return=representation mas NUNCA gravava o id de volta no aparelho — então a
-- primeira edição depois de migrar nascia como uma lista NOVA no servidor, e a
-- pessoa via a mesma lista duas vezes. É o D27 de novo, na outra tabela.
alter table listas add column if not exists cliente_id text;

comment on column listas.cliente_id is
  'Id opaco gerado no aparelho. Publicamente legível: nunca derive de e-mail.';

create unique index if not exists listas_cliente
  on listas (perfil, cliente_id) where cliente_id is not null;

create index if not exists listas_perfil on listas (perfil, criado_em desc);

create table if not exists lista_itens (
  lista  uuid not null references listas on delete cascade,
  livro  text not null references livros(chave),
  ordem  int  not null default 0,
  primary key (lista, livro)
);

-- ------------------------------------------------------------ seguidores ---

create table if not exists seguidores (
  seguidor  uuid not null references perfis on delete cascade,
  seguido   uuid not null references perfis on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (seguidor, seguido),
  check (seguidor <> seguido)
);

create index if not exists seguidores_seguido on seguidores (seguido);

-- --------------------------------------------------- curtidas e comentários -
-- Curtir e comentar são sobre uma LEITURA (a resenha de alguém), não sobre
-- o livro. É o que o original faz.

create table if not exists curtidas (
  perfil    uuid not null references perfis on delete cascade,
  leitura   uuid not null references leituras on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (perfil, leitura)
);

create index if not exists curtidas_leitura on curtidas (leitura);

create table if not exists comentarios (
  id        uuid primary key default gen_random_uuid(),
  leitura   uuid not null references leituras on delete cascade,
  perfil    uuid not null references perfis on delete cascade,
  texto     text not null check (length(trim(texto)) between 1 and 2000),
  criado_em timestamptz not null default now()
);

create index if not exists comentarios_leitura on comentarios (leitura, criado_em);

-- ------------------------------------------------------------- denúncias ---
-- Cadastro aberto exige uma porta de denúncia. Sem isso, não há moderação
-- possível — só apagar coisa na unha, no banco.

create table if not exists denuncias (
  id        uuid primary key default gen_random_uuid(),
  autor     uuid references perfis on delete set null,
  leitura   uuid references leituras on delete cascade,
  comentario uuid references comentarios on delete cascade,
  motivo    text not null,
  criado_em timestamptz not null default now(),
  check (leitura is not null or comentario is not null)
);

-- ============================================================================
-- RLS: quem pode ler e escrever o quê.
--
-- Sem estas políticas, o Supabase bloqueia TUDO por padrão. Com elas:
-- leitura pública, escrita só do dono. A regra vive no banco, então vale
-- mesmo para quem chamar a API direto, sem passar pelo site.
-- ============================================================================

alter table perfis      enable row level security;
alter table livros      enable row level security;
alter table leituras    enable row level security;
alter table marcadores  enable row level security;
alter table listas      enable row level security;
alter table lista_itens enable row level security;
alter table seguidores  enable row level security;
alter table curtidas    enable row level security;
alter table comentarios enable row level security;
alter table denuncias   enable row level security;

-- Recria as políticas do zero, para o arquivo poder rodar de novo sem erro.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('perfis','livros','leituras','marcadores','listas',
                         'lista_itens','seguidores','curtidas','comentarios',
                         'denuncias')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- --- perfis: todo mundo lê; cada um escreve o seu -------------------------
create policy "perfis são públicos"     on perfis for select using (true);
create policy "crio o meu perfil"       on perfis for insert with check (auth.uid() = id);
create policy "edito o meu perfil"      on perfis for update using (auth.uid() = id);
create policy "apago o meu perfil"      on perfis for delete using (auth.uid() = id);

-- --- livros: acervo comum -------------------------------------------------
create policy "livros são públicos"     on livros for select using (true);
create policy "quem entrou pode somar"  on livros for insert
  with check (auth.uid() is not null);
create policy "quem entrou pode somar dados" on livros for update
  using (auth.uid() is not null);

-- --- leituras: diário público, escrita do dono ---------------------------
create policy "diário é público"        on leituras for select using (true);
create policy "registro a minha"        on leituras for insert with check (auth.uid() = perfil);
create policy "edito a minha"           on leituras for update using (auth.uid() = perfil);
create policy "apago a minha"           on leituras for delete using (auth.uid() = perfil);

-- --- marcadores, listas, itens -------------------------------------------
create policy "marcadores são públicos" on marcadores for select using (true);
create policy "marco o meu"             on marcadores for insert with check (auth.uid() = perfil);
create policy "desmarco o meu"          on marcadores for delete using (auth.uid() = perfil);

create policy "listas são públicas"     on listas for select using (true);
create policy "crio lista minha"        on listas for insert with check (auth.uid() = perfil);
create policy "edito lista minha"       on listas for update using (auth.uid() = perfil);
create policy "apago lista minha"       on listas for delete using (auth.uid() = perfil);

create policy "itens são públicos"      on lista_itens for select using (true);
create policy "mexo na minha lista"     on lista_itens for all
  using (exists (select 1 from listas l where l.id = lista and l.perfil = auth.uid()))
  with check (exists (select 1 from listas l where l.id = lista and l.perfil = auth.uid()));

-- --- seguir ---------------------------------------------------------------
create policy "quem segue quem é público" on seguidores for select using (true);
create policy "eu sigo"                 on seguidores for insert with check (auth.uid() = seguidor);
create policy "eu deixo de seguir"      on seguidores for delete using (auth.uid() = seguidor);

-- --- curtidas e comentários ----------------------------------------------
create policy "curtidas são públicas"   on curtidas for select using (true);
create policy "eu curto"                on curtidas for insert with check (auth.uid() = perfil);
create policy "eu descurto"             on curtidas for delete using (auth.uid() = perfil);

create policy "comentários são públicos" on comentarios for select using (true);
create policy "eu comento"              on comentarios for insert with check (auth.uid() = perfil);
create policy "edito o meu comentário"  on comentarios for update using (auth.uid() = perfil);
-- Apagar comentário: o autor OU o dono da resenha onde ele está.
create policy "apago comentário meu ou na minha resenha" on comentarios for delete
  using (auth.uid() = perfil
         or exists (select 1 from leituras l where l.id = leitura and l.perfil = auth.uid()));

-- --- denúncias: escreve quem está logado, lê ninguém ----------------------
-- Você lê as denúncias pelo painel do Supabase, não pelo aplicativo.
create policy "posso denunciar"         on denuncias for insert
  with check (auth.uid() is not null);

-- ============================================================================
-- Backfill: dá cliente_id às leituras que subiram ANTES desta coluna existir.
--
-- Roda uma vez, e é seguro rodar de novo (só toca em quem está nulo). Casa por
-- (perfil, livro, lido_em). O caso ambíguo é a mesma obra lida DUAS VEZES NO
-- MESMO DIA: aí não há como saber qual linha de lá é qual daqui. A decisão,
-- travada aqui e provada em provar.sql: cada linha ganha um id próprio, e a
-- fusão no aparelho trata isso como leituras distintas. É melhor duas linhas
-- honestas do que uma fusão que apaga uma releitura.
-- ============================================================================

update leituras
   set cliente_id = 'srv-' || replace(id::text, '-', '')
 where cliente_id is null;

-- O mesmo para as listas que subiram na migração, antes desta coluna existir.
update listas
   set cliente_id = 'srv-' || replace(id::text, '-', '')
 where cliente_id is null;

-- ============================================================================
-- Feed: as leituras de quem eu sigo, mais as minhas, do mais novo ao mais
-- velho. Uma view economiza uma consulta com junção a cada abertura do app.
-- ============================================================================

-- security_invoker: sem isso a view roda com os poderes de quem a CRIOU (o
-- superusuário do painel), e o RLS das tabelas de baixo é ignorado. Hoje isso
-- não vazaria nada, porque leituras, perfis e livros já são públicos para
-- leitura. Mas no dia em que uma dessas políticas ficar mais restrita — um
-- diário privado, por exemplo — a view continuaria devolvendo tudo, e o
-- vazamento não estaria em lugar nenhum do código do aplicativo.
create or replace view feed
  with (security_invoker = on) as
  select l.*,
         p.usuario, p.nome as perfil_nome,
         li.titulo, li.autores, li.ano, li.capa,
         (select count(*) from curtidas c    where c.leitura = l.id) as curtidas,
         (select count(*) from comentarios m where m.leitura = l.id) as comentarios
    from leituras l
    join perfis  p  on p.id = l.perfil
    join livros  li on li.chave = l.livro
   order by l.criado_em desc;

-- O PostgREST fala com o banco como "anon" (visitante) ou "authenticated"
-- (quem entrou). Os privilégios padrão do Supabase já cobrem as tabelas, mas
-- ser explícito aqui evita o erro mais chato de diagnosticar: tudo certo no
-- esquema e o app recebendo lista vazia, sem mensagem de erro nenhuma.
grant select on feed to anon, authenticated;

-- ============================================================================
-- Avisos: quem curtiu, quem comentou e quem começou a seguir você.
--
-- VIEW, e não tabela — a decisão foi tomada olhando as três tabelas de origem:
-- curtidas.criado_em, comentarios.criado_em e seguidores.criado_em já são
-- `timestamptz not null default now()` desde o primeiro dia. Todo evento de
-- aviso JÁ está gravado, com hora de servidor. Uma tabela nova não guardaria
-- nenhum dado que o banco não tenha; guardaria só o estado de "lida" — e uma
-- marca d'água única no aparelho expressa isso, porque abrir a tela marca tudo
-- de uma vez. O que a tabela custaria: três gatilhos `security definer` (que
-- ignoram RLS por inteiro, a maior superfície nova que este esquema teria), a
-- primeira política de select não-pública, e grant por coluna para o dono não
-- reescrever `tipo`. Nada disso se paga por um estado que ninguém usa por item.
--
-- O `where destino = auth.uid()` fica DENTRO da view, e isto não é estilo: se
-- ficasse na query string do aplicativo, qualquer pessoa leria os avisos de
-- qualquer outra trocando um uuid em `?destino=eq.`. Nenhuma suíte da casa
-- veria — o Supabase de mentira não aplica RLS. Só provar-v3.sql pega.
--
-- security_invoker pelo mesmo motivo escrito acima para a `feed`: hoje as
-- tabelas de baixo são todas públicas para leitura e nada vazaria, mas no dia
-- em que o diário privado entrar, uma view "definer" continuaria devolvendo
-- tudo — e o vazamento não estaria em lugar nenhum do código do aplicativo.
--
-- Seguidores não tem chave primária de coluna única, então o id de cada linha
-- é sintético e textual. Ele serve para o aplicativo distinguir uma linha da
-- outra, nunca para apontar para uma tabela.
-- ============================================================================

create or replace view avisos
  with (security_invoker = on) as

  -- curtiram uma leitura sua
  select 'c:' || c.perfil || ':' || c.leitura as id,
         'curtida'::text  as tipo,
         c.criado_em      as criado_em,
         l.perfil         as destino,
         c.perfil         as quem,
         p.usuario, p.nome as quem_nome,
         l.id             as leitura,
         li.titulo,
         (l.resenha is not null and l.resenha <> '') as tem_resenha,
         l.livro          as livro
    from curtidas c
    join leituras l  on l.id = c.leitura
    join perfis   p  on p.id = c.perfil
    join livros   li on li.chave = l.livro
   where l.perfil = auth.uid()
     and c.perfil <> l.perfil          -- curtir a própria leitura não avisa

  union all

  -- comentaram numa leitura sua
  select 'm:' || m.id,
         'comentario',
         m.criado_em,
         l.perfil,
         m.perfil,
         p.usuario, p.nome,
         l.id,
         li.titulo,
         (l.resenha is not null and l.resenha <> ''),
         l.livro
    from comentarios m
    join leituras l  on l.id = m.leitura
    join perfis   p  on p.id = m.perfil
    join livros   li on li.chave = l.livro
   where l.perfil = auth.uid()
     and m.perfil <> l.perfil

  union all

  -- começaram a seguir você
  select 's:' || s.seguidor || ':' || s.seguido,
         'seguidor',
         s.criado_em,
         s.seguido,
         s.seguidor,
         p.usuario, p.nome,
         null::uuid,
         null::text,
         false,
         null::text
    from seguidores s
    join perfis p on p.id = s.seguidor
   where s.seguido = auth.uid();

-- Só quem entrou. Duas camadas, de propósito:
--   1. o `where destino = auth.uid()` já devolve zero linha para visitante,
--      porque auth.uid() é nulo sem sessão. Esta é a que realmente protege.
--   2. o revoke é explícito porque o Supabase concede privilégio nas tabelas
--      novas do schema public a anon e authenticated por padrão — um `grant`
--      sozinho não tira nada de ninguém, e ler o arquivo daria a impressão
--      errada de que tira.
revoke all on avisos from anon;
grant select on avisos to authenticated;

-- ============================================================================
-- Ao criar uma conta, criar o perfil junto — senão a pessoa entra e não
-- existe em lugar nenhum. O @ inicial sai do e-mail e ganha sufixo se
-- já estiver tomado.
-- ============================================================================

create or replace function criar_perfil_ao_cadastrar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  tentativa text;
  n int := 0;
begin
  base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then base := 'leitor'; end if;
  base := left(base, 16);
  tentativa := base;
  while exists (select 1 from perfis where usuario = tentativa) loop
    n := n + 1;
    tentativa := left(base, 16) || n::text;
  end loop;

  insert into perfis (id, usuario, nome)
  values (new.id, tentativa, coalesce(new.raw_user_meta_data->>'nome', tentativa));
  return new;
end $$;

drop trigger if exists ao_cadastrar on auth.users;
create trigger ao_cadastrar
  after insert on auth.users
  for each row execute function criar_perfil_ao_cadastrar();

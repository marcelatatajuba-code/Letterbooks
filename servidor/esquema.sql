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
-- Feed: as leituras de quem eu sigo, mais as minhas, do mais novo ao mais
-- velho. Uma view economiza uma consulta com junção a cada abertura do app.
-- ============================================================================

create or replace view feed as
  select l.*,
         p.usuario, p.nome as perfil_nome,
         li.titulo, li.autores, li.ano, li.capa,
         (select count(*) from curtidas c    where c.leitura = l.id) as curtidas,
         (select count(*) from comentarios m where m.leitura = l.id) as comentarios
    from leituras l
    join perfis  p  on p.id = l.perfil
    join livros  li on li.chave = l.livro
   order by l.criado_em desc;

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

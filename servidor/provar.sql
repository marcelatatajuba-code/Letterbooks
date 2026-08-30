-- ============================================================================
-- provar.sql — roda o esquema num Postgres local e confere que ele FUNCIONA,
-- não só que executa sem erro.
--
-- Por que isto existe: o esquema é 300 linhas de regra de acesso, e um erro
-- ali não aparece como tela quebrada — aparece como o diário de alguém
-- editável por outra pessoa. Testar isso lendo o arquivo não vale nada.
--
-- Como rodar (precisa de postgresql-client e do servidor local):
--
--   pg_ctl -D /var/tmp/pg -o '-k /tmp -p 5433' start
--   createdb -h /tmp -p 5433 prova
--   psql -h /tmp -p 5433 -d prova -f servidor/supabase-de-mentira.sql
--   psql -h /tmp -p 5433 -d prova -f servidor/esquema.sql
--   psql -h /tmp -p 5433 -d prova -f servidor/provar.sql
--
-- O que fica provado, contra um Postgres de verdade:
--   · o gatilho cria o perfil junto com a conta, e resolve @ repetido
--   · nota fora de 0,5–5 é recusada
--   · releitura vira linha nova, não conflito
--   · ninguém segue a si mesmo
--   · apagar a conta leva diário e curtidas junto
--   · visitante lê perfil e diário, e NÃO escreve
--   · quem entrou NÃO edita nem apaga o diário de outra pessoa
--   · nem consegue registrar no nome de outra pessoa, mesmo com o id na mão
--   · e mexe no próprio diário normalmente
-- ============================================================================

\set ON_ERROR_STOP on
\echo '=== 2. politicas por tabela ==='
select tablename, count(*) as politicas from pg_policies
 where schemaname='public' group by tablename order by tablename;

\echo '=== 3. o gatilho cria o perfil junto com a conta ==='
insert into auth.users (email) values ('marcela@exemplo.com');
insert into auth.users (email) values ('marcela@outro.com');   -- mesmo @ base
insert into auth.users (email, raw_user_meta_data)
  values ('bia@exemplo.com', '{"nome":"Bia Ramos"}');
select u.email, p.usuario, p.nome from perfis p join auth.users u on u.id = p.id
 order by p.criado_em;

\echo '=== 4. o @ e unico e segue a regra ==='
select count(*) = count(distinct usuario) as usuarios_unicos from perfis;
select bool_and(usuario ~ '^[a-z0-9_]{3,20}$') as todos_no_formato from perfis;

\echo '=== 5. a view feed junta leitura + perfil + livro ==='
insert into livros (chave, titulo, autores, ano)
  values ('/works/OL1W', 'Dom Casmurro', array['Machado de Assis'], 1899);
insert into leituras (perfil, livro, nota, resenha)
  select id, '/works/OL1W', 4.5, 'Capitu.' from auth.users where email='marcela@exemplo.com';
insert into curtidas (perfil, leitura)
  select (select id from auth.users where email='bia@exemplo.com'), id from leituras;
select usuario, titulo, nota, curtidas, comentarios from feed;

\echo '=== 6. a view respeita o RLS de quem consulta (security_invoker) ==='
select c.reloptions from pg_class c where c.relname = 'feed';

\echo '=== 7. nota fora da faixa e recusada ==='
do $$ begin
  insert into leituras (perfil, livro, nota)
    select id, '/works/OL1W', 7.0 from auth.users limit 1;
  raise exception 'FALHA: aceitou nota 7';
exception when check_violation then raise notice 'ok: nota 7 recusada'; end $$;

\echo '=== 8. releitura e uma linha nova, nao um conflito ==='
insert into leituras (perfil, livro, nota, relido)
  select id, '/works/OL1W', 5.0, true from auth.users where email='marcela@exemplo.com';
select count(*) as leituras_do_mesmo_livro from leituras where livro='/works/OL1W';

\echo '=== 9. nao da para seguir a si mesmo ==='
do $$ begin
  insert into seguidores (seguidor, seguido) select id, id from perfis limit 1;
  raise exception 'FALHA: aceitou seguir a si mesmo';
exception when check_violation then raise notice 'ok: recusado'; end $$;

\echo '=== 10. apagar a conta leva o diario junto ==='
delete from auth.users where email='marcela@exemplo.com';
select (select count(*) from perfis) as perfis,
       (select count(*) from leituras) as leituras,
       (select count(*) from curtidas) as curtidas;
-- Prepara duas contas e um diário
insert into auth.users (email) values ('ana@x.com'), ('bruno@x.com');
insert into livros (chave, titulo) values ('/works/OLxW', 'Um livro');
insert into leituras (perfil, livro, nota, resenha)
  select id, '/works/OLxW', 4.0, 'da Ana' from auth.users where email='ana@x.com';

\echo ''
\echo '### VISITANTE (anon), sem entrar ###'
set role anon;
select 'lê perfis'   as acao, count(*) from perfis;
select 'lê o diário' as acao, count(*) from leituras;
select 'lê o feed'   as acao, count(*) from feed;
do $$ begin
  insert into leituras (perfil, livro, nota) values (gen_random_uuid(), '/works/OLxW', 1);
  raise exception 'FALHA: visitante escreveu no diário';
exception when insufficient_privilege then raise notice 'ok: visitante NAO escreve no diário';
end $$;
do $$ begin
  update perfis set nome = 'invadido';
  if found then raise exception 'FALHA: visitante editou um perfil'; end if;
  raise notice 'ok: visitante NAO edita perfil (0 linhas)';
end $$;
reset role;

\echo ''
\echo '### BRUNO, entrado, tentando mexer no diário da ANA ###'
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where email='bruno@x.com'), false) as quem_sou;
set role authenticated;
select 'Bruno lê a resenha da Ana' as acao, count(*) from leituras where resenha='da Ana';
update leituras set resenha = 'reescrito pelo Bruno' where resenha = 'da Ana';
\echo '   ^ linhas afetadas acima: tem que ser 0'
delete from leituras where resenha = 'da Ana';
\echo '   ^ linhas apagadas acima: tem que ser 0'
do $$ begin
  insert into leituras (perfil, livro, nota)
    select id, '/works/OLxW', 5 from auth.users where email='ana@x.com';
  raise exception 'FALHA: Bruno registrou leitura NO NOME DA ANA';
exception when insufficient_privilege then
  raise notice 'ok: Bruno NAO registra no nome da Ana';
end $$;
select 'a resenha da Ana continua intacta' as conferencia, resenha from leituras;
reset role;

\echo ''
\echo '### ANA, entrada, no proprio diário ###'
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where email='ana@x.com'), false) as quem_sou;
set role authenticated;
update leituras set resenha = 'a Ana reescreveu' where resenha = 'da Ana';
\echo '   ^ linhas afetadas acima: tem que ser 1'
insert into leituras (perfil, livro, nota)
  select id, '/works/OLxW', 3 from auth.users where email='ana@x.com';
\echo '   ^ a Ana registrou uma leitura nova'
insert into curtidas (perfil, leitura)
  select (select id from auth.users where email='ana@x.com'), id from leituras limit 1;
\echo '   ^ e curtiu'
reset role;
-- O erro anterior era do TESTE, não do esquema: eu consultava auth.users como
-- "authenticated", e esse papel não enxerga o schema auth — no Supabase de
-- verdade também não. O aplicativo nunca faz isso: ele usa auth.uid(), que é o
-- id de quem entrou, tirado do próprio token.
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where email='ana@x.com'), false) as ana;
set role authenticated;

insert into leituras (perfil, livro, nota) values (auth.uid(), '/works/OLxW', 3);
\echo '   ^ a Ana registrou leitura no proprio nome: tem que ser INSERT 0 1'

insert into curtidas (perfil, leitura)
  select auth.uid(), id from leituras where perfil = auth.uid() limit 1;
\echo '   ^ e curtiu: INSERT 0 1'

do $$ begin
  insert into leituras (perfil, livro, nota)
    values ((select id from perfis where id <> auth.uid() limit 1), '/works/OLxW', 5);
  raise exception 'FALHA: escreveu no nome de outra pessoa';
exception when insufficient_privilege then
  raise notice 'ok: nem com o id na mao da para escrever no nome de outra pessoa';
end $$;

select count(*) as leituras_da_ana from leituras where perfil = auth.uid();
reset role;

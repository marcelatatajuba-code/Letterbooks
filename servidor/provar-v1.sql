-- ============================================================================
-- provar-v1.sql — prova a migração do cliente_id num Postgres de verdade.
--
-- Roda depois de supabase-de-mentira.sql e esquema.sql, no mesmo banco:
--   psql -h /tmp -p 5433 -d prova -f servidor/provar-v1.sql
--
-- O que fica provado:
--   1. o esquema com a coluna nova roda, e roda DE NOVO sem quebrar
--   2. leitura que subiu ANTES da coluna existir ganha id no backfill
--   3. reenviar o mesmo item ATUALIZA, não cria linha nova
--   4. o caso ambíguo — mesma obra, duas vezes no mesmo dia — vira duas
--      linhas honestas, e a releitura sobrevive
--   5. cliente_id de outra pessoa não colide com o meu (a unicidade é por
--      perfil, não global)
--   6. o RLS continua valendo com a coluna nova
-- ============================================================================

\set ON_ERROR_STOP on
\echo '=== 1. o esquema com a coluna nova roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente'

\echo ''
\echo '=== 2. cenario real: leitura que subiu ANTES da coluna existir ==='
insert into auth.users (email) values ('ana@x.com');
insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro'),
                                          ('/works/OL2W', 'A Hora da Estrela');
-- simula o estado de hoje: migrar() inseriu sem cliente_id
insert into leituras (perfil, livro, nota, resenha, lido_em, cliente_id)
  select id, '/works/OL1W', 4.0, 'da migracao', '2026-08-01', null from auth.users;
select count(*) filter (where cliente_id is null) as orfas_antes from leituras;

\echo '--- roda o backfill (que ja esta no esquema, mas a linha entrou depois) ---'
update leituras set cliente_id = 'srv-' || replace(id::text,'-','') where cliente_id is null;
select count(*) filter (where cliente_id is null) as orfas_depois from leituras;

\echo ''
\echo '=== 3. o upsert por cliente_id NAO duplica ao reenviar ==='
insert into leituras (perfil, livro, nota, resenha, lido_em, cliente_id)
  select id, '/works/OL2W', 5.0, 'primeira versao', '2026-08-20', 'mtabc123' from auth.users;
-- mesmo item, mandado de novo com a resenha corrigida
insert into leituras (perfil, livro, nota, resenha, lido_em, cliente_id)
  select id, '/works/OL2W', 4.5, 'resenha corrigida', '2026-08-20', 'mtabc123' from auth.users
  on conflict (perfil, cliente_id) where cliente_id is not null
  do update set nota = excluded.nota, resenha = excluded.resenha;
select livro, nota, resenha from leituras where cliente_id = 'mtabc123';
select count(*) as linhas_do_mesmo_item from leituras where cliente_id = 'mtabc123';

\echo ''
\echo '=== 4. o caso AMBIGUO: mesma obra, duas vezes no mesmo dia ==='
insert into leituras (perfil, livro, nota, lido_em, cliente_id, relido)
  select id, '/works/OL1W', 3.0, '2026-08-25', 'mtdup1', false from auth.users;
insert into leituras (perfil, livro, nota, lido_em, cliente_id, relido)
  select id, '/works/OL1W', 5.0, '2026-08-25', 'mtdup2', true from auth.users;
select count(*) as duas_leituras_no_mesmo_dia from leituras
 where livro='/works/OL1W' and lido_em='2026-08-25';
\echo '   ^ tem que ser 2: id proprio para cada, releitura preservada'

\echo ''
\echo '=== 5. cliente_id de OUTRA pessoa nao colide com o meu ==='
insert into auth.users (email) values ('bruno@x.com');
insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  select id, '/works/OL2W', 2.0, '2026-08-20', 'mtabc123' from auth.users where email='bruno@x.com';
select count(*) as mesmo_cliente_id_duas_pessoas from leituras where cliente_id='mtabc123';
\echo '   ^ tem que ser 2: a unicidade e por (perfil, cliente_id), nao global'

\echo ''
\echo '=== 6. o RLS continua valendo com a coluna nova ==='
select set_config('request.jwt.claim.sub',
  (select id::text from auth.users where email='bruno@x.com'), false) as bruno;
set role authenticated;
update leituras set resenha = 'invadido' where cliente_id = 'mtabc123' and resenha is not null;
\echo '   ^ linhas afetadas: tem que ser 0 (a da Ana nao e do Bruno)'
reset role;
select resenha from leituras where cliente_id='mtabc123' and resenha is not null;

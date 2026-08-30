-- ============================================================================
-- provar-v2.sql — prova a identidade das LISTAS num Postgres de verdade.
--
-- Roda depois de supabase-de-mentira.sql, no mesmo banco:
--   psql -h /tmp -p 5433 -d prova -f servidor/provar-v2.sql
--
-- POR QUE EXISTE. A migração mandava a lista para o servidor e nunca gravava o
-- id de volta no aparelho. Resultado: a primeira edição depois de migrar
-- nascia como uma lista NOVA lá, e a pessoa via a mesma lista duas vezes. É
-- exatamente o D27, que já tinha acontecido com as leituras — a mesma falha,
-- na outra tabela, esperando a segunda vez.
--
-- Nenhum mock prova PostgREST. Esta é a única verificação real desta metade.
--
-- O que fica provado:
--   1. o esquema com a coluna nova roda, e roda DE NOVO sem quebrar
--   2. lista que subiu ANTES da coluna existir ganha id no backfill
--   3. reenviar a mesma lista ATUALIZA, não cria uma segunda
--   4. o cliente_id de outra pessoa não colide com o meu
--   5. os ITENS: reenviar não duplica, e tirar um livro tira só ele
--   6. o RLS continua valendo — ninguém edita nem esvazia a lista alheia
--   7. apagar a lista leva os itens junto (on delete cascade)
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema com a coluna nova roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente'

\echo ''
\echo '=== 2. cenario real: lista que subiu ANTES da coluna existir ==='
insert into auth.users (email) values ('ana@x.com');
insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro'),
                                          ('/works/OL2W', 'A Hora da Estrela'),
                                          ('/works/OL3W', 'Vidas Secas');
-- simula o estado de hoje: migrarListas inseriu sem cliente_id
insert into listas (perfil, nome, descricao, cliente_id)
  select id, 'Brasileiros', 'os daqui', null from auth.users where email='ana@x.com';
select count(*) filter (where cliente_id is null) as orfas_antes from listas;

\echo '--- roda o backfill (a linha entrou depois do esquema passar) ---'
update listas set cliente_id = 'srv-' || replace(id::text,'-','') where cliente_id is null;
select count(*) filter (where cliente_id is null) as orfas_depois from listas;
\echo '   ^ tem que ser 0'

\echo ''
\echo '=== 3. o upsert por cliente_id NAO cria uma segunda lista ==='
insert into listas (perfil, nome, descricao, cliente_id)
  select id, 'Para reler', 'primeira versao', 'mtlist1' from auth.users where email='ana@x.com';
-- mesma lista, mandada de novo com o nome corrigido
insert into listas (perfil, nome, descricao, cliente_id)
  select id, 'Para reler em 2027', 'nome corrigido', 'mtlist1'
    from auth.users where email='ana@x.com'
  on conflict (perfil, cliente_id) where cliente_id is not null
  do update set nome = excluded.nome, descricao = excluded.descricao;
select nome, descricao from listas where cliente_id = 'mtlist1';
select count(*) as linhas_da_mesma_lista from listas where cliente_id = 'mtlist1';
\echo '   ^ tem que ser 1: a lista foi corrigida, nao duplicada'

\echo ''
\echo '=== 4. cliente_id de OUTRA pessoa nao colide com o meu ==='
insert into auth.users (email) values ('bruno@x.com');
insert into listas (perfil, nome, cliente_id)
  select id, 'Outra coisa', 'mtlist1' from auth.users where email='bruno@x.com';
select count(*) as mesmo_cliente_id_duas_pessoas from listas where cliente_id='mtlist1';
\echo '   ^ tem que ser 2: a unicidade e por (perfil, cliente_id), nao global'

\echo ''
\echo '=== 5. os itens: reenviar nao duplica, e tirar um tira so ele ==='
-- Resolvido cedo e guardado: mais abaixo o teste troca de papel, e ai
-- auth.users fica fora de alcance.
select (select id::text from auth.users where email='ana@x.com') as id_ana_cedo \gset
create temporary view minha_lista as
  select id from listas where perfil = :'id_ana_cedo' and cliente_id='mtlist1';

insert into lista_itens (lista, livro, ordem)
  select id, '/works/OL1W', 0 from minha_lista union all
  select id, '/works/OL2W', 1 from minha_lista;
-- a mesma subida acontecendo de novo (a fila reenvia o estado, nao o movimento)
insert into lista_itens (lista, livro, ordem)
  select id, '/works/OL1W', 0 from minha_lista union all
  select id, '/works/OL2W', 1 from minha_lista
  on conflict (lista, livro) do nothing;
select count(*) as itens_depois_de_reenviar from lista_itens
 where lista in (select id from minha_lista);
\echo '   ^ tem que ser 2: reenviar o mesmo estado nao duplica item'

-- agora a pessoa tira o OL2W e poe o OL3W. A subida manda o estado inteiro:
-- insere o que falta e apaga o que sobrou. Nesta ordem, de proposito — se a
-- rede cair no meio, a lista fica com um item a mais, nunca vazia.
insert into lista_itens (lista, livro, ordem)
  select id, '/works/OL3W', 1 from minha_lista
  on conflict (lista, livro) do nothing;
delete from lista_itens
 where lista in (select id from minha_lista)
   and livro not in ('/works/OL1W', '/works/OL3W');
select livro from lista_itens where lista in (select id from minha_lista) order by livro;
\echo '   ^ tem que ser OL1W e OL3W: o OL2W saiu, os outros ficaram'

\echo ''
\echo '=== 6. o RLS: ninguem edita nem esvazia a lista alheia ==='
-- Os ids saem ANTES de trocar de papel: `authenticated` nao le auth.users, e o
-- teste tem que medir o RLS das listas, nao a permissao de ler o esquema auth.
select (select id::text from auth.users where email='ana@x.com')   as id_ana,
       (select id::text from auth.users where email='bruno@x.com') as id_bruno \gset
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno;
set role authenticated;

update listas set nome = 'invadida'
 where cliente_id = 'mtlist1' and perfil = :'id_ana';
\echo '   ^ UPDATE 0: a lista da Ana nao e do Bruno'

delete from lista_itens
 where lista in (select id from listas where perfil = :'id_ana');
\echo '   ^ DELETE 0: nem os itens dela'

-- e a leitura continua publica, que e o que faz a lista alheia ter tela
select count(*) as listas_que_o_bruno_LE from listas;
\echo '   ^ maior que 0: lista e publica para leitura, por politica'
reset role;

select nome from listas where cliente_id='mtlist1' and perfil = :'id_ana';
\echo '   ^ continua "Para reler em 2027": nada foi invadido'
select count(*) as itens_da_ana_intactos from lista_itens
 where lista in (select id from minha_lista);
\echo '   ^ continua 2'

\echo ''
\echo '=== 7. apagar a lista leva os itens junto ==='
delete from listas where cliente_id='mtlist1' and perfil = :'id_ana';
select count(*) as itens_orfaos from lista_itens
 where lista not in (select id from listas);
\echo '   ^ tem que ser 0: on delete cascade'

\echo ''
\echo '=== fim: a identidade das listas esta provada contra um Postgres real ==='

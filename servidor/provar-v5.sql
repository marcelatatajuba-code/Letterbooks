-- ============================================================================
-- provar-v5.sql — prova que o esquema.sql roda num banco QUE JÁ EXISTE, com
-- dados dentro. É o único caminho que a pessoa dona do banco realmente faz.
--
--   psql -h /tmp -p 5433 -d prova5 -f servidor/provar-v5.sql
--
-- POR QUE EXISTE, e por que ele devia existir desde a primeira entrega:
-- as outras cinco provas começam todas de um banco VAZIO. Elas provam que o
-- esquema nasce certo. Nenhuma provava que ele ATUALIZA — e atualizar é a
-- única coisa que acontece no banco de verdade, que tem dados e tem a forma de
-- alguma entrega antiga.
--
-- O buraco cobrou duas vezes, as duas no banco dela e nenhuma aqui:
--   · o conferir.sql quebrou no banco que ele existe para diagnosticar,
--     porque mencionava uma coluna que ainda não existia;
--   · o esquema.sql parou com "cannot change name of view column usuario to
--     cliente_id", porque `create or replace view` não muda a lista de colunas
--     de uma view que já está lá — e a lista da `feed` muda sozinha, já que ela
--     começa com `l.*`.
--
-- COMO ELE FABRICA O "BANCO ANTIGO": rodando o esquema de hoje e DESFAZENDO o
-- que veio depois de junho. Assim a forma antiga não vira um arquivo parado no
-- repositório, envelhecendo em silêncio ao lado do que ele deveria vigiar.
--
-- O que fica provado:
--   1. o esquema de hoje roda sobre a forma de junho, COM dados dentro
--   2. e roda DE NOVO em cima do resultado
--   3. nenhuma linha se perdeu no caminho
--   4. o backfill de cliente_id alcançou as linhas antigas
--   5. tudo que a entrega nova promete existe no fim
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. monta a forma de JUNHO: esquema de hoje, menos o que veio depois =='
\i esquema.sql

drop view if exists avisos;
drop function if exists apagar_minha_conta();
-- a `feed` sai primeiro: ela depende de leituras.*, entao a coluna nao cai
-- enquanto ela estiver de pe
drop view if exists feed;
-- `cascade` porque as seis politicas novas dependem de `privado`, e em junho
-- elas nao existiam — derruba-las FAZ PARTE de voltar a forma antiga. O
-- esquema.sql recria todas as politicas do zero no bloco `do $$ ... drop
-- policy`, entao nada fica faltando no fim. Entre um ponto e outro as tabelas
-- ficam sem politica de select, o que so significa que o RLS nega tudo; os
-- inserts abaixo rodam como dono do banco e nao passam por RLS.
alter table perfis   drop column privado cascade;
alter table leituras drop column cliente_id;
alter table listas   drop column cliente_id;

-- e a `feed` de junho volta, com o mesmo `l.*` que causou o problema: naquela
-- epoca `l.*` nao tinha cliente_id, entao a coluna seguinte era `usuario`
create view feed with (security_invoker = on) as
  select l.*, p.usuario, p.nome as perfil_nome,
         li.titulo, li.autores, li.ano, li.capa,
         (select count(*) from curtidas c    where c.leitura = l.id) as curtidas,
         (select count(*) from comentarios m where m.leitura = l.id) as comentarios
    from leituras l
    join perfis  p  on p.id = l.perfil
    join livros  li on li.chave = l.livro
   order by l.criado_em desc;
grant select on feed to anon, authenticated;
\echo '   ok: o banco esta na forma de antes'

\echo ''
\echo '=== 2. e com DADOS dentro, que e o que faz esta prova valer =========='
insert into auth.users (email) values ('ana@x.com'), ('bruno@x.com');
select (select id::text from auth.users where email='ana@x.com')   as id_ana,
       (select id::text from auth.users where email='bruno@x.com') as id_bruno \gset

insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro'),
                                          ('/works/OL2W', 'Vidas Secas');
insert into leituras (id, perfil, livro, nota, resenha, lido_em) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'id_ana', '/works/OL1W', 5.0,
   'A resenha que ela escreveu em junho.', '2026-06-10'),
  ('aaaaaaaa-0000-0000-0000-000000000002', :'id_ana', '/works/OL2W', 4.0,
   null, '2026-06-12');
insert into marcadores (perfil, livro, tipo) values (:'id_ana', '/works/OL2W', 'quero');
insert into listas (id, perfil, nome) values
  ('cccccccc-0000-0000-0000-000000000001', :'id_ana', 'Lista de junho');
insert into lista_itens (lista, livro, ordem) values
  ('cccccccc-0000-0000-0000-000000000001', '/works/OL1W', 0);
insert into curtidas (perfil, leitura) values
  (:'id_bruno', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into comentarios (leitura, perfil, texto) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'id_bruno', 'Comentario de junho.');
insert into seguidores (seguidor, seguido) values (:'id_bruno', :'id_ana');

select (select count(*) from leituras)    as leituras,
       (select count(*) from listas)      as listas,
       (select count(*) from curtidas)    as curtidas,
       (select count(*) from comentarios) as comentarios;
\echo '   ^ 2, 1, 1, 1 — o diario de junho'

\echo ''
\echo '=== 3. AGORA ela cola o esquema.sql de hoje. Isto tem que passar. ====='
\i esquema.sql
\echo '   ok: o arquivo rodou inteiro sobre um banco que ja existia.'
\echo '     Antes do `drop view if exists feed`, ele parava AQUI com'
\echo '     "cannot change name of view column usuario to cliente_id" — e'
\echo '     parava DEPOIS de ter alterado as tabelas, deixando o banco pela'
\echo '     metade: colunas novas de pe e views velhas, sem nada avisando.'

\echo ''
\echo '=== 4. e roda DE NOVO, que e a promessa escrita no topo do arquivo ===='
\i esquema.sql
\echo '   ok: idempotente tambem sobre banco atualizado'

\echo ''
\echo '=== 5. nenhuma linha se perdeu no caminho ============================'
select (select count(*) from leituras)    as leituras,
       (select count(*) from listas)      as listas,
       (select count(*) from lista_itens) as itens,
       (select count(*) from marcadores)  as marcadores,
       (select count(*) from curtidas)    as curtidas,
       (select count(*) from comentarios) as comentarios,
       (select count(*) from seguidores)  as seguidores;
\echo '   ^ 2, 1, 1, 1, 1, 1, 1 — tudo que existia em junho continua aqui'
select resenha from leituras where id = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '   ^ e o texto e o mesmo, nao um texto novo com o mesmo id'

\echo ''
\echo '=== 6. o backfill alcancou as linhas antigas ========================='
select count(*) as leituras_sem_cliente_id from leituras where cliente_id is null;
\echo '   ^ 0 — senao o diario duplica ao descer para um aparelho novo, que e'
\echo '     o D27/D40 de novo, e esse ja custou dado de verdade duas vezes'
select count(*) as listas_sem_cliente_id from listas where cliente_id is null;
\echo '   ^ 0'
select count(*) = count(distinct cliente_id) as ids_distintos from leituras;
\echo '   ^ t: o backfill nao deu o mesmo id para duas linhas'

\echo ''
\echo '=== 7. e tudo que a entrega nova promete esta de pe =================='
select (select count(*) from information_schema.columns
         where table_name='perfis' and column_name='privado')            as col_privado,
       (select count(*) from information_schema.views
         where table_name='avisos')                                      as view_avisos,
       (select count(*) from information_schema.views
         where table_name='feed')                                        as view_feed,
       (select count(*) from pg_proc where proname='apagar_minha_conta') as rpc;
\echo '   ^ 1, 1, 1, 1'

-- A view precisa FUNCIONAR, nao so existir: uma view recriada com a lista de
-- colunas errada continua aparecendo no information_schema.
select count(*) as linhas_no_feed from feed;
\echo '   ^ 2: a feed recriada devolve as leituras de junho'
select cliente_id is not null as feed_tem_cliente_id from feed limit 1;
\echo '   ^ t: e agora carrega a coluna nova, que era justamente a que'
\echo '     o `create or replace` nao conseguia acrescentar'

\echo ''
\echo '=== fim: o caminho de ATUALIZAR esta provado, nao so o de nascer ====='

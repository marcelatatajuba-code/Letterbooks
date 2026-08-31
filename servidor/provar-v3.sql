-- ============================================================================
-- provar-v3.sql — prova a view `avisos` num Postgres de verdade.
--
--   psql -h /tmp -p 5433 -d prova -f servidor/provar-v3.sql
--
-- POR QUE EXISTE. A view carrega o `where destino = auth.uid()` dentro dela. Se
-- esse filtro escorregar para a query string do aplicativo um dia, qualquer
-- pessoa lê os avisos de qualquer outra trocando um uuid — e NENHUMA suíte da
-- casa veria, porque o Supabase de mentira não aplica RLS nenhuma. Isto aqui é
-- a única coisa no projeto que pega esse erro.
--
-- O que fica provado:
--   1. o esquema com a view roda, e roda DE NOVO sem quebrar
--   2. curtida, comentário e seguidora viram aviso para a pessoa certa
--   3. curtir e comentar a PRÓPRIA leitura não vira aviso
--   4. ninguém lê os avisos de outra pessoa, nem forçando o filtro
--   5. a view distingue leitura com resenha de leitura só com nota
--   6. seguidora não traz livro nem leitura
--   7. descurtir tira o aviso; recurtir traz de novo
--   8. apagar a leitura leva os avisos junto (vem de graça, é view)
--   9. visitante não vê nada — pelo filtro de dentro E pelo privilégio
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema com a view roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente'

\echo ''
\echo '=== 2. tres contas e o cenario ==='
insert into auth.users (email) values ('ana@x.com'), ('bruno@x.com'), ('carla@x.com');
select (select id::text from auth.users where email='ana@x.com')   as id_ana,
       (select id::text from auth.users where email='bruno@x.com') as id_bruno,
       (select id::text from auth.users where email='carla@x.com') as id_carla \gset

insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro'),
                                          ('/works/OL2W', 'Vidas Secas');

-- Ana tem duas leituras: uma COM resenha, outra so com nota
insert into leituras (id, perfil, livro, nota, resenha, lido_em, cliente_id) values
  ('11111111-1111-1111-1111-111111111111', :'id_ana', '/works/OL1W', 5.0,
   'Capitu me pegou.', '2026-08-20', 'a1'),
  ('22222222-2222-2222-2222-222222222222', :'id_ana', '/works/OL2W', 4.0,
   null, '2026-08-21', 'a2');
-- e o Bruno tem uma, para provar que os avisos dele nao vazam para ela
insert into leituras (id, perfil, livro, nota, lido_em, cliente_id) values
  ('33333333-3333-3333-3333-333333333333', :'id_bruno', '/works/OL1W', 3.0,
   '2026-08-22', 'b1');

-- Bruno curte e comenta a resenha da Ana; Carla curte a leitura sem resenha
insert into curtidas (perfil, leitura) values
  (:'id_bruno', '11111111-1111-1111-1111-111111111111'),
  (:'id_carla', '22222222-2222-2222-2222-222222222222');
insert into comentarios (leitura, perfil, texto) values
  ('11111111-1111-1111-1111-111111111111', :'id_bruno', 'Tambem quero ler.');
-- Carla passa a seguir a Ana
insert into seguidores (seguidor, seguido) values (:'id_carla', :'id_ana');
-- e a Ana curte e comenta a PROPRIA resenha: nao pode virar aviso
insert into curtidas (perfil, leitura) values
  (:'id_ana', '11111111-1111-1111-1111-111111111111');
insert into comentarios (leitura, perfil, texto) values
  ('11111111-1111-1111-1111-111111111111', :'id_ana', 'Nota minha.');
-- e alguem curte o Bruno, para o teste de vazamento ter o que vazar
insert into curtidas (perfil, leitura) values
  (:'id_carla', '33333333-3333-3333-3333-333333333333');

\echo ''
\echo '=== 3. a Ana ve os avisos DELA, e so os dela ==='
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana;
set role authenticated;
select tipo, usuario, titulo, tem_resenha from avisos order by tipo, usuario;
\echo '   ^ tem que ser 4 linhas: curtida/bruno, curtida/carla, comentario/bruno, seguidor/carla'
select count(*) as avisos_da_ana from avisos;
\echo '   ^ tem que ser 4 — a curtida e o comentario DELA MESMA ficaram de fora'

\echo ''
\echo '=== 4. o vazamento que so este arquivo pega ==='
select count(*) as avisos_do_bruno_vistos_pela_ana
  from avisos where destino = :'id_bruno';
\echo '   ^ tem que ser 0: o filtro esta DENTRO da view, forcar destino nao ajuda'

\echo ''
\echo '=== 5. leitura com resenha vs. leitura so com nota ==='
select usuario, titulo, tem_resenha from avisos
 where tipo = 'curtida' order by usuario;
\echo '   ^ bruno curtiu a que TEM resenha (t), carla curtiu a que so tem nota (f)'
\echo '     e a frase da tela muda por causa disso: "sua resenha" vs "seu registro"'

\echo ''
\echo '=== 6. seguidora nao tem livro nem leitura ==='
select tipo, usuario, leitura is null as sem_leitura, titulo is null as sem_titulo
  from avisos where tipo = 'seguidor';
\echo '   ^ os dois t: a linha da seguidora nao desenha capa'

\echo ''
\echo '=== 7. descurtir tira o aviso; recurtir traz de novo ==='
reset role;
delete from curtidas where perfil = :'id_bruno'
   and leitura = '11111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana2;
set role authenticated;
select count(*) as depois_de_descurtir from avisos where tipo='curtida';
\echo '   ^ 1: com view o aviso E o estado atual, nao um registro congelado.'
\echo '     DECISAO: recurtir avisa de novo. E honesto — a pessoa curtiu de novo.'
reset role;
insert into curtidas (perfil, leitura) values
  (:'id_bruno', '11111111-1111-1111-1111-111111111111');
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana3;
set role authenticated;
select count(*) as depois_de_recurtir from avisos where tipo='curtida';
\echo '   ^ volta a 2'

\echo ''
\echo '=== 8. apagar a leitura leva os avisos junto, de graca ==='
reset role;
delete from leituras where id = '11111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana4;
set role authenticated;
select count(*) as avisos_orfaos from avisos where leitura is not null
   and leitura not in (select id from leituras);
\echo '   ^ 0: a view le das tabelas vivas, entao aviso apontando para o nada'
\echo '     nao e um estado possivel. Com tabela seria preciso cascade e teste.'
select count(*) as sobraram from avisos;
\echo '   ^ 2: a curtida da carla na outra leitura, e a seguidora'

\echo ''
\echo '=== 9. visitante nao ve aviso nenhum, por DOIS motivos ==='
reset role;
-- LIMPAR A CLAIM antes de trocar de papel. set_config(..., false) e de SESSAO,
-- nao de transacao: sem isto o papel seguinte continuaria carregando o sub da
-- Ana e o teste mediria o proprio descuido em vez do comportamento. Ja tropecei
-- nisto uma vez montando o provar-v2.
select set_config('request.jwt.claim.sub', '', false) as sem_claim;

\echo '   (a) o filtro de DENTRO: sem sub, auth.uid() e nulo e nada casa'
set role authenticated;
select count(*) as sem_sessao_ve from avisos;
\echo '   ^ tem que ser 0 — e esta e a camada que realmente protege'
reset role;

\echo '   (b) e o privilegio: anon nem chega a rodar a consulta'
set role anon;
\set ON_ERROR_STOP off
select count(*) from avisos;
\set ON_ERROR_STOP on
\echo '   ^ tem que ser "permission denied for view avisos"'
reset role;

\echo ''
\echo '=== fim: a view de avisos esta provada contra um Postgres real ==='

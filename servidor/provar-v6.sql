-- ============================================================================
-- provar-v6.sql — prova as políticas de `denuncias` num Postgres de verdade.
--
--   psql -h /tmp -p 5433 -d prova6 -f servidor/provar-v6.sql
--
-- POR QUE EXISTE. O item "denunciar" foi vendido no backlog como "o caro já
-- foi feito no servidor: falta só a tela". Não era verdade. O servidor estava
-- a uma política de distância de RECUSAR exatamente a requisição que a tela
-- precisa fazer, e a política que existia deixava assinar denúncia no nome dos
-- outros. Nenhuma suíte de docs/ veria nem uma coisa nem outra: nenhuma delas
-- aplica RLS.
--
-- O que fica provado:
--   1. o esquema roda, e roda DE NOVO
--   2. quem está logado grava a PRÓPRIA denúncia
--   3. e NÃO grava uma assinada por outra pessoa — era o buraco de antes
--   4. o INSERT ... RETURNING funciona — e falhava sem a política de select
--   5. ninguém lê denúncia de terceiro, nem sendo o alvo dela
--   6. o check recusa denúncia que não aponta para nada
--   7. autor sem perfil é recusado pela chave estrangeira
--   8. a denúncia MORRE com a resenha denunciada — dívida declarada, travada
--   9. `motivo` aceita string vazia: a validação é da tela, e isso é um fato
--      sobre o banco, não uma opinião sobre a tela
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente'

\echo ''
\echo '=== 2. o cenario ==='
insert into auth.users (email) values ('ana@x.com'), ('bruno@x.com');
select (select id::text from auth.users where email='ana@x.com')   as id_ana,
       (select id::text from auth.users where email='bruno@x.com') as id_bruno \gset

insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro');
insert into leituras (id, perfil, livro, nota, resenha, lido_em, cliente_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'id_ana', '/works/OL1W', 5.0,
   'A resenha que o Bruno vai denunciar.', '2026-08-20', 'a1');
insert into comentarios (id, leitura, perfil, texto) values
  ('dddddddd-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', :'id_ana', 'Comentario da Ana.');

\echo ''
\echo '=== 3. o Bruno denuncia a resenha da Ana, e isto tem que PASSAR ==='
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno;
set role authenticated;
insert into denuncias (autor, leitura, motivo)
  values (:'id_bruno', 'aaaaaaaa-0000-0000-0000-000000000001', 'ataque');
\echo '   ^ INSERT 0 1'

\echo ''
\echo '=== 4. O BURACO DE ANTES: denuncia assinada por OUTRA pessoa ==='
\echo '    Antes desta entrega a politica era `auth.uid() is not null`, que nao'
\echo '    olhava o corpo do POST: o Bruno gravava com o uuid da Ana e quem'
\echo '    fosse moderar julgaria a Ana. Medido antes de trocar.'
\set ON_ERROR_STOP off
insert into denuncias (autor, leitura, motivo)
  values (:'id_ana', 'aaaaaaaa-0000-0000-0000-000000000001', 'ataque');
\set ON_ERROR_STOP on
\echo '   ^ tem que ser "new row violates row-level security policy"'
reset role;
select count(*) as denuncias_assinadas_pela_ana from denuncias where autor = :'id_ana';
\echo '   ^ 0: a forja nao entrou'

\echo ''
\echo '=== 5. o INSERT ... RETURNING, que e como o PostgREST devolve a linha =='
\echo '    Sem a politica de select ele NAO falha "sem devolver": ele REVERTE o'
\echo '    insert inteiro, com 42501, que o navegador recebe como 403 — a'
\echo '    denuncia se perde com cara de erro de servidor.'
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno2;
set role authenticated;
insert into denuncias (autor, comentario, motivo)
  values (:'id_bruno', 'dddddddd-0000-0000-0000-000000000001', 'spam')
  returning motivo, comentario is not null as e_de_comentario;
\echo '   ^ a linha VOLTOU. E so por isso a tela pode dizer "registrada" sem'
\echo '     estar escrevendo "salvo" por cima de coisa nenhuma (o D65).'

\echo ''
\echo '=== 6. ninguem le denuncia de terceiro ==='
select count(*) as o_bruno_ve_as_dele from denuncias;
\echo '   ^ 2: as duas que ele mesmo fez'
reset role;
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana;
set role authenticated;
select count(*) as a_ana_ve_as_denuncias_contra_ela from denuncias;
\echo '   ^ 0 — e ela e o ALVO das duas. Ser denunciada nao da direito de ver'
\echo '     quem denunciou: isso viraria retaliacao.'
reset role;

\echo ''
\echo '=== 7. denuncia que nao aponta para nada e recusada ==='
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno3;
set role authenticated;
\set ON_ERROR_STOP off
insert into denuncias (autor, motivo) values (:'id_bruno', 'ataque');
\set ON_ERROR_STOP on
\echo '   ^ tem que ser "violates check constraint denuncias_check"'

\echo ''
\echo '=== 8. conta viva SEM PERFIL nao consegue denunciar ==='
\echo '    Nao e hipotese: conta sem perfil e o caminho NORMAL de quem apagou'
\echo '    a conta e entrou de novo com o mesmo e-mail.'
\echo ''
\echo '    A primeira versao desta secao mandava um uuid inventado no `autor`'
\echo '    e dava erro — mas dava erro de RLS, porque o uuid nao era o de quem'
\echo '    chamava. Ela passava verde sem NUNCA chegar na chave estrangeira,'
\echo '    que era o que ela dizia medir. Agora quem denuncia E a dona da'
\echo '    sessao; o que falta e o perfil dela.'
reset role;
insert into auth.users (email) values ('semperfil@x.com');
select (select id::text from auth.users where email='semperfil@x.com') as id_sp \gset
delete from perfis where id = :'id_sp';   -- o gatilho tinha criado; simula o estado
select count(*) as perfil_dela from perfis where id = :'id_sp';
\echo '   ^ 0: a conta existe, o perfil nao'
select set_config('request.jwt.claim.sub', :'id_sp', false) as sem_perfil;
set role authenticated;
\set ON_ERROR_STOP off
insert into denuncias (autor, leitura, motivo)
  values (:'id_sp', 'aaaaaaaa-0000-0000-0000-000000000001', 'spam');
\set ON_ERROR_STOP on
\echo '   ^ tem que ser violacao de chave estrangeira em denuncias_autor_fkey:'
\echo '     a RLS passou (o autor E ela), e quem recusa e a FK. Por isso a'
\echo '     folha da tela precisa mandar essa pessoa para #/conta em vez de'
\echo '     mostrar o codigo 23503 cru.'
reset role;
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno4;
set role authenticated;

\echo ''
\echo '=== 9. `motivo` aceita string vazia. E um FATO sobre o banco. ==='
insert into denuncias (autor, leitura, motivo)
  values (:'id_bruno', 'aaaaaaaa-0000-0000-0000-000000000001', '');
\echo '   ^ INSERT 0 1: o banco NAO valida motivo. Quem valida e a tela, e por'
\echo '     isso a folha nao deixa enviar sem escolher. Escrito aqui para'
\echo '     ninguem supor que o `not null` cobre isso — ele nao cobre.'

\echo ''
\echo '    E de quebra: NAO existe politica de delete em denuncias, entao nem'
\echo '    quem denunciou desfaz. Descobri isto aqui mesmo — a limpeza abaixo'
\echo '    nao apagava nada e a contagem da secao 10 vinha 2 em vez de 1, sem'
\echo '    ninguem notar. Denuncia nao se desfaz, e isso e proposital: se'
\echo '    desse, bastaria pressionar quem denunciou para ela apagar.'
delete from denuncias where motivo = '';
select count(*) as motivo_vazio_sobrou from denuncias where motivo = '';
\echo '   ^ 1: o delete afetou zero linhas, em silencio'
reset role;

\echo ''
\echo '=== 10. A DIVIDA DECLARADA: a denuncia morre com a resenha ==='
\echo '    Fluxo de abuso inteiro: escreve, e denunciada, apaga, reescreve — e'
\echo '    nada registra a reincidencia.'
select count(*) as denuncias_antes from denuncias
 where leitura = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '   ^ 2: a de motivo `ataque` e a de motivo vazio que nao deu para apagar'
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana2;
set role authenticated;
delete from leituras where id = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '   ^ a Ana apagou a propria resenha, que e direito dela'
reset role;
select count(*) as denuncias_depois from denuncias
 where leitura = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '   ^ 0. Esta assercao NAO diz que o comportamento e bom: ela TRAVA o'
\echo '     comportamento atual, para que trocar por `on delete set null` sem'
\echo '     ler o esquema.sql quebre aqui. Aquela troca faz um UPDATE que'
\echo '     reavalia o check e IMPEDE a pessoa de apagar a propria resenha —'
\echo '     um vetor de abuso novo, criado pelo conserto do abuso.'

\echo ''
\echo '=== fim: as politicas de denuncias estao provadas num Postgres real ==='

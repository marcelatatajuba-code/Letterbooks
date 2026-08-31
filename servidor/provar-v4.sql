-- ============================================================================
-- provar-v4.sql — prova a CHAVE DE PRIVACIDADE do diário num Postgres de
-- verdade, uma asserção por porta.
--
--   psql -h /tmp -p 5433 -d prova4 -f servidor/provar-v4.sql
--
-- POR QUE EXISTE, e por que ele é a verificação PRINCIPAL deste item e não um
-- extra: nenhuma das cinco suítes de docs/ aplica RLS. O Supabase de mentira
-- filtra só o que a query string pede. Uma política escrita errado passa
-- VERDE nas cinco, e o resultado não é "não funcionou" — é "funcionou na tela
-- e vazou na API", que é a forma exata do defeito que o comentário da view
-- `feed` previu três entregas atrás.
--
-- A CONTA QUE MOTIVA O ARQUIVO. O diário sai por SEIS portas, não uma:
-- leituras, marcadores, listas, lista_itens, curtidas e comentarios. As duas
-- views (`feed`, `avisos`) NÃO são portas próprias — são `security_invoker` e
-- herdam o RLS de baixo. Respeitar `privado` só em `leituras` deixaria CINCO
-- superfícies abertas por `?perfil=eq.<uuid>`; respeitar só em `perfis`
-- deixaria todas as seis abertas E quebraria os avisos em silêncio.
--
-- O que fica provado:
--   1. o esquema com a coluna e as seis políticas roda, e roda DE NOVO
--   2. `default false`: ninguém perde nada no dia em que a coluna aparece
--   PORTAS 1 a 6 — o conteúdo some para terceiro e continua inteiro para o dono
--   PORTA 7 — a view `feed`, e o quinto consumidor dela (o link de resenha)
--   PORTA 8 — a view `avisos` NÃO quebra: aviso de gente privada continua
--             chegando. É a asserção que pega quem mover o predicado
--   PORTAS 9 e 10 — perfis e seguidores continuam públicos, DE PROPÓSITO
--   11. visitante (anon) não vê nada de quem fechou o diário
--   12. desligar a chave devolve tudo — a privacidade é estado, não destruição
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema com a chave roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente'

\echo ''
\echo '=== 2. o cenario: Ana publica, Bruno PRIVADO, Carla olhando ==='
insert into auth.users (email) values ('ana@x.com'), ('bruno@x.com'), ('carla@x.com');
select (select id::text from auth.users where email='ana@x.com')   as id_ana,
       (select id::text from auth.users where email='bruno@x.com') as id_bruno,
       (select id::text from auth.users where email='carla@x.com') as id_carla \gset

insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro'),
                                          ('/works/OL2W', 'Vidas Secas'),
                                          ('/works/OL3W', 'A Hora da Estrela');

-- Ana: uma leitura publica, que o Bruno curte e comenta
insert into leituras (id, perfil, livro, nota, resenha, lido_em, cliente_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'id_ana', '/works/OL1W', 5.0,
   'Capitu me pegou.', '2026-08-20', 'a1');

-- Bruno: duas leituras, estante, lista com itens, e uma curtida na Ana
insert into leituras (id, perfil, livro, nota, resenha, lido_em, cliente_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', :'id_bruno', '/works/OL1W', 4.0,
   'Nao gostei do final.', '2026-08-21', 'b1'),
  ('bbbbbbbb-0000-0000-0000-000000000002', :'id_bruno', '/works/OL2W', 3.0,
   null, '2026-08-22', 'b2');
insert into marcadores (perfil, livro, tipo) values
  (:'id_bruno', '/works/OL3W', 'quero'),
  (:'id_bruno', '/works/OL1W', 'favorito');
insert into listas (id, perfil, nome, cliente_id) values
  ('cccccccc-0000-0000-0000-000000000001', :'id_bruno', 'Os que me marcaram', 'l1');
insert into lista_itens (lista, livro, ordem) values
  ('cccccccc-0000-0000-0000-000000000001', '/works/OL1W', 0),
  ('cccccccc-0000-0000-0000-000000000001', '/works/OL2W', 1);

-- as curtidas e os comentarios, dos dois lados
insert into curtidas (perfil, leitura) values
  (:'id_bruno', 'aaaaaaaa-0000-0000-0000-000000000001'),   -- Bruno curte a Ana
  (:'id_carla', 'aaaaaaaa-0000-0000-0000-000000000001'),   -- Carla curte a Ana
  (:'id_carla', 'bbbbbbbb-0000-0000-0000-000000000001');   -- Carla curte o Bruno
insert into comentarios (leitura, perfil, texto) values
  ('aaaaaaaa-0000-0000-0000-000000000001', :'id_bruno', 'Tambem quero ler.'),
  -- DOIS comentarios na leitura do Bruno, e a diferenca entre eles e o teste:
  -- um da Carla (que e quem vai olhar) e um da Ana (terceiro). Se a leitura
  -- privada so tivesse o comentario de quem olha, a PORTA 6 mediria o proprio
  -- descuido: a pessoa enxergaria o texto pela metade `perfil = auth.uid()` do
  -- predicado e o vazamento de verdade — a prosa dos OUTROS — passaria verde.
  ('bbbbbbbb-0000-0000-0000-000000000001', :'id_carla', 'Discordo do final.'),
  ('bbbbbbbb-0000-0000-0000-000000000001', :'id_ana',   'Eu li outra coisa.');
insert into seguidores (seguidor, seguido) values
  (:'id_bruno', :'id_ana'), (:'id_carla', :'id_bruno');

\echo '--- com a chave DESLIGADA (default false), a Carla ve tudo do Bruno ---'
select set_config('request.jwt.claim.sub', :'id_carla', false) as carla;
set role authenticated;
select (select count(*) from leituras    where perfil = :'id_bruno') as leituras,
       (select count(*) from marcadores  where perfil = :'id_bruno') as marcadores,
       (select count(*) from listas      where perfil = :'id_bruno') as listas,
       (select count(*) from feed        where perfil = :'id_bruno') as no_feed;
\echo '   ^ 2, 2, 1, 2 — `default false` nao tira nada de ninguem'
reset role;

\echo ''
\echo '=== 3. o Bruno fecha o diario ==='
update perfis set privado = true where id = :'id_bruno';

\echo ''
\echo '=== PORTA 1 — leituras. A que NAO tem tela: so a API le por aqui. ==='
select set_config('request.jwt.claim.sub', :'id_carla', false) as carla2;
set role authenticated;
select count(*) as leituras_do_bruno_vistas_pela_carla
  from leituras where perfil = :'id_bruno';
\echo '   ^ 0'
select count(*) as leituras_da_ana_intactas from leituras where perfil = :'id_ana';
\echo '   ^ 1: fechar o diario do Bruno nao mexeu no da Ana'

\echo ''
\echo '=== PORTA 2 — marcadores. A porta que se esquece: a estante alheia ==='
\echo '    nao tem tela nenhuma no app, entao ninguem pensa nela. A API tem. ==='
select count(*) as estante_do_bruno from marcadores where perfil = :'id_bruno';
\echo '   ^ 0'

\echo ''
\echo '=== PORTA 3 — listas ==='
select count(*) as listas_do_bruno from listas where perfil = :'id_bruno';
\echo '   ^ 0'

\echo ''
\echo '=== PORTA 4 — lista_itens, que herda a decisao da lista ==='
select count(*) as itens_do_bruno from lista_itens
 where lista = 'cccccccc-0000-0000-0000-000000000001';
\echo '   ^ 0: a subconsulta da politica sofre o RLS de `listas`, entao os'
\echo '     itens fecham sem repetir a regra da privacidade'

\echo ''
\echo '=== PORTA 5 — curtidas. Nao e so o par (perfil, leitura): e por aqui ==='
\echo '    que se enumera o uuid de uma leitura privada. ==='
select count(*) as curtidas_em_leitura_privada from curtidas
 where leitura = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '   ^ 0 — e a Carla e quem tinha curtido: nem quem curtiu ve, porque'
\echo '     a leitura por baixo sumiu'
select count(*) as curtidas_na_ana from curtidas
 where leitura = 'aaaaaaaa-0000-0000-0000-000000000001';
\echo '   ^ 2: a leitura da Ana e publica, inclusive a curtida do Bruno privado.'
\echo '     A chave fecha o diario DELE, nao o rastro dele no diario dos outros.'

\echo ''
\echo '=== PORTA 6 — comentarios: prosa de terceiro pendurada numa leitura ==='
select count(*) as comentarios_de_TERCEIROS_em_leitura_privada
  from comentarios
 where leitura = 'bbbbbbbb-0000-0000-0000-000000000001'
   and perfil <> :'id_carla';
\echo '   ^ 0: o comentario da Ana na leitura fechada do Bruno sumiu para a'
\echo '     Carla. E ESTE o vazamento — prosa de terceiro pendurada num diario'
\echo '     privado, endereçavel por `?leitura=eq.<uuid>`.'
select count(*) as meu_proprio_comentario from comentarios
 where leitura = 'bbbbbbbb-0000-0000-0000-000000000001'
   and perfil = :'id_carla';
\echo '   ^ 1, e de proposito: a primeira metade do predicado devolve o proprio'
\echo '     texto a quem escreveu. Fechar o diario alheio nao apaga a fala de'
\echo '     ninguem, e nao revela nada novo a quem ja escreveu ali.'

\echo ''
\echo '=== PORTA 7 — a view `feed`, e os CINCO consumidores dela ==='
select count(*) as bruno_no_feed from feed where perfil = :'id_bruno';
\echo '   ^ 0: a view e security_invoker, entao ela nao e uma porta propria —'
\echo '     herda o RLS de leituras. Isto cobre feed, feedGeral, leiturasDe,'
\echo '     leiturasDoLivro E o quinto, que nao aparece em grep por nome de'
\echo '     funcao: o `publico("feed","?select=*&id=eq.")` do link de resenha.'
select count(*) as link_de_resenha_privada from feed
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '   ^ 0: um link de resenha compartilhado antes para de abrir. De'
\echo '     proposito — mas a tela tem que dizer "privado", nao "apagada".'
select count(*) as feed_da_ana from feed where perfil = :'id_ana';
\echo '   ^ 1'
select curtidas, comentarios from feed where perfil = :'id_ana';
\echo '   ^ 2 e 1: as subconsultas de contagem da view tambem rodam sob o RLS'
\echo '     do invocador, e a leitura da Ana e publica, entao contam certo'

\echo ''
\echo '=== PORTA 8 — a `avisos` NAO pode quebrar. Esta e a assercao que pega ==='
\echo '    quem "melhorar" isto pondo o predicado em perfis. ==='
reset role;
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana;
set role authenticated;
select tipo, quem = :'id_bruno' as veio_do_bruno from avisos order by tipo;
\echo '   ^ tem que ter curtida E comentario vindos do Bruno PRIVADO.'
\echo '     A view e INNER JOIN em perfis: se o predicado morasse la, estas'
\echo '     duas linhas sumiriam sem erro, sem log e sem teste vermelho.'
select count(*) as avisos_da_ana from avisos;
\echo '   ^ 4: curtida do Bruno, curtida da Carla, comentario do Bruno e o'
\echo '     Bruno tendo comecado a seguir a Ana — TODOS os tres tipos de aviso'
\echo '     atravessam a privacidade de quem os gerou, que e o ponto.'

\echo ''
\echo '=== PORTAS 9 e 10 — perfis e seguidores continuam PUBLICOS, de proposito ==='
select count(*) as perfil_do_bruno_ainda_achavel from perfis where id = :'id_bruno';
\echo '   ^ 1: diario privado nao e perfil invisivel. O cartao (nome, @, bio)'
\echo '     continua achavel pelo @ — senao a `avisos` e a `feed`, que sao'
\echo '     INNER JOIN em perfis, fariam a pessoa sumir de telas onde so o'
\echo '     nome dela apareceria. Quem quer sumir do indice apaga a conta.'
select count(*) as seguidores_publicos from seguidores where seguido = :'id_bruno';
\echo '   ^ 1: quem segue quem continua publico. Seguir nao e conteudo.'

\echo ''
\echo '=== 4. o DONO continua vendo o diario dele inteiro ==='
reset role;
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno;
set role authenticated;
select (select count(*) from leituras    where perfil = :'id_bruno') as leituras,
       (select count(*) from marcadores  where perfil = :'id_bruno') as marcadores,
       (select count(*) from listas      where perfil = :'id_bruno') as listas,
       (select count(*) from lista_itens
         where lista = 'cccccccc-0000-0000-0000-000000000001')       as itens,
       (select count(*) from feed        where perfil = :'id_bruno') as no_feed;
\echo '   ^ 2, 2, 1, 2, 2 — tudo. Privacidade e sobre terceiros; fechar o'
\echo '     diario e nao poder mais ler o proprio diario seria um defeito.'
select count(*) as curtidas_que_recebi from curtidas
 where leitura in (select id from leituras where perfil = :'id_bruno');
\echo '   ^ 1: ele continua vendo quem curtiu a leitura fechada dele'

\echo ''
\echo '=== 11. visitante (anon) nao ve nada de quem fechou o diario ==='
reset role;
select set_config('request.jwt.claim.sub', '', false) as sem_claim;
set role anon;
select (select count(*) from leituras    where perfil = :'id_bruno') as leituras,
       (select count(*) from marcadores  where perfil = :'id_bruno') as marcadores,
       (select count(*) from listas      where perfil = :'id_bruno') as listas,
       (select count(*) from feed        where perfil = :'id_bruno') as no_feed;
\echo '   ^ 0, 0, 0, 0. Atencao ao motivo: sem sessao auth.uid() e NULO, entao'
\echo '     `perfil = auth.uid()` e nulo — e a primeira metade do predicado nao'
\echo '     salva ninguem. Quem protege aqui e o `not exists`.'
select count(*) as ana_ainda_publica_para_visitante from feed where perfil = :'id_ana';
\echo '   ^ 1: o app continua abrindo sem conta para o resto do acervo'
reset role;

\echo ''
\echo '=== 12. desligar a chave devolve tudo ==='
update perfis set privado = false where id = :'id_bruno';
select set_config('request.jwt.claim.sub', :'id_carla', false) as carla3;
set role authenticated;
select (select count(*) from leituras where perfil = :'id_bruno') as leituras,
       (select count(*) from listas   where perfil = :'id_bruno') as listas,
       (select count(*) from feed     where perfil = :'id_bruno') as no_feed;
\echo '   ^ 2, 1, 2 — de volta. A chave e ESTADO, nao destruicao: nada foi'
\echo '     apagado enquanto ela esteve ligada. Quem quer destruir apaga a'
\echo '     conta, que e a outra metade deste item.'
reset role;

\echo ''
\echo '=========================================================================='
\echo ' APAGAR A CONTA — a outra metade do item.'
\echo ''
\echo ' provar.sql ja provava `delete from auth.users`, que e a raiz que o app'
\echo ' NAO tem: nenhuma chave anon alcanca o schema auth. O que se prova aqui'
\echo ' e a raiz que o app REALMENTE usa — a funcao — e o cascateamento a'
\echo ' partir dela. Sem isto, "apagar a conta" e uma promessa nao verificada.'
\echo '=========================================================================='

\echo ''
\echo '=== 13. a Carla apaga a conta com a chave anon e o proprio JWT ==='
select (select count(*) from auth.users)  as contas,
       (select count(*) from perfis)      as perfis,
       (select count(*) from leituras)    as leituras,
       (select count(*) from comentarios) as comentarios,
       (select count(*) from curtidas)    as curtidas,
       (select count(*) from seguidores)  as seguidores;
\echo '   ^ o estado ANTES'

select set_config('request.jwt.claim.sub', :'id_carla', false) as carla4;
set role authenticated;
select apagar_minha_conta();
reset role;

select (select count(*) from auth.users where id = :'id_carla')     as conta,
       (select count(*) from perfis   where id = :'id_carla')       as perfil,
       (select count(*) from curtidas where perfil = :'id_carla')   as curtidas,
       (select count(*) from comentarios where perfil = :'id_carla') as comentarios,
       (select count(*) from seguidores
         where seguidor = :'id_carla' or seguido = :'id_carla')     as seguidores;
\echo '   ^ 0, 0, 0, 0, 0 — e a PRIMEIRA coluna e a que importa: a linha de'
\echo '     auth.users foi junto. E-mail e hash de senha inclusive. Sem'
\echo '     service_role em lugar nenhum: `security definer` roda como dono do'
\echo '     banco, e a chave anon so precisa do JWT da propria pessoa.'
\echo '     Uma tela que diz "conta apagada" agora esta dizendo a verdade.'

select count(*) as comentario_da_carla_na_leitura_do_bruno from comentarios
 where leitura = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '   ^ 1: sobrou so o da Ana. O comentario que a Carla escreveu na resenha'
\echo '     de OUTRA pessoa foi junto — e este e o efeito colateral que ninguem'
\echo '     espera, entao a folha de confirmacao tem que dize-lo em voz alta.'

select count(*) as leituras_do_bruno_intactas from leituras where perfil = :'id_bruno';
\echo '   ^ 2: apagar a propria conta nao encosta no diario de mais ninguem'

\echo ''
\echo '=== 14. a funcao nao apaga a conta de outra pessoa. Nao ha como pedir. ==='
\echo '   Ela tem ZERO argumentos: quem chama so consegue dizer "apague a mim".'
select count(*) as argumentos from information_schema.parameters
 where specific_name in (select specific_name from information_schema.routines
                          where routine_name = 'apagar_minha_conta');
\echo '   ^ 0. Nao e uma checagem de permissao que alguem possa esquecer de'
\echo '     escrever um dia: e a ausencia de um parametro para forjar.'

\echo ''
\echo '=== 15. visitante nem chega a rodar a funcao ==='
select set_config('request.jwt.claim.sub', '', false) as sem_claim2;
set role anon;
\set ON_ERROR_STOP off
select apagar_minha_conta();
\set ON_ERROR_STOP on
\echo '   ^ tem que ser "permission denied for function apagar_minha_conta":'
\echo '     o revoke recusa no privilegio, antes de a primeira linha do corpo'
\echo '     rodar. O `if auth.uid() is null` la dentro e a segunda camada.'
reset role;

\echo ''
\echo '=== 16. o Bruno nao apaga o perfil da Ana pela porta do PostgREST ==='
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno2;
set role authenticated;
delete from perfis where id = :'id_ana';
\echo '   ^ DELETE 0: a politica "apago o meu perfil" e `auth.uid() = id`'
reset role;
select count(*) as ana_intacta from perfis where id = :'id_ana';
\echo '   ^ 1'

\echo ''
\echo '=== fim: a chave de privacidade E o apagar a conta estao provados ==='

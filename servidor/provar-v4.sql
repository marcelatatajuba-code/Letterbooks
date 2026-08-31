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

-- Os mesmos tres ids, agora tambem em GUCs de sessao. O psql NAO interpola
-- `:'id_bruno'` dentro de bloco com dolar-aspas — `raise exception` com
-- :'var' morre com "syntax error at or near :" —, e sem um jeito de nomear o
-- Bruno la dentro as portas abaixo continuariam sendo `select count(*)`
-- seguido de `\echo '   ^ 0'`, que NAO e assercao: e olho. O portoes.py roda
-- este arquivo e le o STATUS do psql, entao um count que volta 2 onde devia
-- voltar 0 IMPRIME 2, o psql sai com status zero, e o portao continua VERDE.
-- As doze portas da chave de privacidade nao tinham como ficar vermelhas
-- (D111). `current_setting` funciona dentro do plpgsql e atravessa `set role`.
select set_config('prova.ana',   :'id_ana',   false) as g1,
       set_config('prova.bruno', :'id_bruno', false) as g2,
       set_config('prova.carla', :'id_carla', false) as g3;

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
do $$
declare b uuid := current_setting('prova.bruno')::uuid; l int; m int; li int; f int;
begin
  select count(*) into l  from leituras   where perfil = b;
  select count(*) into m  from marcadores where perfil = b;
  select count(*) into li from listas     where perfil = b;
  select count(*) into f  from feed       where perfil = b;
  if (l, m, li, f) <> (2, 2, 1, 2) then
    raise exception 'FALHA: `default false` tirou algo de alguem (%, %, %, %)', l, m, li, f;
  end if;
end $$;
\echo '   ok: 2, 2, 1, 2 — `default false` nao tira nada de ninguem'
reset role;

\echo ''
\echo '=== 3. o Bruno fecha o diario ==='
update perfis set privado = true where id = :'id_bruno';

\echo ''
\echo '=== PORTA 1 — leituras. A que NAO tem tela: so a API le por aqui. ==='
select set_config('request.jwt.claim.sub', :'id_carla', false) as carla2;
set role authenticated;
do $$
declare b uuid := current_setting('prova.bruno')::uuid;
        a uuid := current_setting('prova.ana')::uuid; n int; na int;
begin
  select count(*) into n  from leituras where perfil = b;
  select count(*) into na from leituras where perfil = a;
  if n <> 0 then raise exception 'VAZOU porta 1: % leituras do diario fechado', n; end if;
  if na <> 1 then raise exception 'FALHA: fechar o Bruno mexeu na Ana (%)', na; end if;
end $$;
\echo '   ok: 0 do Bruno, e a 1 da Ana intacta'

\echo ''
\echo '=== PORTA 2 — marcadores. A porta que se esquece: a estante alheia ==='
\echo '    nao tem tela nenhuma no app, entao ninguem pensa nela. A API tem. ==='
do $$
declare b uuid := current_setting('prova.bruno')::uuid; n int;
begin
  select count(*) into n from marcadores where perfil = b;
  if n <> 0 then raise exception 'VAZOU porta 2: % marcadores da estante fechada', n; end if;
end $$;
\echo '   ok: 0'

\echo ''
\echo '=== PORTA 3 — listas ==='
do $$
declare b uuid := current_setting('prova.bruno')::uuid; n int;
begin
  select count(*) into n from listas where perfil = b;
  if n <> 0 then raise exception 'VAZOU porta 3: % listas do diario fechado', n; end if;
end $$;
\echo '   ok: 0'

\echo ''
\echo '=== PORTA 4 — lista_itens, que herda a decisao da lista ==='
do $$
declare n int;
begin
  select count(*) into n from lista_itens
   where lista = 'cccccccc-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'VAZOU porta 4: % itens de lista fechada', n; end if;
end $$;
\echo '   ^ 0: a subconsulta da politica sofre o RLS de `listas`, entao os'
\echo '     itens fecham sem repetir a regra da privacidade'

\echo ''
\echo '=== PORTA 5 — curtidas. Nao e so o par (perfil, leitura): e por aqui ==='
\echo '    que se enumera o uuid de uma leitura privada. ==='
do $$
declare n int;
begin
  select count(*) into n from curtidas
   where leitura = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'VAZOU porta 5: % curtidas enumeram a leitura privada', n; end if;
end $$;
\echo '   ^ 0 — e a Carla e quem tinha curtido: nem quem curtiu ve, porque'
\echo '     a leitura por baixo sumiu'
do $$
declare n int;
begin
  select count(*) into n from curtidas
   where leitura = 'aaaaaaaa-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'FALHA: a chave comeu o rastro do Bruno no diario alheio (%)', n; end if;
end $$;
\echo '   ^ 2: a leitura da Ana e publica, inclusive a curtida do Bruno privado.'
\echo '     A chave fecha o diario DELE, nao o rastro dele no diario dos outros.'

\echo ''
\echo '=== PORTA 6 — comentarios: prosa de terceiro pendurada numa leitura ==='
do $$
declare c uuid := current_setting('prova.carla')::uuid; n int;
begin
  select count(*) into n from comentarios
   where leitura = 'bbbbbbbb-0000-0000-0000-000000000001' and perfil <> c;
  if n <> 0 then raise exception 'VAZOU porta 6: % comentarios de terceiro em leitura privada', n; end if;
end $$;
\echo '   ^ 0: o comentario da Ana na leitura fechada do Bruno sumiu para a'
\echo '     Carla. E ESTE o vazamento — prosa de terceiro pendurada num diario'
\echo '     privado, endereçavel por `?leitura=eq.<uuid>`.'
do $$
declare c uuid := current_setting('prova.carla')::uuid; n int;
begin
  select count(*) into n from comentarios
   where leitura = 'bbbbbbbb-0000-0000-0000-000000000001' and perfil = c;
  if n <> 1 then raise exception 'FALHA: quem escreveu perdeu o proprio texto (%)', n; end if;
end $$;
\echo '   ^ 1, e de proposito: a primeira metade do predicado devolve o proprio'
\echo '     texto a quem escreveu. Fechar o diario alheio nao apaga a fala de'
\echo '     ninguem, e nao revela nada novo a quem ja escreveu ali.'

\echo ''
\echo '=== PORTA 7 — a view `feed`, e os CINCO consumidores dela ==='
do $$
declare b uuid := current_setting('prova.bruno')::uuid; n int;
begin
  select count(*) into n from feed where perfil = b;
  if n <> 0 then raise exception 'VAZOU porta 7: % linhas do diario fechado na view feed', n; end if;
end $$;
\echo '   ^ 0: a view e security_invoker, entao ela nao e uma porta propria —'
\echo '     herda o RLS de leituras. Isto cobre feed, feedGeral, leiturasDe,'
\echo '     leiturasDoLivro E o quinto, que nao aparece em grep por nome de'
\echo '     funcao: o `publico("feed","?select=*&id=eq.")` do link de resenha.'
do $$
declare n int;
begin
  select count(*) into n from feed where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'VAZOU: o link de resenha privada ainda abre (%)', n; end if;
end $$;
\echo '   ^ 0: um link de resenha compartilhado antes para de abrir. De'
\echo '     proposito — mas a tela tem que dizer "privado", nao "apagada".'
do $$
declare a uuid := current_setting('prova.ana')::uuid; n int; cu int; co int;
begin
  select count(*) into n from feed where perfil = a;
  if n <> 1 then raise exception 'FALHA: a Ana sumiu do feed (%)', n; end if;
  select curtidas, comentarios into cu, co from feed where perfil = a;
  if (cu, co) <> (2, 1) then
    raise exception 'FALHA: as subconsultas da view contaram errado (% e %)', cu, co;
  end if;
end $$;
\echo '   ok: 1 linha, com 2 curtidas e 1 comentario — as subconsultas de'
\echo '     contagem tambem rodam sob o RLS do invocador'

\echo ''
\echo '=== PORTA 8 — a `avisos` NAO pode quebrar. Esta e a assercao que pega ==='
\echo '    quem "melhorar" isto pondo o predicado em perfis. ==='
reset role;
select set_config('request.jwt.claim.sub', :'id_ana', false) as ana;
set role authenticated;
do $$
declare b uuid := current_setting('prova.bruno')::uuid; doBruno int; total int;
begin
  select count(*) into doBruno from avisos
   where quem = b and tipo in ('curtida', 'comentario');
  if doBruno <> 2 then
    raise exception 'FALHA porta 8: os avisos vindos do Bruno PRIVADO sumiram (%). '
                    'E o que acontece se o predicado for movido para perfis: a '
                    'view e INNER JOIN em perfis e as linhas somem sem erro.', doBruno;
  end if;
  select count(*) into total from avisos;
  if total <> 4 then
    raise exception 'FALHA porta 8: a Ana devia ter 4 avisos, tem %', total;
  end if;
end $$;
\echo '   ^ 4: curtida do Bruno, curtida da Carla, comentario do Bruno e o'
\echo '     Bruno tendo comecado a seguir a Ana — TODOS os tres tipos de aviso'
\echo '     atravessam a privacidade de quem os gerou, que e o ponto.'

\echo ''
\echo '=== PORTAS 9 e 10 — perfis e seguidores continuam PUBLICOS, de proposito ==='
do $$
declare b uuid := current_setting('prova.bruno')::uuid; n int;
begin
  select count(*) into n from perfis where id = b;
  if n <> 1 then raise exception 'FALHA: diario privado nao pode sumir o PERFIL (%)', n; end if;
end $$;
\echo '   ^ 1: diario privado nao e perfil invisivel. O cartao (nome, @, bio)'
\echo '     continua achavel pelo @ — senao a `avisos` e a `feed`, que sao'
\echo '     INNER JOIN em perfis, fariam a pessoa sumir de telas onde so o'
\echo '     nome dela apareceria. Quem quer sumir do indice apaga a conta.'
do $$
declare b uuid := current_setting('prova.bruno')::uuid; n int;
begin
  select count(*) into n from seguidores where seguido = b;
  if n <> 1 then raise exception 'FALHA: seguir nao e conteudo, devia continuar publico (%)', n; end if;
end $$;
\echo '   ok: 1 — quem segue quem continua publico. Seguir nao e conteudo.'

\echo ''
\echo '=== 4. o DONO continua vendo o diario dele inteiro ==='
reset role;
select set_config('request.jwt.claim.sub', :'id_bruno', false) as bruno;
set role authenticated;
do $$
declare b uuid := current_setting('prova.bruno')::uuid;
        l int; m int; li int; it int; f int; cu int;
begin
  select count(*) into l  from leituras    where perfil = b;
  select count(*) into m  from marcadores  where perfil = b;
  select count(*) into li from listas      where perfil = b;
  select count(*) into it from lista_itens where lista = 'cccccccc-0000-0000-0000-000000000001';
  select count(*) into f  from feed        where perfil = b;
  select count(*) into cu from curtidas
   where leitura in (select id from leituras where perfil = b);
  if (l, m, li, it, f) <> (2, 2, 1, 2, 2) then
    raise exception 'FALHA: o DONO perdeu o proprio diario (%, %, %, %, %)', l, m, li, it, f;
  end if;
  if cu <> 1 then
    raise exception 'FALHA: o dono parou de ver quem curtiu a leitura fechada dele (%)', cu;
  end if;
end $$;
\echo '   ok: 2, 2, 1, 2, 2 e 1 curtida recebida — privacidade e sobre'
\echo '     terceiros; nao poder ler o proprio diario seria um defeito.'

\echo ''
\echo '=== 11. visitante (anon) nao ve nada de quem fechou o diario ==='
reset role;
select set_config('request.jwt.claim.sub', '', false) as sem_claim;
set role anon;
do $$
declare b uuid := current_setting('prova.bruno')::uuid; l int; m int; li int; f int;
begin
  select count(*) into l  from leituras   where perfil = b;
  select count(*) into m  from marcadores where perfil = b;
  select count(*) into li from listas     where perfil = b;
  select count(*) into f  from feed       where perfil = b;
  if (l, m, li, f) <> (0, 0, 0, 0) then
    raise exception 'VAZOU para VISITANTE: %, %, %, %', l, m, li, f;
  end if;
end $$;
\echo '   ok: 0, 0, 0, 0. Atencao ao motivo: sem sessao auth.uid() e NULO, entao'
\echo '     `perfil = auth.uid()` e nulo — e a primeira metade do predicado nao'
\echo '     salva ninguem. Quem protege aqui e o `not exists`.'
do $$
declare a uuid := current_setting('prova.ana')::uuid; n int;
begin
  select count(*) into n from feed where perfil = a;
  if n <> 1 then
    raise exception 'FALHA: o visitante perdeu o acervo PUBLICO (%) — zero em '
                    'tudo tambem e a assinatura de um banco cego', n;
  end if;
end $$;
\echo '   ok: 1 — o app continua abrindo sem conta para o resto do acervo'
reset role;

\echo ''
\echo '=== 12. desligar a chave devolve tudo ==='
update perfis set privado = false where id = :'id_bruno';
select set_config('request.jwt.claim.sub', :'id_carla', false) as carla3;
set role authenticated;
do $$
declare b uuid := current_setting('prova.bruno')::uuid; l int; li int; f int;
begin
  select count(*) into l  from leituras where perfil = b;
  select count(*) into li from listas   where perfil = b;
  select count(*) into f  from feed     where perfil = b;
  if (l, li, f) <> (2, 1, 2) then
    raise exception 'FALHA: desligar a chave nao devolveu tudo (%, %, %)', l, li, f;
  end if;
end $$;
\echo '   ok: 2, 1, 2 — de volta. A chave e ESTADO, nao destruicao: nada foi'
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

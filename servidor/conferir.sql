-- ============================================================================
-- conferir.sql — o seu banco está em dia com o aplicativo?
--
-- Cole no SQL Editor do Supabase e rode. Ele não muda NADA: só olha e conta o
-- que encontrou. Cada linha do resultado diz uma coisa e o que ela quebra.
--
-- POR QUE ISTO EXISTE. Quando uma entrega acrescenta uma coluna ou uma view, a
-- tela do aplicativo funciona e nunca recebe uma linha — sem erro, sem aviso,
-- sem nada. É o modo de falha mais silencioso deste projeto, e até aqui a única
-- forma de perceber era alguém reparar que uma tela vive vazia.
--
-- O conserto é sempre o mesmo: colar o `esquema.sql` inteiro no SQL Editor e
-- rodar. Ele é feito para rodar de novo quantas vezes for preciso.
--
-- POR QUE COM SQL DINÂMICO, e não uma consulta direta: a primeira versão deste
-- arquivo quebrou no banco que ele existe para diagnosticar. O Postgres analisa
-- a instrução INTEIRA antes de executar, então mencionar `listas.cliente_id`
-- derruba o arquivo todo justamente quando essa coluna é a que falta. Um
-- diagnóstico que só roda no paciente saudável não diagnostica nada.
-- ============================================================================

drop table if exists conferencia;
create temporary table conferencia (
  ordem int, o_que text, situacao text, o_que_quebra text
);

do $$
declare n bigint;
begin
  -- ---- forma do esquema: colunas e views que precisam existir --------------
  insert into conferencia values (1, 'coluna cliente_id em leituras',
    case when exists (select 1 from information_schema.columns
                       where table_name='leituras' and column_name='cliente_id')
         then 'ok' else 'FALTA — rode o esquema.sql de novo' end,
    'sem ela, editar uma leitura depois de migrar cria uma segunda no servidor');

  insert into conferencia values (3, 'coluna cliente_id em listas',
    case when exists (select 1 from information_schema.columns
                       where table_name='listas' and column_name='cliente_id')
         then 'ok' else 'FALTA — rode o esquema.sql de novo' end,
    'sem ela, editar uma lista depois de migrar cria uma segunda no servidor');

  insert into conferencia values (5, 'view feed',
    case when exists (select 1 from information_schema.views where table_name='feed')
         then 'ok' else 'FALTA — rode o esquema.sql de novo' end,
    'a aba Atividade e a de Resenhas ficam vazias');

  insert into conferencia values (6, 'view avisos',
    case when exists (select 1 from information_schema.views where table_name='avisos')
         then 'ok' else 'FALTA — rode o esquema.sql de novo' end,
    'a aba Você funciona e nunca recebe uma linha');

  -- ---- backfill: só dá para contar se a coluna existir ---------------------
  if exists (select 1 from information_schema.columns
              where table_name='leituras' and column_name='cliente_id') then
    execute 'select count(*) from leituras where cliente_id is null' into n;
    insert into conferencia values (2, 'leituras antigas sem cliente_id',
      case when n = 0 then 'ok'
           else 'FALTA o backfill (' || n || ' linhas) — rode o esquema.sql de novo' end,
      'o diário duplica ao descer para um aparelho novo');
  else
    insert into conferencia values (2, 'leituras antigas sem cliente_id',
      'não dá para conferir: a coluna nem existe ainda',
      'veja a linha de cima');
  end if;

  if exists (select 1 from information_schema.columns
              where table_name='listas' and column_name='cliente_id') then
    execute 'select count(*) from listas where cliente_id is null' into n;
    insert into conferencia values (4, 'listas antigas sem cliente_id',
      case when n = 0 then 'ok'
           else 'FALTA o backfill (' || n || ' linhas) — rode o esquema.sql de novo' end,
      'a aba Listas duplica ao descer');
  else
    insert into conferencia values (4, 'listas antigas sem cliente_id',
      'não dá para conferir: a coluna nem existe ainda',
      'veja a linha de cima');
  end if;

  -- ---- as duas coisas que não são "falta atualizar", são perigo ------------
  select count(*) into n
    from pg_tables t
   where t.schemaname = 'public'
     and t.tablename in ('perfis','livros','leituras','marcadores','listas',
                         'lista_itens','seguidores','curtidas','comentarios','denuncias')
     and not exists (select 1 from pg_class c
                      where c.relname = t.tablename and c.relrowsecurity);
  insert into conferencia values (7, 'RLS ligada em todas as tabelas',
    case when n = 0 then 'ok' else 'PERIGO — ' || n || ' tabela(s) sem RLS' end,
    'sem RLS, o diário de qualquer pessoa fica editável por qualquer pessoa');

  insert into conferencia values (8, 'gatilho que cria o perfil ao cadastrar',
    case when exists (select 1 from pg_trigger where tgname = 'ao_cadastrar')
         then 'ok' else 'FALTA — rode o esquema.sql de novo' end,
    'quem se cadastra fica sem perfil e o app não sabe quem é');
end $$;

select o_que, situacao, o_que_quebra from conferencia order by ordem;

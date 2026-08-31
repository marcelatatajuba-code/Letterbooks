-- ============================================================================
-- provar-v8.sql — o UPSERT QUE O APP EMITE funciona contra este esquema.
--
--   psql -h /tmp -p 5433 -d prova8 -f servidor/provar-v8.sql
--
-- POR QUE EXISTE, e é o buraco que ele fecha: nenhuma prova deste repositório
-- rodava o SQL que o CLIENTE manda. O `provar-v1.sql` escreve
--
--     on conflict (perfil, cliente_id) where cliente_id is not null
--
-- — com o predicado. O aplicativo não tem como mandar isso. Ele manda
-- `?on_conflict=perfil,cliente_id` na URL, e o PostgREST traduz para
--
--     on conflict (perfil, cliente_id)
--
-- e ponto: não existe sintaxe na query string para um predicado de índice
-- parcial. Enquanto o índice foi PARCIAL, o Postgres não conseguiu casar a
-- especificação e devolveu 42P10 — ou seja, `salvarLeitura` (toda subida pela
-- fila), o passo 2 de `migrar` e `salvarLista` falhavam, e a prova continuava
-- verde porque provava uma forma de SQL que só ela mesma usava (D120).
--
-- A regra que este arquivo escreve, e que vale para toda prova futura: PROVE A
-- FORMA QUE O CLIENTE EMITE. Uma prova que usa uma sintaxe mais poderosa que a
-- do chamador não prova o chamador — prova o autor da prova.
--
-- O que fica provado:
--   1. o esquema roda, e roda DE NOVO (o caminho de upgrade)
--   2. o upsert SEM predicado — a forma do PostgREST — funciona e não duplica
--   3. a semântica que o predicado dizia proteger sobrevive: N linhas com
--      cliente_id NULO continuam cabendo, porque NULL é distinto de NULL
--   4. o mesmo para `listas`
--   5. CONTROLE NEGATIVO: recriando o índice PARCIAL de propósito, o mesmo
--      upsert estoura com 42P10. Sem isto, nada aqui prova que a asserção
--      tem poder.
--   6. e o esquema devolve o índice bom ao lugar
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente — e o `drop index` do upgrade rodou duas vezes'

\echo ''
\echo '=== 2. o cenario ==='
insert into auth.users (id, email) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'ana@x.com');
insert into livros (chave, titulo) values ('/works/OL1W', 'Dom Casmurro');

\echo ''
\echo '=== 3. O UPSERT QUE O APP EMITE. Esta e a assercao do item. ==='
\echo '    Sem predicado, que e o unico jeito que o PostgREST sabe escrever.'
do $$
declare n int; nota_final numeric;
begin
  -- primeira subida da fila
  insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 4.0, '2026-01-01', 'c1')
  on conflict (perfil, cliente_id) do update set nota = excluded.nota;

  -- a MESMA leitura editada e reenviada: tem que atualizar, nao duplicar
  insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 5.0, '2026-01-01', 'c1')
  on conflict (perfil, cliente_id) do update set nota = excluded.nota;

  select count(*), max(nota) into n, nota_final
    from leituras where cliente_id = 'c1';
  if n <> 1 then
    raise exception 'FALHA: o reenvio duplicou a leitura (% linhas)', n;
  end if;
  if nota_final <> 5.0 then
    raise exception 'FALHA: o reenvio nao atualizou a nota (deu %)', nota_final;
  end if;
  raise notice 'ok: 1 linha, nota 5.0 — o upsert do app funciona e e idempotente';
exception when others then
  -- 42P10 cai aqui, e e exatamente o defeito que este arquivo existe para pegar
  raise exception 'FALHA no upsert que o app emite: % (SQLSTATE %)', sqlerrm, sqlstate;
end $$;

\echo ''
\echo '=== 4. a linha antiga SEM cliente_id continua cabendo ==='
\echo '    E o que o predicado dizia proteger — e que o indice total ja fazia'
\echo '    sozinho, porque num indice unico NULL e distinto de NULL.'
do $$
declare n int;
begin
  insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 3.0, '2025-01-01', null);
  insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 2.0, '2025-01-02', null);
  select count(*) into n from leituras where cliente_id is null;
  if n <> 2 then
    raise exception 'FALHA: o indice total recusou linha antiga sem cliente_id (deu %)', n;
  end if;
  raise notice 'ok: as duas linhas sem cliente_id entraram';
end $$;

\echo ''
\echo '=== 5. o mesmo para listas, que tinha o mesmo predicado ==='
do $$
declare n int; nome_final text;
begin
  insert into listas (perfil, nome, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', 'Para reler', 'l1')
  on conflict (perfil, cliente_id) do update set nome = excluded.nome;
  insert into listas (perfil, nome, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', 'Para reler em 2027', 'l1')
  on conflict (perfil, cliente_id) do update set nome = excluded.nome;
  select count(*), max(nome) into n, nome_final from listas where cliente_id = 'l1';
  if n <> 1 or nome_final <> 'Para reler em 2027' then
    raise exception 'FALHA: o upsert de listas (% linhas, nome %)', n, nome_final;
  end if;
  raise notice 'ok: listas tambem faz upsert pela forma do PostgREST';
exception when others then
  raise exception 'FALHA no upsert de listas: % (SQLSTATE %)', sqlerrm, sqlstate;
end $$;

\echo ''
\echo '=========================================================================='
\echo ' 6. CONTROLE NEGATIVO — a assercao da secao 3 tem PODER?'
\echo ''
\echo ' Recria o indice PARCIAL, do jeito que ele estava antes do D120, e repete'
\echo ' o mesmo upsert. Ele TEM que estourar com 42P10. Se nao estourar, o'
\echo ' problema esta na prova e nao no esquema — e foi assim que este defeito'
\echo ' viveu escondido: a prova antiga usava uma sintaxe que o cliente nao tem.'
\echo '=========================================================================='
drop index if exists leituras_cliente;
create unique index leituras_cliente
  on leituras (perfil, cliente_id) where cliente_id is not null;

\set ON_ERROR_STOP off
insert into leituras (perfil, livro, nota, lido_em, cliente_id)
values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 1.0, '2026-02-02', 'c2')
on conflict (perfil, cliente_id) do update set nota = excluded.nota;
\set ON_ERROR_STOP on
\echo '   ^ TEM que ter aparecido: ERROR 42P10 — there is no unique or exclusion'
\echo '     constraint matching the ON CONFLICT specification'

\echo ''
\echo '=== 7. e o esquema devolve o indice bom ao lugar ==='
\i esquema.sql
do $$
declare n int;
begin
  insert into leituras (perfil, livro, nota, lido_em, cliente_id)
  values ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 1.0, '2026-02-02', 'c3')
  on conflict (perfil, cliente_id) do update set nota = excluded.nota;
  select count(*) into n from leituras where cliente_id = 'c3';
  if n <> 1 then raise exception 'FALHA: o esquema nao devolveu o indice bom'; end if;
  raise notice 'ok: o indice voltou e o upsert do app funciona de novo';
end $$;

\echo ''
\echo '=== fim: o SQL que o app emite esta provado, e a prova sabe ficar vermelha ==='

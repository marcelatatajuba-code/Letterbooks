-- ============================================================================
-- provar-v7.sql — a DISTRIBUIÇÃO DE NOTAS não vaza o diário fechado.
--
--   psql -h /tmp -p 5433 -d prova7 -f servidor/provar-v7.sql
--
-- POR QUE EXISTE: o item 14 põe no perfil alheio um histograma de "como esta
-- pessoa avalia", e ele vem de uma view de agregação (`distribuicao_de_notas`).
-- Agregado é a forma mais silenciosa de vazamento que este esquema já teve: a
-- resposta não é a linha da pessoa, é a FORMA das linhas dela — e uma view sem
-- `security_invoker` devolveria a distribuição de todo diário fechado do
-- aplicativo, para visitante sem conta inclusive, sem erro e sem log.
--
-- Nenhuma das cinco suítes de docs/ pega isso: nenhuma aplica RLS, e o
-- Supabase de mentira imita o EFEITO das políticas, não as políticas. Este
-- arquivo é a verificação principal do recorte, não um extra.
--
-- POR QUE `do $$ ... raise exception` E NÃO `select` + `\echo '   ^ 0'`:
-- o portoes.py roda cada provar*.sql e lê o STATUS do psql, e só. Um
-- `select count(*)` que volta 2 onde devia voltar 0 IMPRIME 2, o psql sai
-- com status zero, e o portão continua VERDE. É o defeito D111, achado
-- enquanto este arquivo era escrito: as doze portas do provar-v4.sql estão
-- hoje nesse formato e NÃO TÊM COMO FICAR VERMELHAS. Uma view de agregação
-- que vaza é exatamente o caso que passa por baixo desse formato: ela não
-- erra, ela devolve linha a mais.
--
-- POR QUE OS UUIDS SÃO FIXOS E NÃO SAEM DE `\gset`: o psql NÃO interpola
-- `:'var'` dentro de bloco com dólar-aspas — `raise notice '%', :'id_bruno'`
-- morre com "syntax error at or near :". Sem uuid fixo, quem for escrever a
-- próxima asserção desiste do do-block e volta para o `\echo`, que é o
-- formato que não pega nada.
--
-- O que fica provado:
--   1. o esquema com a view roda, e roda DE NOVO (o caminho de upgrade)
--   3. a distribuição de um diário FECHADO não existe para terceiro
--   4. e a de um diário PÚBLICO continua exata — o controle que impede
--      "zero em tudo" de passar por aprovação
--   5. o DONO continua vendo a própria distribuição depois de fechar
--   6. o VISITANTE (anon) obedece à mesma regra, e enxerga o perfil público
--   7. CONTROLE NEGATIVO: afrouxar a política faz a asserção da seção 3
--      estourar. Sem isto, nada aqui prova que a asserção tem poder.
--   8. e o esquema devolve a política ao lugar
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. o esquema com a view roda limpo, e roda DE NOVO ==='
\i esquema.sql
\i esquema.sql
\echo '   ok: idempotente — o caminho de upgrade, nao so o de banco vazio'

\echo ''
\echo '=== 2. cenario: Ana PUBLICA (3 com nota + 1 sem), Bruno PRIVADO (2) ==='
insert into auth.users (id, email) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'ana@x.com'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'bruno@x.com'),
  ('cccc0000-0000-0000-0000-00000000000c', 'carla@x.com');

insert into livros (chave, titulo) values
  ('/works/OL1W', 'Dom Casmurro'), ('/works/OL2W', 'Vidas Secas'),
  ('/works/OL3W', 'A Hora da Estrela'), ('/works/OL4W', 'Grande Sertao');

-- A leitura SEM nota da Ana e deliberada: ela nao entra em nenhuma barra do
-- histograma, mas TEM que entrar no total — e o total e o que conserta a linha
-- "Leituras" do perfil alheio (D109). Um `where nota is not null` na view
-- passaria despercebido sem esta linha.
insert into leituras (perfil, livro, nota, lido_em, cliente_id) values
  ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL1W', 5.0, '2026-01-01', 'a1'),
  ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL2W', 5.0, '2026-01-02', 'a2'),
  ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL3W', 3.5, '2026-01-03', 'a3'),
  ('aaaa0000-0000-0000-0000-00000000000a', '/works/OL4W', null, '2026-01-04', 'a4'),
  ('bbbb0000-0000-0000-0000-00000000000b', '/works/OL1W', 4.0, '2026-01-01', 'b1'),
  ('bbbb0000-0000-0000-0000-00000000000b', '/works/OL2W', 1.0, '2026-01-02', 'b2');

update perfis set privado = true where id = 'bbbb0000-0000-0000-0000-00000000000b';

select set_config('request.jwt.claim.sub',
                  'cccc0000-0000-0000-0000-00000000000c', false) as carla;
set role authenticated;

\echo ''
\echo '=== 3. O VAZAMENTO. Esta e a assercao do item. ==='
do $$
declare grupos int; linhas int;
begin
  select count(*), coalesce(sum(qtd), 0) into grupos, linhas
    from distribuicao_de_notas
   where perfil = 'bbbb0000-0000-0000-0000-00000000000b';
  if grupos <> 0 or linhas <> 0 then
    raise exception 'VAZOU: a distribuicao do diario FECHADO saiu em % grupos, % leituras',
                    grupos, linhas;
  end if;
  raise notice 'ok: o diario fechado nao tem distribuicao para terceiro';
end $$;

\echo ''
\echo '=== 4. e a Ana PUBLICA continua exata — a outra metade da mesma prova ==='
\echo '    Sem esta assercao, um RLS totalmente quebrado (nenhuma politica de'
\echo '    select em leituras) daria 0 em tudo e a secao 3 passaria VAZIA de'
\echo '    significado: "0 linhas" seria ao mesmo tempo o sinal de aprovado e a'
\echo '    assinatura de um banco cego.'
do $$
declare n5 int; n35 int; total int;
begin
  select coalesce(max(qtd) filter (where nota = 5.0), 0),
         coalesce(max(qtd) filter (where nota = 3.5), 0),
         coalesce(sum(qtd), 0)
    into n5, n35, total
    from distribuicao_de_notas
   where perfil = 'aaaa0000-0000-0000-0000-00000000000a';
  if n5 <> 2 or n35 <> 1 then
    raise exception 'FALHA: a distribuicao publica veio errada (5.0=%, 3.5=%)', n5, n35;
  end if;
  if total <> 4 then
    raise exception 'FALHA: sum(qtd) tem que contar a leitura SEM nota tambem (deu %)', total;
  end if;
  raise notice 'ok: 5.0=2, 3.5=1, e o total honesto e 4 (a sem nota inclusa)';
end $$;

\echo ''
\echo '=== 5. o DONO ve a propria distribuicao com o diario fechado ==='
\echo '    Fechar o diario e estado, nao destruicao: a metade `perfil ='
\echo '    auth.uid()` do predicado tem que continuar valendo para o dono.'
reset role;
select set_config('request.jwt.claim.sub',
                  'bbbb0000-0000-0000-0000-00000000000b', false) as bruno;
set role authenticated;
do $$
declare n int;
begin
  select coalesce(sum(qtd), 0) into n from distribuicao_de_notas
   where perfil = 'bbbb0000-0000-0000-0000-00000000000b';
  if n <> 2 then
    raise exception 'FALHA: fechar o diario tirou do DONO a propria distribuicao (deu %)', n;
  end if;
  raise notice 'ok: o Bruno continua vendo as 2 leituras dele';
end $$;

\echo ''
\echo '=== 6. VISITANTE (anon): a mesma regra, sem sessao ==='
\echo '    Atencao ao motivo: sem sessao auth.uid() e NULO, entao a metade'
\echo '    `perfil = auth.uid()` do predicado nao salva ninguem — quem protege'
\echo '    aqui e o `not exists`. E o `grant ... to anon` e o que faz o'
\echo '    histograma existir para quem chega por um link compartilhado.'
reset role;
select set_config('request.jwt.claim.sub', '', false) as sem_claim;
set role anon;
do $$
declare priv int; pub int;
begin
  select coalesce(sum(qtd), 0) into priv from distribuicao_de_notas
   where perfil = 'bbbb0000-0000-0000-0000-00000000000b';
  select coalesce(sum(qtd), 0) into pub  from distribuicao_de_notas
   where perfil = 'aaaa0000-0000-0000-0000-00000000000a';
  if priv <> 0 then
    raise exception 'VAZOU para VISITANTE: a distribuicao fechada saiu em % leituras', priv;
  end if;
  if pub <> 4 then
    raise exception 'FALHA: o visitante perdeu o perfil PUBLICO (deu %) — falta o grant to anon', pub;
  end if;
  raise notice 'ok: o visitante ve a Ana e nao ve o Bruno';
end $$;
reset role;

\echo ''
\echo '=========================================================================='
\echo ' 7. CONTROLE NEGATIVO — a assercao da secao 3 tem PODER?'
\echo ''
\echo ' Uma prova de vazamento cuja assertiva nunca poderia falhar e decoracao.'
\echo ' Aqui a politica de leituras e afrouxada DE PROPOSITO para `using (true)`'
\echo ' e a MESMA assertiva da secao 3 e repetida: ela TEM que estourar. Se ela'
\echo ' nao estourar, o problema esta na prova, nao no esquema.'
\echo '=========================================================================='
drop policy "diário é público, salvo se privado" on leituras;
create policy "afrouxada de proposito" on leituras for select using (true);

select set_config('request.jwt.claim.sub',
                  'cccc0000-0000-0000-0000-00000000000c', false) as carla2;
set role authenticated;
\set ON_ERROR_STOP off
do $$
declare n int;
begin
  select coalesce(sum(qtd), 0) into n from distribuicao_de_notas
   where perfil = 'bbbb0000-0000-0000-0000-00000000000b';
  if n <> 0 then
    raise exception 'VAZOU: a distribuicao do diario FECHADO saiu em % leituras', n;
  end if;
end $$;
\set ON_ERROR_STOP on
\echo '   ^ TEM que ter aparecido acima: ERROR: VAZOU: ... 2 leituras'
\echo '     Se nao apareceu, a secao 3 esta passando por acidente.'
reset role;

\echo ''
\echo '=== 8. e o esquema.sql devolve a politica ao lugar ==='
\echo '    Obrigatorio, e nao higiene: sem isto o banco fica SEM politica de'
\echo '    select em leituras, e a partir daqui todo `0` seria falso-verde.'
drop policy "afrouxada de proposito" on leituras;
\i esquema.sql

select set_config('request.jwt.claim.sub',
                  'cccc0000-0000-0000-0000-00000000000c', false) as carla3;
set role authenticated;
do $$
declare priv int; pub int;
begin
  select coalesce(sum(qtd), 0) into priv from distribuicao_de_notas
   where perfil = 'bbbb0000-0000-0000-0000-00000000000b';
  select coalesce(sum(qtd), 0) into pub  from distribuicao_de_notas
   where perfil = 'aaaa0000-0000-0000-0000-00000000000a';
  if priv <> 0 then
    raise exception 'FALHA: a politica nao voltou (privado deu %)', priv;
  end if;
  if pub <> 4 then
    raise exception 'FALHA: a politica voltou ERRADA (publico deu %)', pub;
  end if;
  raise notice 'ok: a politica esta de volta e a prova terminou com o banco sao';
end $$;
reset role;

\echo ''
\echo '=== fim: a agregacao nao vaza, e a prova disso tem como ficar vermelha ==='

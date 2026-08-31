-- O mínimo do Supabase que o esquema encosta: o schema auth com a tabela de
-- contas, os dois papéis do PostgREST e a função auth.uid().
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to anon, authenticated;

-- USAGE no schema auth, que faltava. No Supabase de verdade `anon` e
-- `authenticated` chamam auth.uid() o tempo todo — e sem este grant a chamada
-- DIRETA falha com "permission denied for schema auth", enquanto a mesma
-- chamada DENTRO de uma politica funciona (expressao de policy roda com os
-- privilegios do dono da tabela, nao os de quem consulta). Essa assimetria
-- fazia o provar.sql morrer no meio sem que nada no esquema estivesse errado.
-- Nao afrouxa nada: usage no schema nao da select em auth.users, e o proprio
-- provar.sql continua exigindo que ler auth.users como `authenticated` falhe.
grant usage on schema auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;

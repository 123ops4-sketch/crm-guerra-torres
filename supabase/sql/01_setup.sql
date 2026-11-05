-- ============================================================
-- GUERRA & TORRES ADVOCACIA — preparação do banco no Supabase
-- Painel do Supabase -> SQL Editor -> New query -> cole TUDO -> Run
-- Pode rodar de novo sem problema (o script é idempotente).
-- ============================================================

-- 1) E-MAILS AUTORIZADOS -------------------------------------
create table if not exists public.crm_membros (
  email text primary key,
  nome  text
);
insert into public.crm_membros (email, nome) values
  ('123ops4@gmail.com', 'Paulo Henrique Braga Torres')
on conflict (email) do nothing;
-- Dra. Allane: tire os dois traços do início da linha abaixo e troque pelo e-mail dela
-- insert into public.crm_membros (email, nome) values ('EMAIL_DA_DRA_ALLANE', 'Allane Ferreira Guerra') on conflict (email) do nothing;

-- 2) DADOS DO SISTEMA ----------------------------------------
-- Cada linha guarda uma lista do sistema (processos, clientes, prazos...)
create table if not exists public.crm_store (
  key        text primary key,
  data       jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Histórico automático: toda alteração guarda a versão anterior
-- (permite recuperar dados apagados por engano)
create table if not exists public.crm_historico (
  id         bigint generated always as identity primary key,
  key        text not null,
  data       jsonb not null,
  alterado_em timestamptz not null default now(),
  alterado_por text
);

create or replace function public.crm_guardar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.data is distinct from new.data then
    -- guarda a versão ANTERIOR e QUEM fez a alteração (new.updated_by)
    insert into public.crm_historico(key, data, alterado_por) values (old.key, old.data, new.updated_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_historico on public.crm_store;
create trigger trg_crm_historico before update on public.crm_store
  for each row execute function public.crm_guardar_historico();

-- Mantém só os últimos 90 dias de histórico (rodado diariamente pelo agendamento)
create or replace function public.crm_limpar_historico()
returns void language sql security definer set search_path = public as $$
  delete from public.crm_historico where alterado_em < now() - interval '90 days';
$$;

-- Gravação com controle de versão: só grava se ninguém alterou a lista desde a última leitura.
-- Se alguém gravou antes, devolve a versão atual para o sistema juntar as alterações e tentar de novo.
create or replace function public.crm_gravar(p_key text, p_data jsonb, p_esperado timestamptz, p_autor text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_ts timestamptz;
  v_row public.crm_store%rowtype;
  v_autor text := coalesce(nullif(auth.jwt() ->> 'email', ''), p_autor);
begin
  if p_esperado is not null then
    update public.crm_store set data = p_data, updated_at = clock_timestamp(), updated_by = v_autor
     where key = p_key and updated_at = p_esperado
     returning updated_at into v_ts;
  end if;
  if v_ts is null then
    select * into v_row from public.crm_store where key = p_key;
    if not found then
      insert into public.crm_store(key, data, updated_at, updated_by)
      values (p_key, p_data, clock_timestamp(), v_autor)
      on conflict (key) do nothing
      returning updated_at into v_ts;
      if v_ts is null then select * into v_row from public.crm_store where key = p_key; end if;
    end if;
  end if;
  if v_ts is not null then
    return jsonb_build_object('ok', true, 'updated_at', v_ts);
  end if;
  return jsonb_build_object('ok', false, 'data', v_row.data, 'updated_at', v_row.updated_at, 'updated_by', v_row.updated_by);
end $$;
revoke all on function public.crm_gravar(text, jsonb, timestamptz, text) from public, anon;
grant execute on function public.crm_gravar(text, jsonb, timestamptz, text) to authenticated, service_role;

-- 3) SEGURANÇA -----------------------------------------------
create or replace function public.crm_sou_membro()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_membros
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.crm_sou_membro() to authenticated;

alter table public.crm_store     enable row level security;
alter table public.crm_membros   enable row level security;
alter table public.crm_historico enable row level security;

drop policy if exists "membros_tudo" on public.crm_store;
create policy "membros_tudo" on public.crm_store
  for all to authenticated
  using (public.crm_sou_membro()) with check (public.crm_sou_membro());

drop policy if exists "membros_leem" on public.crm_membros;
create policy "membros_leem" on public.crm_membros
  for select to authenticated using (public.crm_sou_membro());

drop policy if exists "membros_leem_hist" on public.crm_historico;
create policy "membros_leem_hist" on public.crm_historico
  for select to authenticated using (public.crm_sou_membro());

-- 4) TEMPO REAL (um vê a alteração do outro na hora) ---------
do $$
begin
  alter publication supabase_realtime add table public.crm_store;
exception when duplicate_object then null;
end $$;

-- 5) ARQUIVOS ANEXOS -----------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists "membros_anexos" on storage.objects;
create policy "membros_anexos" on storage.objects
  for all to authenticated
  using (bucket_id = 'anexos' and public.crm_sou_membro())
  with check (bucket_id = 'anexos' and public.crm_sou_membro());

-- ============================================================
-- DEPOIS DE RODAR:
-- a) Authentication -> Users -> "Add user" -> "Create new user":
--    crie um usuário (e-mail + senha) para cada advogado, com os
--    MESMOS e-mails colocados no item 1. Marque "Auto Confirm User".
-- b) Authentication -> Sign In / Providers -> desligue
--    "Allow new users to sign up" (ninguém de fora cria conta).
-- ============================================================

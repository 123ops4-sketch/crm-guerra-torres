-- ============================================================
-- ATUALIZAÇÃO v2 — rode UMA vez se você já executou o supabase_setup.sql antes
-- (quem ainda não rodou nada pode usar só o supabase_setup.sql, que já está atualizado)
-- ============================================================

-- Histórico passa a registrar QUEM fez cada alteração
create or replace function public.crm_guardar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.data is distinct from new.data then
    insert into public.crm_historico(key, data, alterado_por) values (old.key, old.data, new.updated_by);
  end if;
  return new;
end $$;

-- Limpeza automática do histórico com mais de 90 dias (todo dia às 3h de Brasília)
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('crm-limpar-historico'); exception when others then null; end $$;
select cron.schedule('crm-limpar-historico', '0 6 * * *', $job$ select public.crm_limpar_historico(); $job$);

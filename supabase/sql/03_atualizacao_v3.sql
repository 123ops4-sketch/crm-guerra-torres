-- ============================================================
-- ATUALIZAÇÃO v3 — gravação registro por registro (edição simultânea sem perda)
-- Só é necessária se o banco já foi criado com uma versão anterior do script.
-- Painel do Supabase -> SQL Editor -> New query -> cole TUDO -> Run
-- ============================================================

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

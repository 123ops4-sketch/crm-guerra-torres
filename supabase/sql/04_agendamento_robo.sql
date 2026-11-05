-- ============================================================
-- AGENDAMENTO DO ROBÔ DJEN — 7h e 12h (horário de Brasília), seg a sex
-- Pré-requisitos:
--   a) função "djen-diario" publicada (Verify JWT desligado);
--   b) Edge Functions -> Secrets -> CRON_SECRET = <a senha>;
--   c) a MESMA senha guardada no cofre (Vault) do Supabase — passo 1 abaixo.
-- SQL Editor -> New query -> cole TUDO -> Run  (endereço do projeto já preenchido)
-- A senha nunca fica gravada neste arquivo nem no GitHub.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Guardar a senha no cofre — rode UMA vez, antes do resto, trocando o texto entre aspas:
--    select vault.create_secret('COLE_AQUI_A_SENHA', 'djen_cron_secret');
--    (para trocar depois: select vault.update_secret((select id from vault.secrets where name='djen_cron_secret'), 'NOVA_SENHA');)

-- remove agendamento anterior com o mesmo nome (se existir)
do $$ begin perform cron.unschedule('djen-diario'); exception when others then null; end $$;

-- 10:00 e 15:00 UTC = 07:00 e 12:00 em Brasília
select cron.schedule(
  'djen-diario',
  '0 10,15 * * 1-5',
  $job$
  select net.http_post(
    url     := 'https://eyehelxgnkueskripfvo.supabase.co/functions/v1/djen-diario',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'djen_cron_secret'),
      'x-region', 'sa-east-1'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

-- Limpeza automática do histórico com mais de 90 dias (todo dia às 3h de Brasília)
do $$ begin perform cron.unschedule('crm-limpar-historico'); exception when others then null; end $$;
select cron.schedule('crm-limpar-historico', '0 6 * * *', $job$ select public.crm_limpar_historico(); $job$);

-- Para conferir os agendamentos:      select * from cron.job;
-- Para ver as últimas execuções:      select * from cron.job_run_details order by start_time desc limit 10;
-- Para rodar o robô agora (teste):    rode só o bloco "select net.http_post(...)" acima.

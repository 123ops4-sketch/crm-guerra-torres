# CRM Jurídico — Guerra & Torres Advocacia

Sistema interno de gestão do escritório (processos, clientes, prazos, intimações, agenda,
honorários, horas, quadros, minutas e modelos Word). Aplicação de um único arquivo HTML,
com banco e autenticação no Supabase.

> Repositório **privado**. Não versionar senhas, chaves `service_role`/secret ou arquivos `.env`.

## Estrutura

```
site/index.html                     aplicação (publicada pelo Netlify)
supabase/sql/01_setup.sql           tabelas, RLS, membros, histórico, bucket "anexos"
supabase/sql/02_atualizacao_v2.sql  atualização v2
supabase/sql/03_atualizacao_v3.sql  atualização v3 (crm_gravar — gravação com controle de concorrência)
supabase/sql/04_agendamento_robo.sql agendamento do robô DJEN (pg_cron + pg_net + Vault)
supabase/functions/djen/            consulta DJEN (Verify JWT: LIGADO)
supabase/functions/datajud/         consulta DataJud (Verify JWT: LIGADO)
supabase/functions/djen-diario/     robô diário de intimações (Verify JWT: DESLIGADO — protegido por CRON_SECRET)
supabase/functions/agenda/          feed ICS da agenda (Verify JWT: DESLIGADO — protegido por token)
modelos/                            modelos .docx com campos {{...}}
```

## Supabase — ordem de instalação

1. SQL Editor: rodar `01_setup.sql`, `02_atualizacao_v2.sql` e `03_atualizacao_v3.sql`, nessa ordem.
2. Authentication › Users: criar os usuários do escritório; depois desativar novos cadastros (Sign-ups).
3. Edge Functions: publicar as quatro funções com a opção *Verify JWT* indicada acima.
4. Edge Functions › Secrets: criar `CRON_SECRET` com uma senha longa e aleatória.
5. SQL Editor: guardar a **mesma** senha no cofre, uma única vez:
   `select vault.create_secret('SUA_SENHA', 'djen_cron_secret');`
6. SQL Editor: rodar `04_agendamento_robo.sql`.

## Publicação (Netlify)

Add new site › Import an existing project › GitHub › `crm-guerra-torres`.
A pasta publicada (`site`) já vem definida no `netlify.toml`; não há comando de build.
Cada commit na branch `main` gera novo deploy automaticamente.

## Google Agenda / Drive

Funcionam somente com o sistema publicado (não em `file://`). Criar um OAuth Client ID
(Google Cloud Console, APIs Calendar e Drive), autorizar o domínio do Netlify como
*Authorized JavaScript origin* e colar o Client ID em Configurações do CRM.

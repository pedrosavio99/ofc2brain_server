-- =====================================================================
-- 2brain - modulo CONVERSA (schema Supabase)
-- Rode isto uma vez no SQL Editor do Supabase.
--
-- NAO toca em `ideias` nem em `match_ideias`. A busca semantica que
-- alimenta insight, pesquisa e relink continua exatamente como esta.
-- O modulo so LE aquela tabela, pela funcao que ja existe.
--
-- Tudo idempotente: rodar de novo nao apaga nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A alma. UMA linha, sempre. E o destilado, nao o log.
-- O log fica em conversa_turnos e existe pra poder redestilar depois.
-- ---------------------------------------------------------------------
create table if not exists alma (
  id             text primary key default 'unica',
  perfil         text        not null default '',
  versao         int         not null default 0,
  turnos_lidos   int         not null default 0,
  atualizado_em  timestamptz not null default now(),
  constraint alma_linha_unica check (id = 'unica')
);

insert into alma (id) values ('unica') on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Sessoes de conversa.
-- ---------------------------------------------------------------------
create table if not exists conversas (
  id             uuid primary key default gen_random_uuid(),
  titulo         text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists conversas_atualizado_idx
  on conversas (atualizado_em desc);

-- ---------------------------------------------------------------------
-- Turnos.
--
-- texto     = a forma achatada, e o que vai pro prompt como historico
-- mensagens = como a resposta foi entregue na tela (array de baloes).
--             So o papel 'cerebro' preenche. Nao e duplicata do texto:
--             um serve pro modelo, o outro pro ritmo da tela e, depois,
--             pro TTS, que fala por mensagem.
-- notas_usadas = ids das notas que a tunnel vision trouxe naquele turno.
--             Guardado pra saber DE ONDE ele tirou o que disse.
--
-- expira_em: 90 dias. O destilado na alma e pra sempre, o cru nao.
-- ---------------------------------------------------------------------
create table if not exists conversa_turnos (
  id            uuid primary key default gen_random_uuid(),
  conversa_id   uuid not null references conversas(id) on delete cascade,
  ordem         int  not null,
  papel         text not null check (papel in ('pessoa', 'cerebro')),
  texto         text not null,
  mensagens     jsonb not null default '[]'::jsonb,
  notas_usadas  jsonb not null default '[]'::jsonb,
  meta          jsonb not null default '{}'::jsonb,
  criado_em     timestamptz not null default now(),
  expira_em     timestamptz not null default (now() + interval '90 days'),
  constraint conversa_turnos_ordem_uniq unique (conversa_id, ordem)
);

create index if not exists conversa_turnos_conversa_idx
  on conversa_turnos (conversa_id, ordem);

create index if not exists conversa_turnos_expira_idx
  on conversa_turnos (expira_em);

-- ---------------------------------------------------------------------
-- Toda insercao de turno marca a conversa como mexida. Fica no banco e
-- nao no app de proposito: em serverless o app esquece, o trigger nao.
-- ---------------------------------------------------------------------
create or replace function toca_conversa()
returns trigger language plpgsql as $$
begin
  update conversas set atualizado_em = now() where id = new.conversa_id;
  return new;
end;
$$;

drop trigger if exists conversa_turnos_toca on conversa_turnos;
create trigger conversa_turnos_toca
  after insert on conversa_turnos
  for each row execute function toca_conversa();

-- ---------------------------------------------------------------------
-- Faxina do cru vencido. Devolve quantos saiu. Chamar quando quiser
-- (cron do Supabase, ou na mao). Nao apaga conversa nem alma.
-- ---------------------------------------------------------------------
create or replace function limpar_turnos_expirados()
returns int language sql as $$
  with apagados as (
    delete from conversa_turnos where expira_em < now() returning 1
  )
  select count(*)::int from apagados;
$$;

-- ---------------------------------------------------------------------
-- Proximo numero de ordem de uma conversa. Evita corrida entre a
-- gravacao do turno da pessoa e a do cerebro no mesmo instante.
-- ---------------------------------------------------------------------
create or replace function proxima_ordem(p_conversa uuid)
returns int language sql stable as $$
  select coalesce(max(ordem), 0) + 1 from conversa_turnos where conversa_id = p_conversa;
$$;

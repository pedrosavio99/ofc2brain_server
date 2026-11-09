-- =====================================================================
-- TrendRadar v2: radar VIVO (dados reais que mudam todo dia).
-- Rode UMA vez no SQL Editor do Supabase. E idempotente (pode rodar de novo).
--
-- O que guarda:
--   radar_pulso       foto diaria de cada oportunidade: mencoes na imprensa nos
--                     ultimos 7 dias vs 7 dias antes + manchetes reais. E daqui
--                     que sai o historico real (cresce todo dia).
--   radar_descobertas sinais NOVOS que o radar achou sozinho (com as manchetes
--                     que sustentam cada um e a nota sua que combina).
--   radar_itens       oportunidades que voce pesquisou/alterou (antes ficavam
--                     num arquivo local, que a Vercel apaga a cada cold start).
--   radar_coletas     registro de cada rodada de coleta (pra saber se esta viva).
--
-- Seguranca: RLS ligado e SEM politicas = so o service_role (seu servidor) le e
-- escreve. O navegador nunca fala direto com estas tabelas.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.radar_pulso (
  item_id         text        not null,
  dia             date        not null,
  mencoes_7d      integer     not null default 0,
  mencoes_prev_7d integer     not null default 0,
  manchetes       jsonb       not null default '[]'::jsonb,
  coletado_em     timestamptz not null default now(),
  primary key (item_id, dia)
);
create index if not exists radar_pulso_dia_idx on public.radar_pulso (dia desc);

create table if not exists public.radar_descobertas (
  id             uuid        primary key default gen_random_uuid(),
  chave          text        not null unique,   -- termo normalizado: nao repete o mesmo assunto
  titulo         text        not null,
  frente         text        not null,
  termo          text        not null,
  dor            text,
  porque_agora   text,
  sinais         jsonb       not null default '[]'::jsonb,  -- [{titulo, fonte, url, data}]
  afinidade      jsonb,                                      -- {nota_id, resumo, data, score}
  status         text        not null default 'nova'
                 check (status in ('nova', 'salva', 'descartada', 'investigada')),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists radar_descobertas_status_idx on public.radar_descobertas (status, criado_em desc);

create table if not exists public.radar_itens (
  id             text        primary key,
  dados          jsonb       not null,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.radar_coletas (
  id           bigserial   primary key,
  iniciado_em  timestamptz not null default now(),
  duracao_ms   integer,
  itens        integer     not null default 0,
  novas        integer     not null default 0,
  erros        jsonb       not null default '[]'::jsonb
);
create index if not exists radar_coletas_em_idx on public.radar_coletas (iniciado_em desc);

alter table public.radar_pulso       enable row level security;
alter table public.radar_descobertas enable row level security;
alter table public.radar_itens       enable row level security;
alter table public.radar_coletas     enable row level security;

-- Limpeza automatica fica a cargo do app (mantem 120 dias de pulso).

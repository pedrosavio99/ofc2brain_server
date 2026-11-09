-- =====================================================================
-- TrendRadar v2: radar VIVO (so dado real, nada de catalogo fixo).
-- Rode UMA vez no SQL Editor do Supabase. E idempotente (pode rodar de novo).
--
-- O que guarda:
--   radar_descobertas tudo que aparece na tela do radar. Tres origens:
--                       radar     achado sozinho pela coleta diaria (manchetes reais)
--                       pesquisa  um alvo que voce pesquisou (dossie + manchetes reais)
--                       csv       serie do Google Trends que voce importou
--   radar_pulso       foto diaria de cada alvo: materias na imprensa nos ultimos
--                     7 dias vs 7 dias antes + manchetes. E daqui que sai o
--                     historico real (cresce todo dia).
--   radar_coletas     registro de cada rodada de coleta (pra saber se esta viva).
--
-- Seguranca: RLS ligado e SEM politicas = so o service_role (seu servidor) le e
-- escreve. O navegador nunca fala direto com estas tabelas.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.radar_pulso (
  item_id         text        not null,          -- 'c:' || chave do alvo
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
  origem         text        not null default 'radar'
                 check (origem in ('radar', 'pesquisa', 'csv')),
  dossie         jsonb,                                      -- hipoteses da IA (concorrentes, plano...), quando investigado
  serie          jsonb,                                      -- serie REAL (Google Trends via SerpApi ou CSV): [{data, valor}]
  regioes        jsonb,                                      -- regioes REAIS (SerpApi), nunca estimadas
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
-- se voce ja rodou a versao anterior deste arquivo, estas linhas completam a tabela:
alter table public.radar_descobertas add column if not exists origem  text not null default 'radar';
alter table public.radar_descobertas add column if not exists dossie  jsonb;
alter table public.radar_descobertas add column if not exists serie   jsonb;
alter table public.radar_descobertas add column if not exists regioes jsonb;
do $$ begin
  alter table public.radar_descobertas
    add constraint radar_descobertas_origem_check check (origem in ('radar', 'pesquisa', 'csv'));
exception when duplicate_object then null; end $$;

create index if not exists radar_descobertas_status_idx on public.radar_descobertas (status, criado_em desc);

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
alter table public.radar_coletas     enable row level security;

-- A versao anterior criava radar_itens (catalogo fixo + itens). Nao e mais usada.
-- Se existir e estiver vazia ou so com lixo, pode apagar:  drop table if exists public.radar_itens;

-- Limpeza automatica fica a cargo do app (mantem 120 dias de pulso).

-- Modulo TREINO - metas pessoais (objetivos) e ficha sob medida.
-- Rode UMA VEZ no SQL Editor do Supabase. E seguro rodar de novo: tudo aqui
-- usa "if not exists" / "drop constraint if exists".
--
-- O que muda:
--   1. treino_objetivos        as metas: "correr 10 km", "mais ombro e peito"...
--   2. treino_objetivo_marcos  medidas que VOCE registra (km corridos, cm...).
--                              Nada aqui e estimado: so o que voce digitou.
--   3. treino_ciclos.grupos    series por grupo muscular de cada ciclo, pra
--                              comparar volume de ciclo contra ciclo mesmo
--                              depois que as sessoes de 14 dias sao podadas.
--   4. treino_sessoes.objetivo_id  liga uma ficha extra a meta que a pediu.
--
-- Ate rodar este arquivo o app continua funcionando: a tela de metas mostra o
-- aviso "rode supabase/treino-objetivos.sql" e o resto do treino nao muda.

-- ------------------------------------------------------------ objetivos
create table if not exists treino_objetivos (
  id             uuid primary key default gen_random_uuid(),
  titulo         text not null,
  -- 'corrida' tem alvo em km; 'musculo' mira grupos musculares; 'outro' e livre
  tipo           text not null default 'outro',
  -- so para tipo 'musculo': de 1 a 3 grupos (ombro, peito, ...)
  grupos         text[] default '{}',
  -- alvo numerico opcional (10 km, 120 cm...). Sem alvo a meta so orienta a ficha.
  meta_valor     numeric(8,2),
  unidade        text default '',
  -- de onde voce partiu ("hoje corro 3 km"). E a base da barra de progresso.
  valor_inicial  numeric(8,2),
  prazo          date,
  status         text not null default 'ativo',
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now(),
  concluido_em   timestamptz
);

alter table treino_objetivos drop constraint if exists treino_objetivos_tipo_check;
alter table treino_objetivos add constraint treino_objetivos_tipo_check
  check (tipo in ('corrida', 'musculo', 'outro'));

alter table treino_objetivos drop constraint if exists treino_objetivos_status_check;
alter table treino_objetivos add constraint treino_objetivos_status_check
  check (status in ('ativo', 'concluido', 'arquivado'));

create index if not exists idx_treino_objetivos_status on treino_objetivos(status);

-- ------------------------------------------------------------- marcos
-- Uma linha a cada vez que voce registra uma medida. Pouquissimas por mes,
-- entao nao entram na poda: sao o grafico de progresso da meta.
create table if not exists treino_objetivo_marcos (
  id           uuid primary key default gen_random_uuid(),
  objetivo_id  uuid not null references treino_objetivos(id) on delete cascade,
  valor        numeric(8,2) not null,
  nota         text default '',
  criado_em    timestamptz default now()
);

create index if not exists idx_treino_marcos_objetivo
  on treino_objetivo_marcos(objetivo_id, criado_em desc);

-- ------------------------------------------- series por grupo no ciclo
-- { "ombro": 14, "peito": 9.5, ... } gravado quando o ciclo fecha.
alter table treino_ciclos
  add column if not exists grupos jsonb not null default '{}'::jsonb;

-- ---------------------------------------- ficha extra ligada a uma meta
alter table treino_sessoes
  add column if not exists objetivo_id uuid references treino_objetivos(id) on delete set null;

-- ------------------------------------------------------------ seguranca
-- Mesma regra dos outros modulos: sem policy nenhuma, a chave publica (anon)
-- nao enxerga estas tabelas. So o servidor, com a chave secreta, le e grava.
alter table treino_objetivos       enable row level security;
alter table treino_objetivo_marcos enable row level security;

-- Modulo REFEICAO - tabelas. Rode UMA VEZ no SQL Editor do Supabase.
--
-- Sem vetor: este modulo nao usa busca semantica. Mesmo desenho do treino:
-- o registro vive 14 dias (a janela), depois vira uma linha de resumo em
-- refeicao_ciclos e e podado.
--
-- Os itens ficam em jsonb DENTRO da refeicao, nao em tabela separada: a
-- gravacao e atomica numa chamada so do supabase-js, e como a linha vive so
-- 14 dias, consulta por alimento nao compensa o custo de duas tabelas.
-- Cada item guarda gramas e valores por 100 g, que sao a fonte de verdade:
-- da pra recalcular qualquer total se a regra mudar.

create table if not exists refeicao_refeicoes (
  id            uuid primary key default gen_random_uuid(),
  -- dia LOCAL (FUSO_MINUTOS), decidido pelo servidor. Nao e timestamp:
  -- as 22h ainda e hoje.
  data          date not null,
  tipo          text not null default 'outro',
  -- P/M/G do prato. Existia no cache e tinha ficado fora do schema proposto.
  tamanho       text not null default 'media',
  -- o que voce escreveu, pra reauditar depois
  texto         text not null default '',
  -- [{ nome, gramas, porcao_fonte, medida, por100:{kcal,proteina,carbo,gordura},
  --    kcal, proteina, carbo, gordura, confianca, conferir, observacao }]
  itens         jsonb not null default '[]'::jsonb,
  -- totais desnormalizados: o grafico de dias e o ciclo somam colunas,
  -- sem abrir o jsonb. O servidor recalcula tudo antes de gravar.
  kcal          integer not null default 0,
  proteina      numeric(6,1) not null default 0,
  carbo         numeric(6,1) not null default 0,
  gordura       numeric(6,1) not null default 0,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

alter table refeicao_refeicoes drop constraint if exists refeicao_tamanho_check;
alter table refeicao_refeicoes add constraint refeicao_tamanho_check
  check (tamanho in ('pequena', 'media', 'grande'));

create index if not exists idx_refeicao_data on refeicao_refeicoes(data);

-- --------------------------------------------------------------- ciclos
-- O que sobra quando a refeicao e podada. Uma linha por quinzena.
create table if not exists refeicao_ciclos (
  id              uuid primary key default gen_random_uuid(),
  inicio          date not null,
  fim             date not null,
  -- quantas refeicoes e em quantos dias houve registro: 20 refeicoes em 5
  -- dias e historia diferente de 20 em 14
  refeicoes       integer not null default 0,
  dias            integer not null default 0,
  kcal            integer not null default 0,
  proteina        numeric(8,1) not null default 0,
  carbo           numeric(8,1) not null default 0,
  gordura         numeric(8,1) not null default 0,
  -- media por DIA REGISTRADO, nao por dia corrido: dia sem registro nao
  -- derruba a media
  media_kcal_dia  integer not null default 0,
  criado_em       timestamptz not null default now()
);

-- E este indice que faz o fechamento ser idempotente: rodar duas vezes nao
-- duplica ciclo (o upsert com ignoreDuplicates engole o repetido).
create unique index if not exists idx_refeicao_ciclos_inicio on refeicao_ciclos(inicio);

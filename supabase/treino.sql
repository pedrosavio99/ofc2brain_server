-- Modulo TREINO - tabelas. Rode UMA VEZ no SQL Editor do Supabase.
--
-- Nenhuma tabela tem vetor: este modulo nao usa busca semantica. Por isso ele
-- e barato. Uma sessao com ficha em JSON da uns 2 KB.
--
-- Uma pessoa so, seguindo o padrao da tabela alma: linha unica com id fixo.
--
-- Ciclo de 14 dias e a unidade de tudo: a janela que a IA le, o lembrete de
-- pesagem e o fechamento. Sessao vive 14 dias; o resumo do ciclo fica.

-- ---------------------------------------------------------------- perfil
create table if not exists treino_perfil (
  id             text primary key default 'unico',
  nascimento     date,
  altura_cm      integer,
  -- Mifflin-St Jeor muda uns 166 kcal conforme o sexo. So afeta o gasto basal,
  -- que e contexto ("equivale a X% do seu dia"), nunca a caloria do treino.
  sexo           text,
  peso_kg        numeric(5,2),
  -- quando o peso foi atualizado. E daqui que sai o lembrete de 14 dias.
  peso_em        timestamptz,
  -- lesao, limitacao, o que evitar. Vai no prompt da ficha.
  restricoes     text default '',
  nivel          text default 'iniciante',
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now()
);

alter table treino_perfil drop constraint if exists treino_perfil_sexo_check;
alter table treino_perfil add constraint treino_perfil_sexo_check
  check (sexo is null or sexo in ('M', 'F'));

alter table treino_perfil drop constraint if exists treino_perfil_nivel_check;
alter table treino_perfil add constraint treino_perfil_nivel_check
  check (nivel in ('iniciante', 'intermediario', 'avancado'));

-- ------------------------------------------------------------- pesagens
-- Uma linha a cada 14 dias: 26 por ano, uns 2 KB no total. Sao elas que
-- permitem o grafico de peso, entao nao entram na poda.
create table if not exists treino_pesagens (
  id         uuid primary key default gen_random_uuid(),
  peso_kg    numeric(5,2) not null,
  criado_em  timestamptz default now()
);

create index if not exists idx_treino_pesagens_data on treino_pesagens(criado_em desc);

-- --------------------------------------------------------- equipamentos
-- O que voce tem em casa. O resumo, o como usar e o MET sao gerados pela Groq
-- no cadastro e CONFIRMADOS por voce antes de salvar.
create table if not exists treino_equipamentos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  tipo           text,
  resumo         text default '',
  como_usar      text default '',
  grupos         text[] default '{}',
  -- MET: o multiplicador de gasto do exercicio. E o numero que faz a conta de
  -- caloria ser conta, e nao chute do modelo.
  met            numeric(4,2),
  gerado_por_ia  smallint default 1,
  ativo          smallint default 1,
  criado_em      timestamptz default now(),
  atualizado_em  timestamptz default now()
);

create index if not exists idx_treino_equip_ativo on treino_equipamentos(ativo);

-- -------------------------------------------------------------- sessoes
-- Um treino. Vive 14 dias e depois e podada; o que sobra e a linha do ciclo.
create table if not exists treino_sessoes (
  id            uuid primary key default gen_random_uuid(),
  data          date not null default current_date,
  -- ficha: [{ id, nome, equipamento_id, series, reps, descanso_s, met }, ...]
  -- o id por item e o que permite marcar treino cumprido pela metade
  ficha         jsonb not null default '[]'::jsonb,
  -- por que a IA montou essa ficha, olhando os 14 dias anteriores
  motivo        text default '',
  -- ids dos itens que voce marcou como feitos
  feitos        jsonb not null default '[]'::jsonb,
  duracao_min   integer,
  calorias      integer,
  esforco       text,
  observacao    text default '',
  concluida     smallint default 0,
  -- 'ficha' = gerada pela IA; 'manual' = atividade que voce lancou na mao
  -- 'extra' = ficha a mais no dia, gerada a partir do que voce disse que quer treinar
  origem        text default 'ficha',
  -- quando voce manda gerar de novo, a anterior fica e aponta pra nova
  regerada_de   uuid references treino_sessoes(id) on delete set null,
  criado_em     timestamptz default now()
);

alter table treino_sessoes drop constraint if exists treino_sessoes_esforco_check;
alter table treino_sessoes add constraint treino_sessoes_esforco_check
  check (esforco is null or esforco in ('leve', 'moderado', 'pesado'));

alter table treino_sessoes drop constraint if exists treino_sessoes_origem_check;
alter table treino_sessoes add constraint treino_sessoes_origem_check
  check (origem in ('ficha', 'manual', 'extra'));

create index if not exists idx_treino_sessoes_data on treino_sessoes(data desc);

-- --------------------------------------------------------------- ciclos
-- O que sobra quando a sessao e podada. Uma linha por quinzena: 26 por ano.
-- Sem isto, progresso de ciclo contra ciclo seria impossivel.
create table if not exists treino_ciclos (
  id             uuid primary key default gen_random_uuid(),
  inicio         date not null,
  fim            date not null,
  treinos        integer default 0,
  minutos        integer default 0,
  calorias       integer default 0,
  esforco_medio  numeric(3,2),
  peso_kg        numeric(5,2),
  criado_em      timestamptz default now()
);

create unique index if not exists idx_treino_ciclos_inicio on treino_ciclos(inicio);

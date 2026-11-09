-- =====================================================================
-- 2brain - modulo CONVERSA v2: busca hibrida + memoria de fatos
-- Rode UMA vez no SQL Editor do Supabase. Tudo idempotente: rodar de novo
-- nao apaga nada.
--
-- O que isto adiciona (nada existente e alterado ou removido):
--   1. busca por PALAVRA (full-text em portugues, sem acento) ao lado da busca
--      por significado que ja existe. Nomes proprios, siglas e termos raros
--      so a busca por palavra acha; ideia vaga so a por significado acha.
--      As duas se fundem por RRF (Reciprocal Rank Fusion).
--   2. a tabela `memorias`: fatos duraveis sobre a pessoa (projetos, pessoas,
--      rotina, decisoes). E o que faz ele "lembrar de voce" entre conversas.
--   3. busca por palavra nos turnos de conversas passadas.
--
-- Se algo nao for rodado, o app continua funcionando: ele detecta que a
-- funcao nao existe e cai na busca por significado de antes.
-- =====================================================================

create extension if not exists vector;

-- unaccent vive no schema `extensions` no Supabase.
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- Helpers imutaveis. O Postgres so aceita funcao IMMUTABLE em indice, e a
-- unaccent original e STABLE. O embrulho e o jeito padrao de contornar.
-- ---------------------------------------------------------------------
create or replace function f_unaccent(t text)
returns text language sql immutable parallel safe strict
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, t) $$;

-- O texto de uma nota que entra na busca por palavra: resumo + texto + tags.
create or replace function ideias_texto_busca(resumo text, texto text, tags text[])
returns text language sql immutable parallel safe
as $$
  select coalesce(resumo, '') || ' ' || coalesce(texto, '') || ' ' ||
         coalesce(array_to_string(tags, ' '), '')
$$;

-- ---------------------------------------------------------------------
-- Indices de busca por palavra
-- ---------------------------------------------------------------------
create index if not exists ideias_fts_idx
  on ideias using gin (to_tsvector('portuguese', f_unaccent(ideias_texto_busca(resumo, texto_original, tags))));

create index if not exists conversa_turnos_fts_idx
  on conversa_turnos using gin (to_tsvector('portuguese', f_unaccent(texto)));

-- ---------------------------------------------------------------------
-- Memorias: fatos atomicos e duraveis. Escritos em frase curta e sem sujeito
-- ("Mora em Recife", "Prepara entrevista na empresa X"), pra nao depender de
-- genero nem de pronome.
--   fixado     = voce escreveu ou travou: o sistema nunca reescreve nem apaga
--   ativo      = false e "apagado" sem perder o historico (o sistema nunca
--                faz DELETE de verdade; so voce, pela tela)
--   valido_ate = fato temporario ("viaja dia 12") deixa de valer sozinho
-- ---------------------------------------------------------------------
create table if not exists memorias (
  id               uuid primary key default gen_random_uuid(),
  fato             text not null,
  categoria        text not null default 'outro',
  importancia      smallint not null default 3 check (importancia between 1 and 5),
  fixado           boolean not null default false,
  ativo            boolean not null default true,
  valido_ate       date,
  embedding        vector(768),
  origem_conversa  uuid,
  origem_ordem     int,
  vezes_usada      int not null default 0,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  ultimo_uso       timestamptz
);

create index if not exists memorias_ativas_idx
  on memorias (ativo, importancia desc, atualizado_em desc);

create index if not exists memorias_embedding_idx
  on memorias using hnsw (embedding vector_cosine_ops);

create index if not exists memorias_fts_idx
  on memorias using gin (to_tsvector('portuguese', f_unaccent(fato)));

-- ---------------------------------------------------------------------
-- Busca hibrida nas NOTAS.
--   q_lex  consulta ja em sintaxe de tsquery, com OR: 'jiu | jitsu | entrevista'
--          (o app monta isso; null desliga a parte por palavra)
--   q_emb  embedding como texto '[0.1,...]' (null desliga a parte por significado)
-- Devolve a nota inteira (sem o vetor), pra o app nao precisar de uma segunda
-- ida ao banco por nota. `sim` e o cosseno com a pergunta, calculado pra TODA
-- linha devolvida, tenha ela vindo da busca por palavra ou por significado.
-- ---------------------------------------------------------------------
create or replace function buscar_notas_hibrido(
  q_lex  text  default null,
  q_emb  text  default null,
  k      int   default 30,
  w_vec  float default 1.0,
  w_lex  float default 0.7
)
returns table (
  id uuid, resumo text, texto_original text, area text, tags text[], tipo text,
  data_evento text, criado_em timestamptz,
  sim float, lex_rank int, rrf float
)
language sql stable
as $$
  with q as (
    select
      case when q_lex is null or btrim(q_lex) = '' then null
           else to_tsquery('portuguese', q_lex) end as tsq,
      case when q_emb is null then null else q_emb::vector end as v
  ),
  vec as (
    select i.id, 1 - (i.embedding <=> q.v) as sim,
           row_number() over (order by i.embedding <=> q.v) as r
    from ideias i, q
    where q.v is not null and i.embedding is not null
    order by i.embedding <=> q.v
    limit k * 2
  ),
  lex as (
    select i.id,
           row_number() over (
             order by ts_rank_cd(
               to_tsvector('portuguese', f_unaccent(ideias_texto_busca(i.resumo, i.texto_original, i.tags))),
               q.tsq) desc
           ) as r
    from ideias i, q
    where q.tsq is not null
      and to_tsvector('portuguese', f_unaccent(ideias_texto_busca(i.resumo, i.texto_original, i.tags))) @@ q.tsq
    order by ts_rank_cd(
               to_tsvector('portuguese', f_unaccent(ideias_texto_busca(i.resumo, i.texto_original, i.tags))),
               q.tsq) desc
    limit k * 2
  ),
  fundido as (
    select coalesce(vec.id, lex.id) as id,
           vec.sim,
           lex.r as lex_r,
           coalesce(w_vec / (60.0 + vec.r), 0) + coalesce(w_lex / (60.0 + lex.r), 0) as rrf
    from vec full outer join lex on vec.id = lex.id
  )
  select i.id, i.resumo, i.texto_original, i.area, i.tags, i.tipo, i.data_evento, i.criado_em,
         coalesce(f.sim, case when i.embedding is not null and (select v from q) is not null
                              then 1 - (i.embedding <=> (select v from q)) end)::float as sim,
         f.lex_r::int as lex_rank,
         f.rrf::float as rrf
  from fundido f
  join ideias i on i.id = f.id
  order by f.rrf desc
  limit k;
$$;

-- ---------------------------------------------------------------------
-- Busca hibrida nas MEMORIAS (so as ativas e ainda validas).
-- ---------------------------------------------------------------------
create or replace function buscar_memorias_hibrido(
  q_lex  text  default null,
  q_emb  text  default null,
  k      int   default 8,
  w_vec  float default 1.0,
  w_lex  float default 0.7
)
returns table (
  id uuid, fato text, categoria text, importancia smallint, fixado boolean,
  criado_em timestamptz, atualizado_em timestamptz,
  sim float, lex_rank int, rrf float
)
language sql stable
as $$
  with q as (
    select
      case when q_lex is null or btrim(q_lex) = '' then null
           else to_tsquery('portuguese', q_lex) end as tsq,
      case when q_emb is null then null else q_emb::vector end as v
  ),
  vivas as (
    select * from memorias m
    where m.ativo and (m.valido_ate is null or m.valido_ate >= current_date)
  ),
  vec as (
    select m.id, 1 - (m.embedding <=> q.v) as sim,
           row_number() over (order by m.embedding <=> q.v) as r
    from vivas m, q
    where q.v is not null and m.embedding is not null
    order by m.embedding <=> q.v
    limit k * 2
  ),
  lex as (
    select m.id,
           row_number() over (
             order by ts_rank_cd(to_tsvector('portuguese', f_unaccent(m.fato)), q.tsq) desc
           ) as r
    from vivas m, q
    where q.tsq is not null
      and to_tsvector('portuguese', f_unaccent(m.fato)) @@ q.tsq
    order by ts_rank_cd(to_tsvector('portuguese', f_unaccent(m.fato)), q.tsq) desc
    limit k * 2
  ),
  fundido as (
    select coalesce(vec.id, lex.id) as id, vec.sim, lex.r as lex_r,
           coalesce(w_vec / (60.0 + vec.r), 0) + coalesce(w_lex / (60.0 + lex.r), 0) as rrf
    from vec full outer join lex on vec.id = lex.id
  )
  select m.id, m.fato, m.categoria, m.importancia, m.fixado, m.criado_em, m.atualizado_em,
         coalesce(f.sim, case when m.embedding is not null and (select v from q) is not null
                              then 1 - (m.embedding <=> (select v from q)) end)::float as sim,
         f.lex_r::int as lex_rank,
         f.rrf::float as rrf
  from fundido f
  join memorias m on m.id = f.id
  order by f.rrf desc
  limit k;
$$;

-- ---------------------------------------------------------------------
-- Busca por palavra nos turnos de conversas passadas (fora a conversa atual,
-- que o app ja manda inteira como historico).
-- ---------------------------------------------------------------------
create or replace function buscar_turnos_fts(
  q_lex             text,
  excluir_conversa  uuid default null,
  k                 int  default 8
)
returns table (conversa_id uuid, ordem int, papel text, texto text, criado_em timestamptz, rank float)
language sql stable
as $$
  with q as (select to_tsquery('portuguese', q_lex) as tsq)
  select t.conversa_id, t.ordem, t.papel, t.texto, t.criado_em,
         ts_rank_cd(to_tsvector('portuguese', f_unaccent(t.texto)), q.tsq)::float as rank
  from conversa_turnos t, q
  where q_lex is not null and btrim(q_lex) <> ''
    and (excluir_conversa is null or t.conversa_id <> excluir_conversa)
    and to_tsvector('portuguese', f_unaccent(t.texto)) @@ q.tsq
  order by rank desc, t.criado_em desc
  limit k;
$$;

-- ---------------------------------------------------------------------
-- Seguranca. Tabela nova no schema public fica exposta pela API publica do
-- Supabase se o RLS estiver desligado. Ligado e sem politica, so a chave de
-- servidor (a que o app usa) enxerga. As funcoes leem dados pessoais, entao
-- so a chave de servidor pode chama-las.
-- ---------------------------------------------------------------------
alter table memorias enable row level security;

revoke all on function buscar_notas_hibrido(text, text, int, float, float)    from public, anon, authenticated;
revoke all on function buscar_memorias_hibrido(text, text, int, float, float) from public, anon, authenticated;
revoke all on function buscar_turnos_fts(text, uuid, int)                     from public, anon, authenticated;
grant execute on function buscar_notas_hibrido(text, text, int, float, float)    to service_role;
grant execute on function buscar_memorias_hibrido(text, text, int, float, float) to service_role;
grant execute on function buscar_turnos_fts(text, uuid, int)                     to service_role;

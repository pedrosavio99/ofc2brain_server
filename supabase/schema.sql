-- =====================================================================
-- 2brain v2 - schema Supabase (Postgres + pgvector)
-- Rode isto uma vez no SQL Editor do Supabase (ou via psql).
-- Embeddings agora sao 768 dims (Gemini text-embedding-004).
-- =====================================================================

create extension if not exists vector;

create table if not exists ideias (
  id            uuid primary key,
  texto_original text not null,
  resumo        text,
  area          text,
  tags          text[]  default '{}',
  tipo          text    default 'ideia',
  data_evento   text,
  relacionados  jsonb   default '[]'::jsonb,
  criado_em     timestamptz default now(),
  atualizado_em timestamptz default now(),
  embedding     vector(768)
);

-- indice ANN pra busca por similaridade (cosseno). HNSW e o padrao recomendado.
create index if not exists ideias_embedding_idx
  on ideias using hnsw (embedding vector_cosine_ops);

create index if not exists ideias_criado_em_idx on ideias (criado_em);

-- =====================================================================
-- Busca top-K por similaridade de cosseno.
-- Recebe o vetor como TEXT ('[0.1,0.2,...]') e faz cast pra vector aqui
-- dentro: e o jeito mais robusto de passar vetor via PostgREST/rpc.
-- Devolve { id, score } ordenado por score desc, igual ao motor antigo.
-- =====================================================================
create or replace function match_ideias(
  query_embedding text,
  match_count int   default 10,
  piso float        default 0.3,
  excluir uuid      default null
)
returns table (id uuid, score float)
language sql stable
as $$
  select i.id, 1 - (i.embedding <=> query_embedding::vector) as score
  from ideias i
  where i.embedding is not null
    and (excluir is null or i.id <> excluir)
    and 1 - (i.embedding <=> query_embedding::vector) >= piso
  order by i.embedding <=> query_embedding::vector
  limit match_count;
$$;

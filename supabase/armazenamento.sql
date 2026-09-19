-- Tamanho real das suas tabelas, em bytes.
--
-- Existe como funcao porque o supabase-js nao roda SQL solto: ele so fala
-- PostgREST. Entao a consulta mora no banco e a API chama por rpc.
--
-- security definer + revoke: a funcao le catalogo do Postgres, entao roda com
-- privilegio do dono. Sem o revoke, qualquer chave anonima conseguiria medir
-- suas tabelas. So o service_role executa.
--
-- Rode UMA VEZ no SQL Editor do Supabase.

create or replace function armazenamento()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  with t as (
    select
      c.relname::text                     as nome,
      pg_total_relation_size(c.oid)       as total,
      pg_relation_size(c.oid)             as dados,
      pg_indexes_size(c.oid)              as indices,
      -- o que sobra e TOAST: onde vao os campos grandes demais pra linha,
      -- que no seu caso e o embedding e o texto longo
      pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid) as toast,
      coalesce(s.n_live_tup, 0)           as linhas,
      coalesce(s.n_dead_tup, 0)           as mortas
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public' and c.relkind = 'r'
  )
  select jsonb_build_object(
    -- banco inteiro, INCLUSIVE o que o Supabase instala sozinho (auth, storage,
    -- realtime, catalogos). E este numero que o painel mostra, e ele nao e seu.
    'banco_bytes', pg_database_size(current_database()),
    'banco',       pg_size_pretty(pg_database_size(current_database())),
    -- so o schema public: o que e seu de verdade
    'seu_bytes',   (select coalesce(sum(total), 0) from t),
    'seu',         pg_size_pretty((select coalesce(sum(total), 0) from t)),
    'tabelas', (
      select jsonb_agg(jsonb_build_object(
        'nome', nome, 'total', pg_size_pretty(total), 'total_bytes', total,
        'dados', pg_size_pretty(dados), 'indices', pg_size_pretty(indices),
        'toast', pg_size_pretty(toast),
        'linhas', linhas, 'linhas_mortas', mortas,
        'bytes_por_linha', case when linhas > 0 then (total / linhas) end
      ) order by total desc) from t where total > 0
    ),
    'medido_em', to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  );
$fn$;

revoke execute on function armazenamento() from public;
grant  execute on function armazenamento() to service_role;

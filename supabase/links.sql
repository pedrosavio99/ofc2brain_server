-- Modulo LINKS CURTOS - tabela. Rode UMA VEZ no SQL Editor do Supabase.
--
-- Guarda links longos e o link curto de cada um (is.gd, da.gd ou TinyURL).
-- Nao toca em `ideias` nem em nenhuma outra tabela.
--
-- servico  = quem gerou o link curto: 'isgd' | 'dagd' | 'tiny', ou 'manual'
--            quando voce colou um link curto feito fora do app.
-- alias    = o "final do endereco" pedido (is.gd e da.gd). Fica guardado pra
--            "Gerar de novo" conseguir repetir o mesmo nome.
-- curto_em = quando o link curto atual foi gerado. Serve pra mostrar a idade
--            e saber quais valem uma regeracao.
--
-- Idempotente: rodar de novo nao apaga nada.

create table if not exists links_curtos (
  id            uuid primary key default gen_random_uuid(),
  titulo        text        not null default '',
  url_longa     text        not null,
  url_curta     text,
  servico       text,
  alias         text,
  curto_em      timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table links_curtos drop constraint if exists links_curtos_servico_check;
alter table links_curtos add constraint links_curtos_servico_check
  check (servico is null or servico in ('isgd', 'dagd', 'tiny', 'manual'));

create index if not exists idx_links_curtos_criado on links_curtos (criado_em desc);

-- A API fala com o banco pela chave de servidor (que ignora RLS). Ligar o RLS
-- sem nenhuma policy fecha a tabela pra chave publica (anon): so o servidor
-- le e escreve.
alter table links_curtos enable row level security;

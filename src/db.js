// Armazenamento: Supabase (Postgres + pgvector). Ver src/db.supabase.js.
// O motor de arquivo antigo (db.file.js) continua no repo apenas como
// referencia/uso local, mas nao e mais usado pela API.
export {
  listarTodas,
  buscarPorId,
  salvar,
  atualizar,
  remover,
  topKSimilares,
  importarLegadoSeVazio,
  exportarBackup,
  restaurarBackup,
  compactar,
  estatisticas,
} from "./db.supabase.js";

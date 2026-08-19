// Entrada LOCAL (node src/server.js). Na Vercel quem manda e api/index.js.
import app from "./app.js";

const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Segundo Cerebro API (v2/supabase) em http://0.0.0.0:${PORT}`);
});

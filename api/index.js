// Entrada serverless da Vercel. O app Express e um handler (req,res),
// entao basta exporta-lo. As rotas continuam na raiz (/ideias, /pesquisa...)
// porque o vercel.json reescreve tudo que nao e arquivo estatico pra ca,
// preservando o path original em req.url.
import app from "../src/app.js";
export default app;

export function similaridadeCosseno(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let produtoEscalar = 0;
  let normaA = 0;
  let normaB = 0;

  for (let i = 0; i < a.length; i++) {
    produtoEscalar += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }

  if (normaA === 0 || normaB === 0) return 0;

  return produtoEscalar / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

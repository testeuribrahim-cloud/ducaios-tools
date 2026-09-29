// Remplace « openclaw/plugin-sdk/lazy-runtime » pour le code repris d'OpenClaw (alias de construction).

/** Charge un module au premier appel, puis rend toujours la même promesse (import mémorisé). */
export function createLazyRuntimeModule<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => (loaded ??= load());
}

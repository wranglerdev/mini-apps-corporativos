// Navegação entre projetos e links no navegador (espelho de Domain/Apps/Links.cs na parte de segurança).
// Testado em links.spec.ts.

/** Caminho do próprio site ("/x", nunca "//x"): abre pelo roteador, sem recarregar. */
export const isInternal = (url: string) => url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');

/** http(s) absoluto ou caminho do site. Qualquer outra coisa (javascript:, data:...) não abre. */
export const isSafeLink = (url: string | null | undefined) => !!url && (isInternal(url) || /^https?:\/\//i.test(url));

/**
 * Valores pré-preenchidos que vieram na URL (?Nome=Ana): só os que batem com um nome conhecido (campo do formulário ou
 * input da página), sem diferenciar maiúsculas, devolvidos com a grafia do nome.
 */
export function prefillFrom(query: Record<string, string | null | undefined>, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const name = names.find((n) => n.toLowerCase() === key.toLowerCase());
    if (name && value) out[name] = value;
  }
  return out;
}

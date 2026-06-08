/**
 * Normalisation systématique des emails avant toute comparaison :
 * trim + minuscules. À appliquer des DEUX côtés (liste .env / partage ET
 * saisie utilisateur).
 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

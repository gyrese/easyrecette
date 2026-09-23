/**
 * Sérialisation des petites listes stockées en colonnes texte.
 *
 * SQLite n'a pas de type tableau ; plutôt que de dépendre d'une extension
 * Postgres-only, on stocke du JSON texte. Le jour où l'on bascule sur
 * Postgres, seules ces deux fonctions changent (ou disparaissent).
 */

export function serializeList(value: readonly string[] | null | undefined): string {
  if (!value || value.length === 0) return '[]';
  return JSON.stringify(value);
}

export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function serializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

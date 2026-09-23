import { CATEGORY_LABELS, type Category, type Difficulty, type Platform } from './types';

/** Formatage d'affichage partagé par toutes les vues. */

/** 95 -> "1 h 35", 45 -> "45 min", null -> "—" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** Version courte pour les cartes : "1h35" */
export function formatDurationShort(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

export function formatServings(servings: number | null | undefined): string {
  if (!servings) return 'Portions non précisées';
  return servings === 1 ? '1 personne' : `${servings} personnes`;
}

export function categoryLabel(category: Category | string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category as Category] ?? category;
}

export function difficultyLabel(difficulty: Difficulty | null | undefined): string | null {
  if (!difficulty) return null;
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/** Niveau sur 3, pour un affichage en jauge plutôt qu'en étoiles. */
export function difficultyLevel(difficulty: Difficulty | null | undefined): number {
  switch (difficulty) {
    case 'facile':
      return 1;
    case 'moyen':
      return 2;
    case 'difficile':
      return 3;
    default:
      return 0;
  }
}

/** Secondes -> "08:00", pour le minuteur du mode cuisine. */
export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "2026-09-21T..." -> "21 septembre 2026" */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/** Nom d'hôte lisible : "https://www.marmiton.org/x" -> "marmiton.org" */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Phrase d'attribution affichée en bas de chaque recette importée (§13).
 * Ne jamais laisser croire que la recette est une création du site.
 */
export function attributionLine(source: {
  platform: Platform;
  author: string | null;
  url: string | null;
}): string | null {
  if (source.platform === 'manual' || !source.url) return null;

  if (source.author) {
    const handle = source.author.startsWith('@') ? source.author : `@${source.author}`;
    return `Recette adaptée depuis une publication de ${handle}`;
  }

  const host = hostOf(source.url);
  return host ? `Recette adaptée depuis ${host}` : 'Recette adaptée depuis une source externe';
}

/**
 * Image à afficher pour une recette.
 *
 * La photo de l'utilisateur passe devant celle de la source : quand on a
 * cuisiné le plat soi-même, c'est son propre résultat qu'on veut revoir dans
 * le fichier, pas la vignette léchée de la publication d'origine. Celle-ci
 * n'est jamais effacée pour autant — retirer sa photo rend la fiche à son
 * illustration de départ.
 */
export function displayImage(recipe: {
  userPhotoUrl: string | null;
  imageUrl: string | null;
}): string | null {
  return recipe.userPhotoUrl ?? recipe.imageUrl;
}

/**
 * Date d'essai en relatif court : « aujourd'hui », « il y a 3 jours »…
 *
 * Au-delà d'un mois la date exacte redevient plus parlante qu'un décompte,
 * d'où le repli sur formatDate().
 */
export function formatTriedAt(iso: string | null): string | null {
  if (!iso) return null;

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  // Comparaison au jour près : essayée hier soir et notée ce matin doit
  // afficher « hier », pas « il y a 14 heures ».
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  if (days < 14) return 'la semaine dernière';
  if (days < 31) return `il y a ${Math.floor(days / 7)} semaines`;

  return formatDate(iso);
}

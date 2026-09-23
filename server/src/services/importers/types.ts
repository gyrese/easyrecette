import type { ExtractedContent } from '../../schemas/import.js';
import type { Platform } from '../../schemas/recipe.js';

/**
 * Contrat d'un importer (§3).
 *
 * Un importer collecte, il n'interprète pas : il remplit ce qu'il peut,
 * laisse `null` le reste, et signale dans `notes` ce qu'il n'a pas pu obtenir.
 * C'est le pipeline qui décide ensuite si le résultat est exploitable.
 *
 * Ajouter une plateforme = écrire un module ici + l'enregistrer dans index.ts.
 * Aucun autre fichier ne doit changer.
 */
export interface Importer {
  platform: Platform;
  /** Libellé affiché dans l'UI. */
  label: string;
  supports(url: URL): boolean;
  fetchContent(url: string): Promise<ExtractedContent>;
}

/** Fabrique un résultat vide et cohérent, à compléter par l'importer. */
export function emptyContent(sourceUrl: string, platform: Platform): ExtractedContent {
  return {
    sourceUrl,
    platform,
    title: null,
    author: null,
    description: null,
    text: null,
    transcript: null,
    images: [],
    metadata: {},
    structuredRecipe: null,
    notes: [],
  };
}

/**
 * Y a-t-il assez de matière pour tenter une génération ?
 * En dessous de ce seuil, mieux vaut dire honnêtement qu'on n'a rien trouvé
 * et proposer la saisie manuelle plutôt que de faire halluciner l'IA.
 */
export const MIN_USABLE_TEXT_LENGTH = 80;

export function usableText(content: ExtractedContent): string | null {
  const parts = [content.transcript, content.text, content.description]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim());

  if (parts.length === 0) return null;

  const combined = parts.join('\n\n');
  if (combined.length < MIN_USABLE_TEXT_LENGTH) return null;

  // Une légende de réseau social est souvent « Titre du plat » suivi de vingt
  // hashtags. Elle dépasse le seuil de longueur sans rien contenir d'utile :
  // envoyer ça au modèle coûte un appel pour une fiche vide. On mesure donc
  // ce qui reste une fois les hashtags et mentions retirés.
  return hasSubstance(combined) ? combined : null;
}

/**
 * Le texte contient-il autre chose que des hashtags, des mentions et des
 * émojis ? Sert à écarter les légendes purement promotionnelles avant l'IA.
 */
export function hasSubstance(text: string): boolean {
  const stripped = text
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length >= MIN_USABLE_TEXT_LENGTH;
}

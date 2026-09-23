import type { ExtractedContent } from '../../schemas/import.js';
import type { Platform } from '../../schemas/recipe.js';
import { assertUrlIsSafe } from '../../utils/safeFetch.js';
import { facebookImporter } from './facebookImporter.js';
import { instagramImporter } from './instagramImporter.js';
import { cleanUrl, detectPlatform } from './platform.js';
import { tiktokImporter } from './tiktokImporter.js';
import type { Importer } from './types.js';
import { webImporter } from './webImporter.js';
import { youtubeImporter } from './youtubeImporter.js';

/**
 * Registre des importers.
 *
 * L'ordre compte : le premier dont `supports()` répond true gagne.
 * `webImporter` est volontairement en dernier — il accepte tout et sert de
 * repli universel.
 */
const IMPORTERS: Importer[] = [
  youtubeImporter,
  tiktokImporter,
  instagramImporter,
  facebookImporter,
  webImporter,
];

export function getImporter(url: URL): Importer {
  const importer = IMPORTERS.find((candidate) => candidate.supports(url));
  // webImporter accepte tout, donc ce cas n'arrive pas ; le fallback est là
  // pour satisfaire le typage sans `!`.
  return importer ?? webImporter;
}

/**
 * Valide l'URL, choisit l'adapter et récupère le contenu.
 * Les erreurs remontent telles quelles : c'est le pipeline qui les journalise.
 */
export async function fetchFromUrl(
  rawUrl: string,
): Promise<{ content: ExtractedContent; importer: Importer }> {
  const cleaned = cleanUrl(rawUrl);
  const url = await assertUrlIsSafe(cleaned);
  const importer = getImporter(url);
  const content = await importer.fetchContent(url.toString());
  return { content, importer };
}

export { detectPlatform, cleanUrl };
export type { Importer, Platform };
export { usableText, MIN_USABLE_TEXT_LENGTH } from './types.js';

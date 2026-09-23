import { safeFetch } from '../../utils/safeFetch.js';
import { appError } from '../../utils/errors.js';
import { extractFromHtml } from './htmlExtract.js';
import { emptyContent, type Importer } from './types.js';

/**
 * Importer générique pour blogs, sites de recettes et toute page web.
 *
 * C'est aussi le repli universel : si une plateforme n'a pas d'adapter dédié,
 * on passe par ici. Il ne fait rien de spécial à part appliquer la cascade
 * d'extraction de htmlExtract.ts.
 */
export const webImporter: Importer = {
  platform: 'web',
  label: 'Web',

  supports() {
    // Dernier de la chaîne : accepte tout ce que les autres ont refusé.
    return true;
  },

  async fetchContent(url) {
    const response = await safeFetch(url);
    const content = emptyContent(response.url, 'web');

    if (!response.body.trim()) {
      throw appError('NO_CONTENT', { canRetryManually: true });
    }

    const extracted = extractFromHtml(response.body, response.url);

    content.title = extracted.title;
    content.description = extracted.description;
    content.author = extracted.author;
    content.text = extracted.text;
    content.images = extracted.images;
    content.structuredRecipe = extracted.structuredRecipe;
    content.metadata = {
      ...extracted.metadata,
      httpStatus: response.status,
      contentType: response.contentType,
      truncated: response.truncated,
    };

    if (extracted.structuredRecipe) {
      content.notes.push('Recette structurée trouvée dans la page (Schema.org).');
    }
    if (response.truncated) {
      content.notes.push('Page volumineuse : seule une partie a été analysée.');
    }
    if (!extracted.text && !extracted.structuredRecipe) {
      content.notes.push("Le corps de l'article n'a pas pu être isolé proprement.");
    }

    return content;
  },
};

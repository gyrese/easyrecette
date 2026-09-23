import { appError } from '../../utils/errors.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { extractFromHtml } from './htmlExtract.js';
import { emptyContent, type Importer } from './types.js';

/**
 * Importer TikTok.
 *
 * Ce qui est réellement accessible sans compte développeur ni scraping agressif :
 *   - oEmbed officiel (https://www.tiktok.com/oembed) : titre = légende du post,
 *     auteur, miniature. C'est documenté, public, et stable ;
 *   - les balises OpenGraph de la page, en complément.
 *
 * Ce qui n'est PAS accessible : la piste audio et donc une transcription. Il
 * n'existe pas de moyen autorisé de la récupérer côté serveur. On ne prétend
 * donc jamais avoir « analysé la vidéo » : l'étape correspondante est marquée
 * `skipped` et l'utilisateur est prévenu que seule la légende a servi.
 *
 * En pratique, beaucoup de créateurs culinaires mettent la recette complète en
 * légende — c'est souvent suffisant. Quand ça ne l'est pas, on propose
 * explicitement la saisie manuelle plutôt que de laisser l'IA inventer.
 */

const OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';

interface TikTokOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
}

async function fetchOEmbed(url: string): Promise<TikTokOEmbed | null> {
  const endpoint = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(url)}`;
  try {
    const response = await safeFetch(endpoint, { extraContentTypes: ['application/json'] });
    const parsed = JSON.parse(response.body) as TikTokOEmbed & { status_code?: number };
    // TikTok répond 200 avec un status_code d'erreur pour les posts supprimés.
    if (parsed.status_code && parsed.status_code !== 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const tiktokImporter: Importer = {
  platform: 'tiktok',
  label: 'TikTok',

  supports(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  },

  async fetchContent(rawUrl) {
    const content = emptyContent(rawUrl, 'tiktok');

    const oembed = await fetchOEmbed(rawUrl);

    if (oembed?.title) {
      content.title = oembed.title;
      content.description = oembed.title; // la légende EST le contenu utile
      content.author = oembed.author_name ?? null;
      if (oembed.thumbnail_url) content.images.push(oembed.thumbnail_url);
      content.metadata = { source: 'oembed', authorUrl: oembed.author_url };
      content.notes.push('Légende récupérée via oEmbed TikTok.');
    }

    // Complément OpenGraph : la légende y est parfois plus complète.
    try {
      const page = await safeFetch(rawUrl);
      const extracted = extractFromHtml(page.body, page.url);

      if (extracted.description && extracted.description.length > (content.description?.length ?? 0)) {
        content.description = extracted.description;
      }
      content.title ??= extracted.title;
      content.author ??= extracted.author;
      if (extracted.images.length > 0 && content.images.length === 0) {
        content.images.push(...extracted.images);
      }
      content.metadata['ogFetched'] = true;
    } catch {
      // La page peut répondre 403 selon la région : oEmbed suffit souvent.
      content.metadata['ogFetched'] = false;
    }

    if (!content.description && !content.title) {
      throw appError('PRIVATE_CONTENT', {
        message:
          "Cette publication TikTok est inaccessible : elle est peut-être privée, supprimée, ou restreinte selon la région.",
        canRetryManually: true,
      });
    }

    content.notes.push(
      "TikTok ne donne pas accès à l'audio : la recette est déduite de la légende uniquement.",
    );

    return content;
  },
};

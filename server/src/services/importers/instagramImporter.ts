import { appError } from '../../utils/errors.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { extractFromHtml } from './htmlExtract.js';
import { emptyContent, type Importer } from './types.js';

/**
 * Importer Instagram.
 *
 * Réalité de la plateforme : depuis 2021, l'oEmbed Instagram exige un jeton
 * d'application Facebook, et les pages publiques sont servies derrière un mur
 * de connexion de plus en plus systématique. Il n'existe aucun moyen fiable et
 * conforme aux CGU de lire une publication arbitraire côté serveur.
 *
 * Ce qu'on tente, dans l'ordre :
 *   1. les balises OpenGraph de la page publique — elles contiennent la
 *      légende dans og:description quand Instagram sert la version non
 *      connectée (cas encore fréquent pour les Reels publics) ;
 *   2. rien d'autre.
 *
 * Quand ça échoue — ce qui arrive souvent — on le dit franchement et on
 * bascule sur la saisie manuelle. C'est le comportement exigé au §3 : pas de
 * faux succès, une porte de sortie claire.
 */

/** Instagram encode la légende dans og:description, entourée de compteurs. */
function cleanCaption(ogDescription: string | null): string | null {
  if (!ogDescription) return null;

  // Format typique : «12K likes, 340 comments - chef_marc on June 3, 2024: "…"»
  const quoted = ogDescription.match(/:\s*[""](.+)[""]\s*$/s);
  if (quoted?.[1]) return quoted[1].trim();

  const afterColon = ogDescription.match(/^[^:]*\d+\s+(?:likes?|comments?|J'aime)[^:]*:\s*(.+)$/s);
  if (afterColon?.[1]) return afterColon[1].trim().replace(/^[""]|[""]$/g, '');

  return ogDescription.trim();
}

function extractAuthor(ogDescription: string | null, ogTitle: string | null): string | null {
  const fromDescription = ogDescription?.match(/-\s*([\w.\-]+)\s+on\s/);
  if (fromDescription?.[1]) return fromDescription[1];

  const fromTitle = ogTitle?.match(/^([^(]+)\s*\(@([\w.\-]+)\)/);
  if (fromTitle?.[2]) return fromTitle[2];

  return null;
}

export const instagramImporter: Importer = {
  platform: 'instagram',
  label: 'Instagram',

  supports(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am';
  },

  async fetchContent(rawUrl) {
    const content = emptyContent(rawUrl, 'instagram');

    let page: Awaited<ReturnType<typeof safeFetch>>;
    try {
      page = await safeFetch(rawUrl);
    } catch (error) {
      throw appError('LOGIN_REQUIRED', {
        message:
          "Instagram n'a pas laissé accéder à cette publication. Colle la légende ou la recette à la main pour continuer.",
        canRetryManually: true,
        cause: error,
      });
    }

    const extracted = extractFromHtml(page.body, page.url);
    const caption = cleanCaption(extracted.description);

    // Page de connexion servie à la place du post : la détecter pour ne pas
    // envoyer « Connectez-vous à Instagram » à l'IA comme si c'était une recette.
    const looksLikeLoginWall =
      !caption ||
      /^(login|connexion|se connecter|sign up|inscrivez-vous)/i.test(caption) ||
      /instagram\s*$/i.test(caption);

    if (looksLikeLoginWall) {
      throw appError('LOGIN_REQUIRED', {
        message:
          "Instagram exige une connexion pour afficher cette publication. Colle la légende de la recette à la main pour continuer.",
        canRetryManually: true,
      });
    }

    content.title = extracted.title;
    content.description = caption;
    content.author = extractAuthor(extracted.description, extracted.title);
    content.images = extracted.images;
    content.metadata = { ...extracted.metadata, httpStatus: page.status };

    content.notes.push('Légende récupérée depuis les métadonnées publiques de la page.');
    content.notes.push(
      "Instagram ne donne pas accès à l'audio : la recette est déduite de la légende uniquement.",
    );

    return content;
  },
};

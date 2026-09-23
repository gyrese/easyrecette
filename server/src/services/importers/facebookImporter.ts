import { appError } from '../../utils/errors.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { extractFromHtml } from './htmlExtract.js';
import { emptyContent, type Importer } from './types.js';

/**
 * Importer Facebook.
 *
 * L'oEmbed officiel demande un jeton d'application, et les publications
 * publiques passent souvent par un mur de connexion. On travaille donc à
 * partir de la page publique, en trois couches :
 *
 *   1. les sous-titres `.srt` de la vidéo quand ils existent — contrairement
 *      à YouTube, Facebook les sert en clair depuis un serveur, ce qui donne
 *      accès à la recette dictée à l'oral (vérifié en conditions réelles) ;
 *   2. la légende complète, extraite des données embarquées de la page
 *      (`og:description` est tronqué à ~200 caractères) ;
 *   3. les métadonnées OpenGraph, en dernier recours.
 *
 * Si rien de tout cela ne donne de texte exploitable, on le dit clairement et
 * on propose la saisie manuelle.
 */

/** Au-delà, on tronque : une transcription très longue n'apporte plus rien. */
const TRANSCRIPT_MAX_CHARS = 30_000;

/**
 * User-Agent de crawler social.
 *
 * Facebook sert aux robots d'aperçu une version de la page contenant les
 * métadonnées OpenGraph, là où il répond 400 à un navigateur sur certaines
 * URL (les Reels notamment). C'est l'usage prévu de cet agent : produire un
 * aperçu d'un lien partagé, ce que fait précisément cet import.
 */
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

/**
 * Récupère la page d'une publication Facebook.
 *
 * Le format des Reels pose deux problèmes constatés en conditions réelles :
 *  - `/reel/{id}` sans slash final renvoie 400 à un navigateur ;
 *  - la même URL avec slash final répond 200 à un crawler social.
 *
 * On essaie donc plusieurs formes d'URL et deux profils de client, en
 * s'arrêtant à la première réponse exploitable. `/video.php?v={id}` est
 * conservé en dernier recours : c'est l'ancien point d'entrée, encore servi.
 */
async function fetchFacebookPage(rawUrl: string) {
  const candidates = buildCandidateUrls(rawUrl);
  let lastError: unknown = null;

  for (const url of candidates) {
    // Crawler d'abord : c'est lui qui obtient les métadonnées sur les Reels.
    for (const headers of [{ 'User-Agent': CRAWLER_UA }, undefined]) {
      try {
        const page = await safeFetch(url, headers ? { headers } : {});
        if (page.body.trim().length > 1000) return page;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw appError('LOGIN_REQUIRED', {
    message:
      "Facebook n'a pas laissé accéder à cette publication. Colle le texte de la recette à la main pour continuer.",
    canRetryManually: true,
    cause: lastError,
  });
}

/** Décline une URL Facebook en ses formes équivalentes connues. */
function buildCandidateUrls(rawUrl: string): string[] {
  const urls = [rawUrl];

  try {
    const url = new URL(rawUrl);

    // Identifiant numérique de la publication, quel que soit le format d'URL.
    const id =
      url.searchParams.get('v') ??
      url.pathname.match(/\/(?:reel|videos?|watch)\/(\d{6,})/)?.[1] ??
      url.pathname.match(/\/(\d{10,})\/?$/)?.[1] ??
      null;

    if (id) {
      // Le slash final est ce qui fait la différence sur les Reels.
      urls.push(`https://www.facebook.com/reel/${id}/`);
      urls.push(`https://www.facebook.com/video.php?v=${id}`);
      urls.push(`https://www.facebook.com/watch/?v=${id}`);
    } else if (!url.pathname.endsWith('/')) {
      urls.push(`${url.origin}${url.pathname}/${url.search}`);
    }
  } catch {
    // URL non analysable : on s'en tient à celle fournie.
  }

  return [...new Set(urls)];
}

/**
 * Récupère les sous-titres de la vidéo, quand Facebook en expose.
 *
 * La page embarque une clé `captions_url` pointant vers un fichier `.srt`
 * hébergé sur le CDN. Contrairement à l'équivalent YouTube, cette URL n'est
 * pas liée à la session et répond à un serveur — c'est ce qui permet de
 * récupérer une recette dictée à l'oral plutôt que de la perdre.
 *
 * C'est une structure non documentée : elle peut disparaître sans préavis.
 * Un échec est donc silencieux, l'import continuant avec la légende seule.
 */
async function fetchCaptions(html: string): Promise<string | null> {
  const match = html.match(/"captions_url"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match?.[1]) return null;

  let url: string;
  try {
    // L'URL est doublement échappée dans le JSON de la page (\/ et \uXXXX).
    url = JSON.parse(`"${match[1]}"`) as string;
  } catch {
    url = match[1].replace(/\\\//g, '/');
  }

  try {
    const response = await safeFetch(url, {
      extraContentTypes: [
        'application/x-subrip',
        'text/srt',
        'application/octet-stream',
        'binary/octet-stream',
      ],
    });
    return parseSrt(response.body);
  } catch {
    return null;
  }
}

/**
 * Convertit un fichier SubRip en texte continu.
 *
 * Un `.srt` alterne numéro de séquence, plage horaire et lignes de texte.
 * Seules ces dernières nous intéressent. Les sous-titres coupant les phrases
 * en plein milieu pour tenir à l'écran, on rejoint tout d'un seul tenant :
 * c'est le sens global que le modèle doit lire, pas le découpage d'affichage.
 */
function parseSrt(body: string): string | null {
  if (!body.trim()) return null;

  const lines = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\d+$/.test(trimmed)) return false; // numéro de séquence
      if (/-->/.test(trimmed)) return false; // plage horaire
      return true;
    })
    .map((line) => line.replace(/<[^>]*>/g, '').trim());

  const text = lines.join(' ').replace(/\s+/g, ' ').trim();

  /*
   * Seuil volontairement haut (200 caractères).
   *
   * Beaucoup de vidéos de cuisine n'ont pas de voix off : leurs sous-titres
   * ne transcrivent que la musique de fond, ce qui donne des fragments de
   * paroles de chanson (« Few times I've been around that track so a… »).
   * Passés au modèle, ils ne ressemblent à rien et brouillent l'extraction.
   *
   * Une recette dictée fait au minimum quelques centaines de caractères :
   * en dessous, la piste n'est pas exploitable et il vaut mieux s'en tenir
   * à la légende.
   */
  if (text.length < 200) return null;

  return text.slice(0, TRANSCRIPT_MAX_CHARS);
}

/**
 * Ramène le <title> Facebook à un vrai titre.
 *
 * Facebook ne met pas un titre dans cette balise mais un agrégat :
 *   « 112 K vues · 3,2 K réactions | <toute la légende> | <nom de la page> »
 *
 * Tel quel, c'est inutilisable comme titre, ça dépasse les limites du schéma,
 * et ça fait doublon avec la description. On retire les compteurs, on prend
 * le premier segment porteur de sens, et on s'arrête à la première ligne.
 */
function cleanFacebookTitle(
  rawTitle: string | null,
  description: string | null,
): string | null {
  if (!rawTitle) return description?.split('\n')[0]?.slice(0, 200) ?? null;

  const segments = rawTitle
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  // Compteurs de vues / réactions / commentaires, en français comme en anglais.
  const isCounter = (segment: string): boolean =>
    /^[\d\s.,]+\s*(k|m|mn|mille)?\s*(vues?|views?|réactions?|reactions?|j'aime|likes?|commentaires?|comments?|partages?|shares?)/i.test(
      segment,
    ) || /^\d[\d\s.,]*\s*(k|m)?$/i.test(segment);

  const meaningful = segments.filter((segment) => !isCounter(segment));
  const candidate = meaningful[0] ?? segments[0] ?? rawTitle;

  // La légende commence souvent par le nom du plat sur sa propre ligne :
  // c'est le meilleur titre disponible.
  const firstLine = candidate.split('\n')[0]?.trim() ?? candidate;
  return firstLine.slice(0, 200) || null;
}

/**
 * Cherche la légende complète dans les blobs JSON que Facebook embarque
 * dans la page.
 *
 * Le rendu de Facebook est entièrement piloté par JavaScript : le HTML livré
 * contient les données sous forme de JSON sérialisé, où la légende apparaît
 * typiquement sous `message.text` ou `message_text`. On ne parse pas le
 * document entier (il pèse plusieurs mégaoctets) : on extrait les valeurs de
 * ces clés et on garde la plus longue.
 *
 * C'est du repérage de motif sur une structure non documentée, donc fragile
 * par nature. L'échec est sans conséquence : on retombe sur `og:description`.
 */
function extractFullCaption(html: string): string | null {
  const candidates: string[] = [];

  // "message":{"text":"…"} et "message_text":"…"
  const patterns = [
    /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    /"message_text"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    /"description"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = match[1];
      if (!raw) continue;
      const decoded = decodeJsonString(raw);
      if (decoded.length > 80) candidates.push(decoded);
    }
  }

  if (candidates.length === 0) return null;

  // La légende de la publication est la plus longue de ces chaînes ; les
  // autres sont des commentaires ou des libellés d'interface.
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Décode les échappements d'une chaîne JSON isolée par regex. */
function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
        String.fromCharCode(parseInt(code, 16)),
      );
  }
}

export const facebookImporter: Importer = {
  platform: 'facebook',
  label: 'Facebook',

  supports(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'fb.watch' ||
      host === 'fb.com'
    );
  },

  async fetchContent(rawUrl) {
    const content = emptyContent(rawUrl, 'facebook');

    const page = await fetchFacebookPage(rawUrl);

    const extracted = extractFromHtml(page.body, page.url);

    // `og:description` est tronqué par Facebook (souvent ~200 caractères, la
    // coupure se voyant à un « ... » final). Une recette y perd ses étapes de
    // préparation, ce qui produit ensuite une recette sans étapes. On cherche
    // donc la légende intégrale dans les données embarquées de la page avant
    // de se rabattre sur la métadonnée.
    const fullCaption = extractFullCaption(page.body);
    const ogDescription = extracted.description?.trim() ?? null;

    const description =
      fullCaption && fullCaption.length > (ogDescription?.length ?? 0)
        ? fullCaption
        : ogDescription;

    // Les sous-titres sont cherchés AVANT de juger la page inexploitable :
    // une vidéo peut n'avoir aucune légende utile tout en dictant la recette
    // à l'oral. Rejeter sur la seule légende ferait perdre ces cas-là.
    const transcript = await fetchCaptions(page.body);

    const looksLikeLoginWall =
      !description ||
      description.length < 40 ||
      /(log ?in|connexion|se connecter|create an account|inscription)/i.test(description);

    if (looksLikeLoginWall && !transcript) {
      throw appError('LOGIN_REQUIRED', {
        message:
          "Facebook exige une connexion pour afficher cette publication. Colle le texte de la recette à la main pour continuer.",
        canRetryManually: true,
      });
    }

    content.transcript = transcript;
    content.title = cleanFacebookTitle(extracted.title, description);
    content.description = description;
    content.author = extracted.author;
    content.images = extracted.images;
    content.text = extracted.text;
    content.metadata = { ...extracted.metadata, httpStatus: page.status };

    if (transcript) {
      const words = transcript.split(/\s+/).length;
      content.notes.push(
        `Sous-titres de la vidéo récupérés (${words} mots) : la recette est reconstituée depuis ce qui est dit à l'oral.`,
      );
    }

    if (fullCaption && fullCaption.length > (ogDescription?.length ?? 0)) {
      content.notes.push('Légende complète récupérée depuis la publication.');
    } else {
      content.notes.push('Texte récupéré depuis les métadonnées publiques de la page.');

      // Facebook marque ses descriptions tronquées par des points de suspension.
      // Le dire évite que l'utilisateur croie la recette incomplète de notre fait.
      if (/\.{3,}\s*$|…\s*$/.test(description ?? '')) {
        content.notes.push(
          "Facebook n'a fourni qu'un extrait de la légende : la fin de la recette est peut-être absente.",
        );
        content.metadata['captionTruncated'] = true;
      }
    }

    return content;
  },
};

import { config } from '../../config.js';
import { appError } from '../../utils/errors.js';
import { safeFetch } from '../../utils/safeFetch.js';
import { emptyContent, type Importer } from './types.js';

/**
 * Importer YouTube.
 *
 * Ordre de préférence (§5) :
 *   1. API Data v3 si une clé est configurée — métadonnées officielles ;
 *   2. oEmbed public — titre + auteur, sans clé, toujours disponible ;
 *   3. page watch — description complète et pistes de sous-titres.
 *
 * Les sous-titres passent par le player web : `captionTracks` liste les pistes
 * et leur baseUrl. C'est une interface non documentée, donc susceptible de
 * casser. On la traite comme telle : un échec n'interrompt pas l'import, il
 * se contente de laisser `transcript` à null et de le signaler dans les notes.
 */

const TRANSCRIPT_MAX_CHARS = 30_000;

function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id && isValidId(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && isValidId(v)) return v;

  // /shorts/ID, /embed/ID, /live/ID, /v/ID
  const match = url.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** Métadonnées via l'API officielle. Renvoie null si pas de clé ou si échec. */
async function fetchViaApi(videoId: string): Promise<Record<string, unknown> | null> {
  if (!config.youtube.apiKey) return null;

  const apiUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  apiUrl.searchParams.set('part', 'snippet,contentDetails');
  apiUrl.searchParams.set('id', videoId);
  apiUrl.searchParams.set('key', config.youtube.apiKey);

  try {
    const response = await safeFetch(apiUrl.toString(), {
      extraContentTypes: ['application/json'],
    });
    const parsed = JSON.parse(response.body) as {
      items?: Array<{
        snippet?: Record<string, unknown>;
        contentDetails?: Record<string, unknown>;
      }>;
    };
    const item = parsed.items?.[0];
    if (!item?.snippet) return null;
    return { ...item.snippet, contentDetails: item.contentDetails };
  } catch {
    // Quota dépassé, clé invalide… on se rabat sur les sources publiques.
    return null;
  }
}

/** oEmbed : titre + auteur sans clé d'API. Échoue si la vidéo est privée. */
async function fetchViaOEmbed(videoId: string): Promise<{ title: string; author: string } | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const response = await safeFetch(oembedUrl, { extraContentTypes: ['application/json'] });
    const parsed = JSON.parse(response.body) as { title?: string; author_name?: string };
    if (!parsed.title) return null;
    return { title: parsed.title, author: parsed.author_name ?? '' };
  } catch {
    return null;
  }
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string };
}

interface WatchPageData {
  description: string | null;
  captionTracks: CaptionTrack[];
  isPrivate: boolean;
  isUnavailable: boolean;
  thumbnail: string | null;
}

/**
 * Lit la page watch pour en extraire `ytInitialPlayerResponse`.
 * On ne parse pas le HTML : on isole le blob JSON puis on le lit proprement.
 */
async function fetchWatchPage(videoId: string): Promise<WatchPageData | null> {
  let body: string;
  try {
    const response = await safeFetch(`https://www.youtube.com/watch?v=${videoId}`, {
      // La page watch dépasse largement 2 Mo ; on autorise plus pour y
      // trouver le blob du player, qui apparaît tôt dans le document.
      maxBytes: 4 * 1024 * 1024,
    });
    body = response.body;
  } catch {
    return null;
  }

  const player = extractJsonBlob(body, 'ytInitialPlayerResponse');
  if (!player) return null;

  const status = player['playabilityStatus'] as Record<string, unknown> | undefined;
  const statusText = String(status?.['status'] ?? '').toUpperCase();
  const reason = String(status?.['reason'] ?? '').toLowerCase();

  const details = player['videoDetails'] as Record<string, unknown> | undefined;

  const captions = player['captions'] as Record<string, unknown> | undefined;
  const renderer = captions?.['playerCaptionsTracklistRenderer'] as
    | Record<string, unknown>
    | undefined;
  const tracks = Array.isArray(renderer?.['captionTracks'])
    ? (renderer['captionTracks'] as CaptionTrack[])
    : [];

  const thumbnails = (details?.['thumbnail'] as Record<string, unknown> | undefined)?.[
    'thumbnails'
  ];
  const thumbnail = Array.isArray(thumbnails)
    ? ((thumbnails.at(-1) as Record<string, unknown> | undefined)?.['url'] as string | undefined) ??
      null
    : null;

  return {
    description: (details?.['shortDescription'] as string | undefined) ?? null,
    captionTracks: tracks,
    isPrivate: statusText === 'LOGIN_REQUIRED' || reason.includes('private'),
    isUnavailable: statusText === 'ERROR' || statusText === 'UNPLAYABLE',
    thumbnail,
  };
}

/**
 * Isole un objet JSON assigné à une variable dans le HTML, en suivant les
 * accolades. Une regex gloutonne échouerait sur les accolades imbriquées.
 */
function extractJsonBlob(html: string, varName: string): Record<string, unknown> | null {
  const marker = `${varName} = `;
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i += 1) {
    const char = html[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Choisit la meilleure piste : français d'abord, puis anglais, puis n'importe
 * laquelle ; et à langue égale, une piste manuelle plutôt qu'auto-générée
 * (`kind === 'asr'`), nettement plus fiable.
 */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;

  const score = (track: CaptionTrack): number => {
    const lang = track.languageCode?.toLowerCase() ?? '';
    let value = 0;
    if (lang.startsWith('fr')) value += 100;
    else if (lang.startsWith('en')) value += 50;
    if (track.kind !== 'asr') value += 25;
    return value;
  };

  return [...tracks].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Télécharge une piste de sous-titres et la convertit en texte continu.
 *
 * Attention : depuis 2025, YouTube lie les `baseUrl` de `timedtext` à la
 * session et à l'IP du navigateur qui a chargé la page. Un appel depuis un
 * serveur reçoit HTTP 200 avec un corps VIDE — pas une erreur, juste rien.
 * Aucun paramètre de format (`json3`, `srv3`, `vtt`) ne change ce
 * comportement : c'est un verrou volontaire, vérifié en conditions réelles.
 *
 * On tente quand même — le comportement varie selon les vidéos et peut
 * évoluer — mais on traite la réponse vide comme une absence de transcription,
 * et l'appelant le signale honnêtement plutôt que de laisser croire à un
 * échec technique de notre côté.
 *
 * Pour obtenir vraiment les transcriptions, il faudrait soit l'API YouTube
 * Data v3 avec OAuth (le propriétaire de la chaîne seulement), soit un
 * téléchargement audio puis transcription — deux chemins hors du périmètre
 * d'un import à partir d'une URL publique.
 */
async function fetchTranscript(track: CaptionTrack): Promise<string | null> {
  // `json3` est le format courant du client web ; on le demande explicitement
  // plutôt que de compter sur le défaut, qui a déjà changé par le passé.
  const candidates = [
    track.baseUrl.includes('fmt=') ? track.baseUrl : `${track.baseUrl}&fmt=json3`,
    track.baseUrl,
  ];

  for (const url of candidates) {
    try {
      const response = await safeFetch(url, {
        extraContentTypes: ['text/xml', 'application/xml', 'application/json'],
      });

      if (!response.body.trim()) continue; // corps vide : piste verrouillée

      const text = response.body.trimStart().startsWith('{')
        ? parseJson3(response.body)
        : parseTimedText(response.body);

      if (text) return text.slice(0, TRANSCRIPT_MAX_CHARS);
    } catch {
      // On essaie le candidat suivant.
    }
  }

  return null;
}

/** Format json3 : { events: [{ segs: [{ utf8: "..." }] }] } */
function parseJson3(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };

    const text = (parsed.events ?? [])
      .flatMap((event) => event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 20 ? text : null;
  } catch {
    return null;
  }
}

/** Format timedtext : <text start="..">contenu</text>. */
function parseTimedText(xml: string): string | null {
  const matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  if (matches.length === 0) return null;

  const lines = matches
    .map((match) =>
      (match[1] ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);

  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length > 20 ? joined : null;
}

export const youtubeImporter: Importer = {
  platform: 'youtube',
  label: 'YouTube',

  supports(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    );
  },

  async fetchContent(rawUrl) {
    const url = new URL(rawUrl);
    const videoId = extractVideoId(url);

    if (!videoId) {
      throw appError('INVALID_URL', {
        message: "Cette adresse YouTube ne contient pas d'identifiant de vidéo reconnaissable.",
      });
    }

    const content = emptyContent(`https://www.youtube.com/watch?v=${videoId}`, 'youtube');
    content.metadata = { videoId };

    const [apiData, watchPage] = await Promise.all([
      fetchViaApi(videoId),
      fetchWatchPage(videoId),
    ]);

    if (watchPage?.isPrivate) {
      throw appError('PRIVATE_CONTENT', {
        message: 'Cette vidéo YouTube est privée ou nécessite une connexion.',
        canRetryManually: true,
      });
    }
    if (watchPage?.isUnavailable && !apiData) {
      throw appError('NOT_FOUND', {
        message: "Cette vidéo YouTube n'est plus disponible.",
        canRetryManually: true,
      });
    }

    // --- Titre / auteur : API, sinon oEmbed ---
    if (apiData) {
      content.title = (apiData['title'] as string | undefined) ?? null;
      content.author = (apiData['channelTitle'] as string | undefined) ?? null;
      content.description = (apiData['description'] as string | undefined) ?? null;
      content.metadata['source'] = 'youtube-api';
      content.notes.push('Métadonnées récupérées via l\'API YouTube officielle.');
    } else {
      const oembed = await fetchViaOEmbed(videoId);
      if (oembed) {
        content.title = oembed.title;
        content.author = oembed.author || null;
        content.metadata['source'] = 'oembed';
      }
    }

    // La page watch a la description complète ; l'API la tronque parfois.
    if (watchPage?.description && (watchPage.description.length > (content.description?.length ?? 0))) {
      content.description = watchPage.description;
    }

    if (watchPage?.thumbnail) content.images.push(watchPage.thumbnail);
    if (content.images.length === 0) {
      content.images.push(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`);
    }

    if (!content.title && !content.description) {
      throw appError('NOT_FOUND', {
        message: "Impossible de récupérer les informations de cette vidéo YouTube.",
        canRetryManually: true,
      });
    }

    // --- Sous-titres ---
    const track = pickTrack(watchPage?.captionTracks ?? []);
    if (track) {
      const transcript = await fetchTranscript(track);
      if (transcript) {
        content.transcript = transcript;
        content.metadata['transcriptLanguage'] = track.languageCode;
        content.metadata['transcriptAuto'] = track.kind === 'asr';
        content.notes.push(
          track.kind === 'asr'
            ? `Transcription automatique récupérée (${track.languageCode}).`
            : `Sous-titres récupérés (${track.languageCode}).`,
        );
      } else {
        // Cas le plus fréquent aujourd'hui : YouTube liste la piste mais en
        // refuse le contenu à un serveur. Le dire sans accuser l'app, et
        // sans laisser croire que la recette repose sur la vidéo analysée.
        content.notes.push(
          "YouTube n'autorise pas la récupération des sous-titres depuis un serveur : la recette est déduite de la description uniquement.",
        );
        content.metadata['transcriptBlocked'] = true;
      }
    } else {
      content.notes.push("Aucun sous-titre disponible : seule la description a été utilisée.");
    }

    return content;
  },
};

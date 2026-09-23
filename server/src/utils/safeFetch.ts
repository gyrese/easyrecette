import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import { appError } from './errors.js';

/**
 * Client HTTP durci pour aller chercher des URL fournies par l'utilisateur.
 *
 * Menace visée : SSRF. Une URL utilisateur ne doit jamais permettre d'atteindre
 * le réseau interne (169.254.169.254, 127.0.0.1, 10.x…), ni d'y arriver
 * indirectement par une redirection ou un DNS qui résout vers une IP privée.
 *
 * Garde-fous (§19) :
 *  - schéma limité à http/https ;
 *  - résolution DNS explicite et validation de CHAQUE IP retournée ;
 *  - redirections suivies à la main, chaque saut étant revalidé ;
 *  - timeout par requête et plafond d'octets lus, en streaming ;
 *  - types MIME restreints au texte/HTML/JSON.
 *
 * Limite connue : entre la validation DNS et la connexion réelle, un
 * DNS rebinding reste théoriquement possible. Le vrai correctif serait un
 * agent personnalisé qui valide l'IP au moment du connect ; c'est noté comme
 * amélioration, l'exposition étant faible pour une app locale mono-utilisateur.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/xml',
  'application/xhtml+xml',
  'application/json',
  'application/ld+json',
  'application/xml',
  'text/vtt',
  'application/x-subrip',
];

/** IPv4/IPv6 non routables publiquement : boucle locale, privées, link-local… */
function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);

  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // privé
    if (a === 127) return true; // loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local + métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // privé
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 168) return true; // privé
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a >= 224) return true; // multicast + réservé
    return false;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase().split('%')[0] ?? '';
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe80')) return true; // link-local
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
    if (normalized.startsWith('ff')) return true; // multicast
    // IPv4-mapped (::ffff:127.0.0.1) : on revalide la partie v4.
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true; // ni v4 ni v6 : on refuse par défaut
}

/**
 * Valide une URL utilisateur et résout son hôte.
 * Lève une AppError explicite plutôt que de laisser fuiter une erreur réseau.
 */
export async function assertUrlIsSafe(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw appError('INVALID_URL');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw appError('INVALID_URL', {
      message: 'Seules les adresses http et https peuvent être importées.',
    });
  }

  if (url.username || url.password) {
    throw appError('BLOCKED_URL', {
      message: "Les adresses contenant des identifiants ne sont pas acceptées.",
    });
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (config.fetch.allowPrivateAddresses) return url;

  // Noms locaux évidents, avant même le DNS.
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw appError('BLOCKED_URL');
  }

  // Hôte déjà littéral : pas de DNS à faire.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw appError('BLOCKED_URL');
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw appError('NOT_FOUND', {
      message: "Ce domaine est introuvable. Vérifie l'adresse.",
    });
  }

  if (addresses.length === 0) throw appError('NOT_FOUND');

  // Une seule IP privée suffit à refuser : un attaquant choisirait celle-là.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw appError('BLOCKED_URL');
  }

  return url;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  /** Types MIME acceptés en plus de la liste par défaut. */
  extraContentTypes?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  method?: 'GET' | 'HEAD';
}

/** Navigateur plausible : beaucoup de sites renvoient 403 à un UA vide. */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * GET une URL en validant chaque redirection, avec timeout et plafond d'octets.
 * `redirect: 'manual'` est essentiel : laisser fetch suivre les redirections
 * contournerait la validation anti-SSRF.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? config.fetch.maxBytes;
  const timeoutMs = options.timeoutMs ?? config.fetch.timeoutMs;
  const allowedTypes = [...ALLOWED_CONTENT_TYPES, ...(options.extraContentTypes ?? [])];

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= config.fetch.maxRedirects; hop += 1) {
    const url = await assertUrlIsSafe(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: { ...DEFAULT_HEADERS, ...options.headers },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw appError('TIMEOUT', { canRetryManually: true });
      }
      throw appError('NOT_FOUND', {
        message: "Impossible de joindre cette adresse.",
        canRetryManually: true,
        cause: error,
      });
    }

    try {
      // --- Redirection : on repart pour un tour, en revalidant la cible. ---
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw appError('NOT_FOUND', { canRetryManually: true });
        currentUrl = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) throw httpStatusToError(response.status);

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      const mime = contentType.split(';')[0]?.trim() ?? '';
      if (mime && !allowedTypes.includes(mime)) {
        throw appError('NO_CONTENT', {
          message: `Ce type de contenu (${mime}) ne peut pas être analysé.`,
          canRetryManually: true,
        });
      }

      // Refus précoce si le serveur annonce déjà une taille excessive.
      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength > maxBytes) throw appError('TOO_LARGE', { canRetryManually: true });

      const { text, truncated } = await readCapped(response, maxBytes);

      return {
        url: url.toString(),
        status: response.status,
        contentType: mime,
        body: text,
        truncated,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw appError('BLOCKED_URL', {
    message: 'Trop de redirections : impossible de récupérer cette page.',
    canRetryManually: true,
  });
}

/**
 * Lit le corps en streaming et coupe net au-delà du plafond.
 * Un `response.text()` chargerait tout en mémoire avant de pouvoir vérifier.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: await response.text(), truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const chunks: string[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        const keep = value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes)));
        chunks.push(decoder.decode(keep, { stream: false }));
        truncated = true;
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return { text: chunks.join(''), truncated };
}

/** Traduit un code HTTP en erreur applicative parlante pour l'utilisateur. */
export function httpStatusToError(status: number) {
  switch (status) {
    case 401:
      return appError('LOGIN_REQUIRED', { canRetryManually: true });
    case 403:
      return appError('PRIVATE_CONTENT', { canRetryManually: true });
    case 404:
    case 410:
      return appError('NOT_FOUND', { canRetryManually: true });
    case 429:
      return appError('RATE_LIMITED', { canRetryManually: true });
    case 408:
    case 504:
      return appError('TIMEOUT', { canRetryManually: true });
    default:
      return appError('NOT_FOUND', {
        message: `La source a répondu avec une erreur (${status}).`,
        canRetryManually: true,
      });
  }
}

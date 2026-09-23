import type { Platform } from '../../schemas/recipe.js';

/**
 * Détection de plateforme à partir de l'URL seule.
 * Utilisée à la fois par le backend (choix de l'adapter) et par le frontend
 * via GET /api/import/detect, pour afficher le badge dès le collage.
 */

interface PlatformRule {
  platform: Platform;
  hosts: string[];
}

const RULES: PlatformRule[] = [
  {
    platform: 'tiktok',
    hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com'],
  },
  {
    platform: 'instagram',
    hosts: ['instagram.com', 'instagr.am', 'ig.me'],
  },
  {
    platform: 'facebook',
    hosts: ['facebook.com', 'fb.com', 'fb.watch', 'm.facebook.com'],
  },
  {
    platform: 'youtube',
    hosts: ['youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'],
  },
];

/** `true` pour "exemple.com" face à "www.exemple.com" ou "sous.exemple.com". */
function hostMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

export function detectPlatform(rawUrl: string): Platform {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'web';
  }

  for (const rule of RULES) {
    if (rule.hosts.some((host) => hostMatches(hostname, host))) return rule.platform;
  }

  return 'web';
}

/** Normalise l'URL : retire les paramètres de tracking, garde ce qui identifie. */
export function cleanUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    const junk = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'igshid', 'igsh', '_nc_ht', 'share_id', 'ref', 'ref_src',
      'is_from_webapp', 'sender_device', 'web_id', 'si', 'feature', 'pp',
    ];
    for (const key of junk) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

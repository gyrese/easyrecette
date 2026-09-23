import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { appError } from '../../utils/errors.js';

/**
 * Téléchargement de la vidéo d'une publication.
 *
 * Pourquoi yt-dlp plutôt qu'un navigateur headless (Chromium/Playwright) :
 *  - il connaît déjà les formats propres à chaque plateforme et les suit
 *    quand elles changent, là où un scraping maison casse à chaque évolution ;
 *  - il ne charge pas le rendu de la page, donc pas de 300 Mo de navigateur
 *    ni de plusieurs secondes de démarrage par import ;
 *  - il rend directement le meilleur flux, sans avoir à reconstituer une URL
 *    de CDN à la main.
 *
 * Un navigateur headless aurait servi si l'on avait eu besoin d'un rendu
 * visuel ou d'une session authentifiée. Ce n'est pas le cas ici.
 *
 * Le binaire est facultatif : quand il est absent, l'analyse vidéo est
 * simplement indisponible et le reste de l'application fonctionne.
 */

/** Plafond de taille : au-delà, l'analyse coûterait plus qu'elle ne rapporte. */
const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

/** Une vidéo de recette dépasse rarement 5 minutes ; au-delà, on refuse. */
const MAX_DURATION_SECONDS = 600;

const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface FetchedVideo {
  /** Chemin du fichier téléchargé. */
  filePath: string;
  bytes: number;
  durationSeconds: number | null;
  mimeType: string;
}

let cachedBinary: string | null | undefined;

/**
 * Localise yt-dlp. Résultat mis en cache : la recherche touche le disque et
 * l'issue ne change pas en cours d'exécution.
 */
export function findYtDlp(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  const candidates = [
    process.env['YTDLP_PATH'],
    'yt-dlp',
    'yt-dlp.exe',
    // Emplacement usuel d'une installation via pip sous Windows.
    path.join(
      process.env['LOCALAPPDATA'] ?? '',
      'Programs/Python/Python310/Scripts/yt-dlp.exe',
    ),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    // Un chemin absolu se vérifie directement ; un nom simple sera résolu
    // par le PATH au moment du spawn.
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (existsSync(candidate)) {
        cachedBinary = candidate;
        return cachedBinary;
      }
      continue;
    }
    cachedBinary = candidate;
    return cachedBinary;
  }

  cachedBinary = null;
  return null;
}

export function isVideoAnalysisAvailable(): boolean {
  return findYtDlp() !== null;
}

/** Exécute yt-dlp en capturant sa sortie, avec un délai maximal. */
function run(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(appError('TIMEOUT', { message: "Le téléchargement de la vidéo a pris trop de temps." }));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      // Garde-fou mémoire si la sortie devient anormalement volumineuse.
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Métadonnées de la vidéo, sans la télécharger. */
export async function probeVideo(url: string): Promise<{
  duration: number | null;
  title: string | null;
  description: string | null;
  hasSubtitles: boolean;
} | null> {
  const binary = findYtDlp();
  if (!binary) return null;

  try {
    const { code, stdout } = await run(
      binary,
      ['--no-warnings', '--skip-download', '--dump-json', '--no-playlist', url],
      30_000,
    );
    if (code !== 0 || !stdout.trim()) return null;

    const firstLine = stdout.split('\n').find((line) => line.trim().startsWith('{'));
    if (!firstLine) return null;

    const info = JSON.parse(firstLine) as {
      duration?: number;
      title?: string;
      description?: string;
      subtitles?: Record<string, unknown>;
      automatic_captions?: Record<string, unknown>;
    };

    return {
      duration: typeof info.duration === 'number' ? info.duration : null,
      title: info.title ?? null,
      description: info.description ?? null,
      hasSubtitles:
        Object.keys(info.subtitles ?? {}).length > 0 ||
        Object.keys(info.automatic_captions ?? {}).length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Télécharge la vidéo dans `targetDir`.
 *
 * La qualité est volontairement plafonnée à 480p : le modèle lit le texte
 * incrusté et les gestes sans difficulté à cette définition, et cela divise
 * le poids du fichier — donc le coût d'analyse et l'espace disque.
 */
export async function downloadVideo(
  url: string,
  targetDir: string,
): Promise<FetchedVideo> {
  const binary = findYtDlp();
  if (!binary) {
    throw appError('NO_CONTENT', {
      message:
        "L'analyse vidéo n'est pas disponible sur ce serveur (yt-dlp n'est pas installé).",
      canRetryManually: true,
    });
  }

  const probe = await probeVideo(url);
  if (probe?.duration && probe.duration > MAX_DURATION_SECONDS) {
    throw appError('TOO_LARGE', {
      message: `Cette vidéo dure ${Math.round(probe.duration / 60)} minutes : c'est trop long pour être analysée automatiquement.`,
      canRetryManually: true,
    });
  }

  await mkdir(targetDir, { recursive: true });

  const { code, stderr } = await run(
    binary,
    [
      '--no-warnings',
      '--no-playlist',
      '--no-part',
      // 480p suffit largement pour lire un texte incrusté.
      '-f',
      'best[height<=480][filesize<40M]/best[height<=480]/best[filesize<40M]/best',
      '--max-filesize',
      String(MAX_VIDEO_BYTES),
      '--merge-output-format',
      'mp4',
      '-o',
      path.join(targetDir, 'video.%(ext)s'),
      url,
    ],
    DOWNLOAD_TIMEOUT_MS,
  );

  if (code !== 0) {
    /*
     * Messages fréquents de yt-dlp, traduits pour l'utilisateur final.
     *
     * Le cas « needs to be reloaded » mérite un message à part : il ne veut
     * pas dire que la vidéo est inaccessible, mais que la version installée
     * de yt-dlp ne sait plus négocier avec la plateforme. Les protections de
     * YouTube changent souvent et l'outil suit avec ses mises à jour ; dire
     * « vidéo indisponible » enverrait l'utilisateur chercher le problème du
     * mauvais côté.
     */
    const outdated = /needs to be reloaded|nsig extraction|player.*not.*found|update.*yt-dlp/i.test(
      stderr,
    );

    const reason = outdated
      ? "La plateforme a changé ses protections et l'outil de téléchargement installé est trop ancien pour les suivre. Mets yt-dlp à jour (pip install -U yt-dlp) pour réactiver l'analyse de ces vidéos."
      : /private|login|sign in|cookies/i.test(stderr)
        ? "Cette publication est privée : sa vidéo ne peut pas être téléchargée."
        : /unavailable|removed|not exist/i.test(stderr)
          ? "Cette vidéo n'est plus disponible."
          : "La vidéo n'a pas pu être téléchargée depuis cette plateforme.";

    throw appError('NO_CONTENT', {
      message: reason,
      detail: stderr.split('\n').filter(Boolean).slice(-3).join(' | '),
      canRetryManually: true,
    });
  }

  const files = await readdir(targetDir);
  const videoFile = files.find((name) => name.startsWith('video.'));
  if (!videoFile) {
    throw appError('NO_CONTENT', {
      message: "Le téléchargement de la vidéo n'a produit aucun fichier.",
      canRetryManually: true,
    });
  }

  const filePath = path.join(targetDir, videoFile);
  const stats = await stat(filePath);

  if (stats.size > MAX_VIDEO_BYTES) {
    await rm(filePath, { force: true });
    throw appError('TOO_LARGE', {
      message: 'Cette vidéo est trop volumineuse pour être analysée.',
      canRetryManually: true,
    });
  }

  return {
    filePath,
    bytes: stats.size,
    durationSeconds: probe?.duration ?? null,
    mimeType: videoFile.endsWith('.webm') ? 'video/webm' : 'video/mp4',
  };
}

/** Lit le fichier pour l'envoyer au modèle. */
export async function readVideoBase64(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return buffer.toString('base64');
}

export { MAX_VIDEO_BYTES, MAX_DURATION_SECONDS };
export { config as mediaConfig };

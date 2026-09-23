import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Stockage local des médias attachés aux recettes.
 *
 * Arborescence :
 *   server/media/
 *     tmp/<importId>/video.mp4     pendant l'import
 *     recipes/<recipeId>/video.mp4 une fois la recette enregistrée
 *     recipes/<recipeId>/poster.jpg
 *     recipes/<recipeId>/photo-<ts>.jpg photo du plat prise par l'utilisateur
 *
 * Les fichiers sont servis en statique par Express sous /media. Le dossier
 * est exclu de Git (voir .gitignore) : ce sont des données utilisateur, pas
 * du code.
 *
 * Une vidéo n'est conservée que si la recette est effectivement enregistrée ;
 * les imports abandonnés laissent un dossier temporaire, nettoyé au démarrage.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** src/services/media -> server/ */
const SERVER_ROOT = path.resolve(here, '../../..');

export const MEDIA_ROOT = path.join(SERVER_ROOT, 'media');
const TMP_ROOT = path.join(MEDIA_ROOT, 'tmp');
const RECIPES_ROOT = path.join(MEDIA_ROOT, 'recipes');

/** Dossier de travail d'un import en cours. */
export function tempDirFor(importId: string): string {
  return path.join(TMP_ROOT, sanitize(importId));
}

export function recipeDirFor(recipeId: string): string {
  return path.join(RECIPES_ROOT, sanitize(recipeId));
}

/**
 * Un identifiant vient de la base (cuid) et ne devrait jamais contenir de
 * séparateur, mais il alimente un chemin de fichier : on le vérifie plutôt
 * que de faire confiance.
 */
function sanitize(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9_-]/g, '');
  if (!clean) throw new Error('Identifiant de média invalide');
  return clean;
}

/**
 * Déplace la vidéo d'un import vers le dossier définitif de la recette.
 * Retourne les URL publiques à stocker en base.
 */
export async function attachVideoToRecipe(
  importId: string,
  recipeId: string,
): Promise<{ videoUrl: string; posterUrl: string | null } | null> {
  const from = tempDirFor(importId);
  if (!existsSync(from)) return null;

  const videoName = ['video.mp4', 'video.webm'].find((name) =>
    existsSync(path.join(from, name)),
  );
  if (!videoName) return null;

  const to = recipeDirFor(recipeId);
  await mkdir(to, { recursive: true });

  const target = path.join(to, videoName);
  await rename(path.join(from, videoName), target);

  const posterUrl = await extractPoster(target, to, recipeId);

  await rm(from, { recursive: true, force: true });

  return { videoUrl: `/media/recipes/${sanitize(recipeId)}/${videoName}`, posterUrl };
}

/**
 * Extrait une image de la vidéo pour illustrer la fiche.
 *
 * On prend une frame à 1 seconde plutôt qu'à 0 : la première image d'une
 * vidéo est souvent noire ou floue.
 *
 * ffmpeg est facultatif : sans lui, la recette garde simplement l'image
 * fournie par la plateforme, ou aucune.
 */
async function extractPoster(
  videoPath: string,
  targetDir: string,
  recipeId: string,
): Promise<string | null> {
  const posterPath = path.join(targetDir, 'poster.jpg');

  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(
      'ffmpeg',
      [
        '-y',
        '-ss', '1',
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=800:-1',
        '-q:v', '4',
        posterPath,
      ],
      { windowsHide: true },
    );

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 20_000);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

  if (!ok || !existsSync(posterPath)) return null;

  const stats = await stat(posterPath);
  if (stats.size === 0) {
    await rm(posterPath, { force: true });
    return null;
  }

  return `/media/recipes/${sanitize(recipeId)}/poster.jpg`;
}

/**
 * Formats acceptés pour une photo de plat, et extension de fichier associée.
 *
 * Liste blanche plutôt que liste noire : on écrit un fichier dans un dossier
 * servi en statique, donc le type doit être connu à l'avance, pas déduit de ce
 * que le client annonce. L'extension vient de cette table et jamais du nom
 * d'origine — un « photo.jpg.html » n'a ainsi aucun moyen d'atterrir sur le
 * disque sous ce nom.
 */
const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 8 Mio : une photo de téléphone passe largement, un film non. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function isSupportedPhotoType(mime: string): boolean {
  return mime in PHOTO_TYPES;
}

/**
 * Enregistre la photo du plat prise par l'utilisateur.
 *
 * Le nom porte un horodatage (`photo-<timestamp>.jpg`) plutôt qu'un nom fixe.
 * C'est délibéré : les médias sont servis avec `immutable` et un cache de
 * 30 jours (voir src/index.ts), donc réécrire « photo.jpg » laisserait le
 * navigateur afficher l'ancienne image pendant un mois. Une nouvelle photo a
 * une nouvelle adresse, et l'ancienne est effacée dans la foulée.
 */
export async function saveUserPhoto(
  recipeId: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  const extension = PHOTO_TYPES[mime];
  if (!extension) throw new Error(`Type d'image non pris en charge : ${mime}`);

  const dir = recipeDirFor(recipeId);
  await mkdir(dir, { recursive: true });

  const name = `photo-${Date.now()}.${extension}`;
  await writeFile(path.join(dir, name), buffer);

  await removeOtherPhotos(dir, name);

  return `/media/recipes/${sanitize(recipeId)}/${name}`;
}

/**
 * Efface les photos précédentes une fois la nouvelle écrite.
 *
 * Fait après coup et sans jamais faire échouer l'appelant : une photo
 * orpheline est un inconvénient de disque, alors qu'une erreur ici priverait
 * l'utilisateur de la photo qu'il vient de prendre.
 */
async function removeOtherPhotos(dir: string, keep: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith('photo-') && entry !== keep)
        .map((entry) => rm(path.join(dir, entry), { force: true })),
    );
  } catch {
    // Dossier illisible : la nouvelle photo est déjà en place, on n'insiste pas.
  }
}

/** Retire la photo utilisateur, rendant la fiche à l'image de sa source. */
export async function deleteUserPhoto(recipeId: string): Promise<void> {
  const dir = recipeDirFor(recipeId);
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith('photo-'))
        .map((entry) => rm(path.join(dir, entry), { force: true })),
    );
  } catch {
    // Rien à supprimer.
  }
}

/** Supprime les médias d'une recette effacée. */
export async function deleteRecipeMedia(recipeId: string): Promise<void> {
  await rm(recipeDirFor(recipeId), { recursive: true, force: true });
}

/**
 * Vide les dossiers temporaires au démarrage.
 *
 * Un import interrompu (client fermé, serveur redémarré) laisse sa vidéo
 * derrière lui. Sans ce nettoyage, le disque se remplirait lentement de
 * fichiers que plus rien ne référence.
 */
export async function cleanTempMedia(): Promise<void> {
  await rm(TMP_ROOT, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(TMP_ROOT, { recursive: true }).catch(() => undefined);
}

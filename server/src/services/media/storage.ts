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

  return { videoUrl: recipeMediaUrl(recipeId, videoName), posterUrl };
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
export async function extractPoster(
  videoPath: string,
  targetDir: string,
  recipeId: string,
): Promise<string | null> {
  const fileName = await extractFrame(videoPath, 1, targetDir, 'poster');
  return fileName ? recipeMediaUrl(recipeId, fileName) : null;
}

/**
 * Lance ffmpeg et renvoie true s'il a réussi.
 *
 * Jamais d'exception : ffmpeg absent, en échec ou trop lent donnent false,
 * et chaque appelant garde alors ce qu'il avait. Un média non optimisé
 * n'est jamais une raison de faire échouer une recette.
 */
function runFfmpeg(args: string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', ['-y', '-v', 'error', ...args], { windowsHide: true });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

/** Vrai si ffmpeg a produit un fichier non vide ; sinon l'efface. */
async function produced(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  if ((await stat(filePath)).size > 0) return true;
  await rm(filePath, { force: true });
  return false;
}

/**
 * Réglages WebP communs. Qualité 75 : à l'œil, identique au JPEG d'avant
 * sur une photo de cuisine, pour 30 à 50 % de poids en moins.
 */
const WEBP_ARGS = ['-c:v', 'libwebp', '-quality', '75', '-compression_level', '4'];

/**
 * Écrit dans `dir` l'image de la vidéo à l'instant `seconds`, en WebP, et
 * renvoie le nom du fichier écrit (`<baseName>.webp`), ou null.
 *
 * Repli en JPEG si l'encodeur WebP manque à ce ffmpeg-là : mieux vaut une
 * image un peu plus lourde que pas d'image du tout.
 *
 * Null aussi quand l'instant dépasse la fin de la vidéo : ffmpeg n'écrit
 * alors rien, sans signaler d'erreur.
 */
export async function extractFrame(
  videoPath: string,
  seconds: number,
  dir: string,
  baseName: string,
): Promise<string | null> {
  const input = [
    // `-ss` avant `-i` : recherche rapide sur l'image clé, puis décodage
    // exact jusqu'à l'instant voulu.
    '-ss', seconds.toFixed(2),
    '-i', videoPath,
    '-frames:v', '1',
    // Réduite à 800 px de large, jamais agrandie : une vidéo verticale en
    // 480p n'en fait que 270, l'agrandir alourdirait sans rien montrer de plus.
    '-vf', "scale='min(800,iw)':-2",
  ];

  const webp = `${baseName}.webp`;
  if (
    (await runFfmpeg([...input, ...WEBP_ARGS, path.join(dir, webp)], 20_000)) &&
    (await produced(path.join(dir, webp)))
  ) {
    return webp;
  }

  const jpg = `${baseName}.jpg`;
  if (
    (await runFfmpeg([...input, '-q:v', '4', path.join(dir, jpg)], 20_000)) &&
    (await produced(path.join(dir, jpg)))
  ) {
    return jpg;
  }

  return null;
}

/**
 * Convertit une image (JPEG, PNG, WebP…) en WebP, côté le plus long ramené
 * à `maxSide` pixels sans jamais agrandir. Renvoie true si `outputPath` a
 * été écrit.
 */
export async function convertImageToWebp(
  inputPath: string,
  outputPath: string,
  maxSide = 1600,
): Promise<boolean> {
  const scale =
    `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
  const ok = await runFfmpeg(
    ['-i', inputPath, '-frames:v', '1', '-vf', scale, ...WEBP_ARGS, outputPath],
    30_000,
  );
  return ok && (await produced(outputPath));
}

/**
 * Recompresse une vidéo pour le stockage.
 *
 * MP4 H.264 et non WebM ou AV1 : c'est le seul format que tous les
 * navigateurs lisent, Safari sur iPhone compris. Le gain vient des réglages :
 *  - CRF 28 : la qualité baisse à peine sur un geste de cuisine filmé au
 *    téléphone, le poids est souvent divisé par deux ou trois ;
 *  - petit côté ramené à 480 px, comme au téléchargement ;
 *  - son en AAC 64 kb/s, largement assez pour une voix off ;
 *  - `faststart` : l'index en tête de fichier, pour que la lecture et le
 *    saut à un instant (images des étapes) démarrent sans tout télécharger.
 */
export async function compressVideo(inputPath: string, outputPath: string): Promise<boolean> {
  const scale =
    "scale='if(gt(iw,ih),-2,min(480,iw))':'if(gt(iw,ih),min(480,ih),-2)'";
  const ok = await runFfmpeg(
    [
      '-i', inputPath,
      '-vf', scale,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ],
    // Quelques secondes pour une vidéo de recette ; large pour un VPS modeste.
    5 * 60_000,
  );
  return ok && (await produced(outputPath));
}

/** Adresse publique d'un fichier du dossier d'une recette. */
export function recipeMediaUrl(recipeId: string, fileName: string): string {
  return `/media/recipes/${sanitize(recipeId)}/${fileName}`;
}

/** Chemin disque d'un fichier servi sous /media/recipes/<id>/, ou null. */
export function recipeMediaPath(recipeId: string, url: string): string | null {
  const prefix = recipeMediaUrl(recipeId, '');
  if (!url.startsWith(prefix)) return null;
  const fileName = url.slice(prefix.length);
  if (!/^[A-Za-z0-9_.-]+$/.test(fileName) || fileName.startsWith('.')) return null;
  return path.join(recipeDirFor(recipeId), fileName);
}

/**
 * Vrai si `url` désigne une image d'étape de CETTE recette.
 *
 * L'image d'une étape revient du client à chaque modification de la fiche :
 * on n'accepte que les fichiers produits par le serveur, pour qu'une fiche
 * publique ne puisse pas afficher une adresse arbitraire.
 */
export function isStepImageOf(recipeId: string, url: string): boolean {
  const prefix = recipeMediaUrl(recipeId, '');
  return (
    url.startsWith(prefix) && /^step-\d+-\d+\.(webp|jpg)$/.test(url.slice(prefix.length))
  );
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

  // Une photo de téléphone pèse 3 à 8 Mo en JPEG ou PNG ; en WebP réduite à
  // 1600 px, quelques centaines de Ko. L'original n'est gardé que si la
  // conversion échoue (ffmpeg absent, format exotique).
  const stamp = Date.now();
  const original = `photo-${stamp}.${extension}`;
  await writeFile(path.join(dir, original), buffer);

  let name = original;
  const webp = `photo-${stamp}.webp`;
  if (
    webp !== original &&
    (await convertImageToWebp(path.join(dir, original), path.join(dir, webp)))
  ) {
    await rm(path.join(dir, original), { force: true });
    name = webp;
  }

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

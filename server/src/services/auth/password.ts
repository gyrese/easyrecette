import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * Hachage des mots de passe.
 *
 * scrypt, fourni par `node:crypto` : c'est une fonction volontairement
 * coûteuse en mémoire, donc lente à attaquer par force brute même sur GPU.
 * Pas de bcrypt ni d'argon2 — ils demandent un module natif à compiler, source
 * classique d'échecs dans une image Docker, pour un gain de sécurité
 * marginal à cette échelle.
 *
 * Format stocké : `scrypt$N$r$p$sel$hash` (sel et hash en base64). Les
 * paramètres voyagent avec le hash : on pourra augmenter le coût plus tard,
 * les anciens comptes continueront d'être vérifiés avec leurs propres
 * paramètres.
 */

/** 2^15 : ~32 Mo de mémoire et ~50 ms par vérification sur un VPS courant. */
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const PASSWORD_MIN_LENGTH = 8;
/*
 * Borne haute : scrypt accepte n'importe quelle longueur, mais un mot de passe
 * de plusieurs mégaoctets ferait travailler le serveur pour rien. 200
 * caractères couvrent toutes les phrases de passe raisonnables.
 */
export const PASSWORD_MAX_LENGTH = 200;

function scrypt(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      // maxmem doit dépasser 128 * N * r, sinon Node refuse le calcul.
      { N, r, p, maxmem: 256 * N * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, COST, BLOCK_SIZE, PARALLELISM);
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * Vérifie un mot de passe contre un hash stocké.
 *
 * Renvoie `false` sur un hash illisible plutôt que de lever : une ligne
 * corrompue en base ne doit pas devenir une erreur 500 à chaque tentative,
 * seulement un échec de connexion.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || !Number.isInteger(R) || !Number.isInteger(P)) return false;

  const expected = Buffer.from(keyB64 ?? '', 'base64');
  if (expected.length === 0) return false;

  const actual = await scrypt(password, Buffer.from(saltB64 ?? '', 'base64'), N, R, P);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Hash factice, calculé une fois au chargement.
 *
 * Quand l'adresse saisie n'existe pas, on vérifie quand même le mot de passe
 * contre ce hash : la réponse met alors le même temps que pour un compte
 * réel. Sans ça, une réponse instantanée trahirait les adresses inscrites à
 * qui mesure les temps de réponse.
 */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(24).toString('hex'));

import { LEGACY_USER_EMAIL, prisma } from '../../database/client.js';
import { appError } from '../../utils/errors.js';
import type { GoogleProfile } from './google.js';
import { DUMMY_HASH_PROMISE, hashPassword, verifyPassword } from './password.js';

/**
 * Résolution des comptes.
 *
 * Deux portes d'entrée, qui aboutissent aux mêmes comptes :
 *  - Google (`resolveUserFromGoogle`) : l'adresse est prouvée par Google ;
 *  - e-mail + mot de passe (`registerWithPassword`, `authenticateWithPassword`) :
 *    l'adresse est déclarée, JAMAIS vérifiée — il n'y a pas d'envoi de mail.
 *
 * Cette asymétrie de confiance gouverne tout le reste du fichier : une adresse
 * vérifiée par Google l'emporte toujours sur une adresse simplement saisie.
 */

/** Normalisation unique des adresses, pour que « Moi@Gmail.com » et « moi@gmail.com » soient un seul compte. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Reprise du compte mono-utilisateur du MVP.
 *
 * Avant l'authentification, toutes les recettes appartenaient à un compte
 * technique `local@cookbook.app`. Le premier utilisateur qui se connecte — par
 * Google ou par e-mail — en hérite : ses recettes existantes deviennent les
 * siennes, privées, sans migration de données ni perte.
 *
 * Le transfert ne se fait qu'une fois : le compte local est renommé plutôt que
 * ses lignes déplacées, donc il n'existe plus sous son adresse technique après
 * coup, et le second utilisateur démarre sur un fichier vide.
 */
async function adoptLegacyAccount(identity: {
  email: string;
  name: string | null;
  googleId?: string;
  avatarUrl?: string | null;
  passwordHash?: string;
}): Promise<string | null> {
  const legacy = await prisma.user.findUnique({
    where: { email: LEGACY_USER_EMAIL },
    select: {
      id: true,
      googleId: true,
      passwordHash: true,
      _count: { select: { recipes: true } },
    },
  });

  // Déjà rattaché à quelqu'un, ou vide : rien à reprendre.
  if (!legacy || legacy.googleId || legacy.passwordHash || legacy._count.recipes === 0) {
    return null;
  }

  const adopted = await prisma.user.update({
    where: { id: legacy.id },
    data: {
      email: identity.email,
      name: identity.name,
      googleId: identity.googleId ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      passwordHash: identity.passwordHash ?? null,
      lastLoginAt: new Date(),
    },
  });

  console.log(
    `[auth] compte local repris par ${identity.email} ` +
      `(${legacy._count.recipes} recette(s) transférée(s))`,
  );

  return adopted.id;
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/**
 * Trois cas, dans cet ordre :
 *  1. le `googleId` est déjà connu → c'est ce compte, on rafraîchit le profil ;
 *  2. le compte local du MVP est libre → on le reprend ;
 *  3. l'adresse existe déjà (compte créé par e-mail) → on la rattache ;
 *  4. rien → création.
 */
export async function resolveUserFromGoogle(profile: GoogleProfile): Promise<string> {
  const byGoogleId = await prisma.user.findUnique({
    where: { googleId: profile.googleId },
    select: { id: true },
  });

  if (byGoogleId) {
    await prisma.user.update({
      where: { id: byGoogleId.id },
      data: {
        // Le nom et l'avatar viennent de Google : on les rafraîchit à chaque
        // connexion. `displayName`, lui, appartient à l'utilisateur et n'est
        // jamais écrasé.
        name: profile.name,
        avatarUrl: profile.picture,
        lastLoginAt: new Date(),
      },
    });
    return byGoogleId.id;
  }

  const adoptedId = await adoptLegacyAccount({
    email: profile.email,
    name: profile.name,
    googleId: profile.googleId,
    avatarUrl: profile.picture,
  });
  if (adoptedId) return adoptedId;

  const byEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: { id: true, passwordHash: true },
  });

  if (byEmail) {
    /*
     * Rattachement d'un compte créé par e-mail — le point sensible du fichier.
     *
     * Ce compte a pu être ouvert par N'IMPORTE QUI : l'inscription par e-mail
     * ne vérifie pas l'adresse. Scénario à neutraliser : un tiers inscrit
     * l'adresse de la victime avec un mot de passe qu'il connaît, attend que
     * la victime se connecte par Google et y range ses recettes, puis se
     * reconnecte avec son mot de passe. C'est une « pré-prise de contrôle ».
     *
     * Google, lui, vient de PROUVER que la personne présente possède
     * l'adresse. On lui donne donc raison sur toute la ligne : le mot de passe
     * non vérifié est effacé, et toutes les sessions ouvertes avec lui sont
     * fermées. Si c'était bien le même propriétaire, il perd seulement son
     * mot de passe, qu'il peut redéfinir depuis la page compte.
     */
    await prisma.$transaction([
      prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: profile.googleId,
          name: profile.name,
          avatarUrl: profile.picture,
          passwordHash: null,
          lastLoginAt: new Date(),
        },
      }),
      prisma.session.deleteMany({ where: { userId: byEmail.id } }),
    ]);

    if (byEmail.passwordHash) {
      console.log(
        `[auth] ${profile.email} : rattaché à Google, mot de passe non vérifié effacé`,
      );
    }
    return byEmail.id;
  }

  const created = await prisma.user.create({
    data: {
      email: profile.email,
      googleId: profile.googleId,
      name: profile.name,
      avatarUrl: profile.picture,
      lastLoginAt: new Date(),
    },
  });

  return created.id;
}

// ---------------------------------------------------------------------------
// E-mail + mot de passe
// ---------------------------------------------------------------------------

/**
 * Inscription.
 *
 * Une adresse déjà connue est refusée, qu'elle vienne de Google ou d'une
 * inscription précédente. Oui, ça révèle qu'un compte existe — c'est le
 * compromis de toute page d'inscription, sans lequel l'utilisateur ne
 * comprendrait pas pourquoi il ne peut pas s'inscrire. La connexion, elle, ne
 * révèle rien (voir authenticateWithPassword).
 */
export async function registerWithPassword(input: {
  email: string;
  password: string;
  name: string | null;
}): Promise<string> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw appError('INVALID_INPUT', {
      message: 'Un compte existe déjà avec cette adresse. Connecte-toi plutôt.',
      status: 409,
    });
  }

  const passwordHash = await hashPassword(input.password);
  const name = input.name?.trim() || null;

  const adoptedId = await adoptLegacyAccount({ email, name, passwordHash });
  if (adoptedId) return adoptedId;

  const created = await prisma.user.create({
    data: { email, name, passwordHash, lastLoginAt: new Date() },
  });

  return created.id;
}

/**
 * Connexion par mot de passe.
 *
 * Un seul message d'échec pour tous les cas — adresse inconnue, compte sans
 * mot de passe (Google uniquement), mot de passe faux — et un temps de
 * réponse identique grâce au hash factice. Ni le message ni le chronomètre ne
 * permettent de savoir si une adresse est inscrite.
 */
export async function authenticateWithPassword(
  emailInput: string,
  password: string,
): Promise<string> {
  const email = normalizeEmail(emailInput);
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const valid = await verifyPassword(password, hash);

  if (!user || !user.passwordHash || !valid) {
    throw appError('INVALID_INPUT', {
      message: 'Adresse ou mot de passe incorrect.',
      status: 401,
    });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user.id;
}

/**
 * Change (ou définit) le mot de passe d'un compte connecté.
 *
 * Le mot de passe actuel est exigé s'il en existe un : une session laissée
 * ouverte sur un ordinateur partagé ne doit pas suffire à verrouiller le
 * propriétaire hors de son compte. Un compte Google sans mot de passe peut en
 * définir un directement — sa session prouve déjà son identité.
 */
export async function changePassword(
  userId: string,
  currentPassword: string | null,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (user.passwordHash) {
    const valid = currentPassword ? await verifyPassword(currentPassword, user.passwordHash) : false;
    if (!valid) {
      throw appError('INVALID_INPUT', {
        message: 'Le mot de passe actuel est incorrect.',
        status: 403,
      });
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
}

/** Nom à afficher à côté d'une recette publique. */
export function publicAuthorName(user: {
  displayName: string | null;
  name: string | null;
}): string {
  return user.displayName?.trim() || user.name?.trim() || 'Anonyme';
}

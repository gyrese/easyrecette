import { LEGACY_USER_EMAIL, prisma } from '../../database/client.js';
import type { GoogleProfile } from './google.js';

/**
 * Résolution du compte à partir d'un profil Google.
 *
 * Trois cas, dans cet ordre :
 *  1. le `googleId` est déjà connu → c'est ce compte, on rafraîchit le profil ;
 *  2. l'email existe sans `googleId` → on adopte le compte (voir plus bas) ;
 *  3. rien → création.
 */

/**
 * Reprise du compte mono-utilisateur du MVP.
 *
 * Avant l'authentification, toutes les recettes appartenaient à un compte
 * technique `local@cookbook.app`. Le premier utilisateur qui se connecte en
 * hérite : ses recettes existantes deviennent les siennes, privées, sans
 * migration de données ni perte.
 *
 * Le transfert ne se fait qu'une fois — la fois suivante, le compte local n'a
 * plus de recettes et le second utilisateur démarre sur un fichier vide, ce
 * qui est bien le comportement voulu. Concrètement : on renomme le compte
 * local au lieu de déplacer les lignes, donc les recettes, imports, listes de
 * courses et favoris suivent d'un bloc, sans requête de masse.
 */
async function adoptLegacyAccount(profile: GoogleProfile): Promise<string | null> {
  const legacy = await prisma.user.findUnique({
    where: { email: LEGACY_USER_EMAIL },
    select: { id: true, googleId: true, _count: { select: { recipes: true } } },
  });

  // Déjà rattaché à quelqu'un, ou vide : rien à reprendre.
  if (!legacy || legacy.googleId || legacy._count.recipes === 0) return null;

  const adopted = await prisma.user.update({
    where: { id: legacy.id },
    data: {
      email: profile.email,
      googleId: profile.googleId,
      name: profile.name,
      avatarUrl: profile.picture,
      lastLoginAt: new Date(),
    },
  });

  console.log(
    `[auth] compte local repris par ${profile.email} ` +
      `(${legacy._count.recipes} recette(s) transférée(s))`,
  );

  return adopted.id;
}

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

  const adoptedId = await adoptLegacyAccount(profile);
  if (adoptedId) return adoptedId;

  /*
   * Email déjà présent sans googleId : compte créé avant l'authentification.
   * On le rattache plutôt que d'échouer sur la contrainte d'unicité — c'est
   * sans risque puisque Google nous a confirmé que l'adresse est vérifiée.
   */
  const byEmail = await prisma.user.findUnique({
    where: { email: profile.email },
    select: { id: true },
  });

  if (byEmail) {
    await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        googleId: profile.googleId,
        name: profile.name,
        avatarUrl: profile.picture,
        lastLoginAt: new Date(),
      },
    });
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

/** Nom à afficher à côté d'une recette publique. */
export function publicAuthorName(user: {
  displayName: string | null;
  name: string | null;
}): string {
  return user.displayName?.trim() || user.name?.trim() || 'Anonyme';
}

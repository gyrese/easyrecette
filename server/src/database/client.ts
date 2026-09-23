import { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

/**
 * Client Prisma unique.
 *
 * En développement, `tsx watch` recharge le module à chaque changement ; sans
 * ce cache global on ouvrirait une nouvelle connexion à chaque rechargement
 * jusqu'à saturer la base.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isProd ? ['error'] : ['warn', 'error'],
  });

if (!config.isProd) globalForPrisma.prisma = prisma;

/**
 * Identifiant du compte utilisé par l'application.
 *
 * Le MVP est mono-utilisateur (choix assumé) : le modèle User existe en base
 * et toutes les requêtes sont déjà scopées par userId, mais il n'y a pas
 * d'authentification. Ajouter un vrai login ne demandera que de remplacer
 * cette fonction par une lecture de session.
 */
const LOCAL_USER_EMAIL = 'local@cookbook.app';

let cachedUserId: string | null = null;

export async function getCurrentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const user = await prisma.user.upsert({
    where: { email: LOCAL_USER_EMAIL },
    update: {},
    create: { email: LOCAL_USER_EMAIL, name: 'Moi' },
  });

  cachedUserId = user.id;
  return user.id;
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

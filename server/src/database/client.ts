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
 * Adresse du compte technique du MVP mono-utilisateur.
 *
 * Il n'est plus créé (voir prisma/seed.ts) mais la constante reste : c'est
 * elle qui permet au premier utilisateur qui se connecte d'hériter des
 * recettes d'avant l'authentification (voir services/auth/accounts.ts).
 */
export const LEGACY_USER_EMAIL = 'local@cookbook.app';

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

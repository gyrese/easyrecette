import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Configuration serveur, validée au démarrage.
 *
 * Toute clé d'API vit ici et nulle part ailleurs : rien n'est exposé au client
 * (§19). Le serveur démarre même sans clé IA — seul l'import automatique est
 * alors désactivé, l'ajout manuel de recettes continue de fonctionner.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === '1' || v.toLowerCase() === 'true'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL est requis (voir .env.example)'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  AI_PROVIDER: z.enum(['anthropic', 'openai', 'gemini']).default('anthropic'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  YOUTUBE_API_KEY: z.string().optional(),

  // --- Authentification Google ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /*
   * Adresse publique du serveur, utilisée pour construire l'URL de redirection
   * OAuth. Elle doit correspondre exactement à celle déclarée dans la console
   * Google, sinon Google refuse l'échange du code.
   */
  PUBLIC_SERVER_URL: z.string().url().default('http://localhost:4000'),
  /** Où renvoyer le navigateur après connexion. */
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  /*
   * Secret de signature du cookie de session. Obligatoire en production :
   * sans lui, un cookie forgé serait accepté. En développement, un secret
   * éphémère est dérivé au démarrage (les sessions ne survivent pas à un
   * redémarrage, ce qui est acceptable et même souhaitable localement).
   */
  SESSION_SECRET: z.string().min(32).optional(),
  /** Durée de vie d'une session, en jours. */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(400).default(30),

  FETCH_MAX_BYTES: z.coerce.number().int().min(1024).default(2 * 1024 * 1024),
  FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  ALLOW_PRIVATE_ADDRESSES: bool(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`\nConfiguration invalide :\n${details}\n\nCopie server/.env.example vers server/.env.\n`);
  process.exit(1);
}

const env = parsed.data;

/**
 * Secret de session.
 *
 * En production il doit venir de l'environnement : un secret régénéré à
 * chaque déploiement déconnecterait tout le monde, et un secret absent
 * ouvrirait la porte aux cookies forgés. En développement on en tire un au
 * hasard plutôt que d'en coder un en dur — un secret par défaut publié dans
 * un dépôt n'est pas un secret.
 */
const sessionSecret = (() => {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;

  if (env.NODE_ENV === 'production') {
    console.error(
      '\nSESSION_SECRET est requis en production.\n' +
        'Génère-le une fois puis conserve-le dans ton environnement :\n' +
        '  node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))"\n',
    );
    process.exit(1);
  }

  return randomBytes(48).toString('hex');
})();

/** Un provider n'est utilisable que si sa clé est présente. */
const availableProviders = (['anthropic', 'openai', 'gemini'] as const).filter((p) => {
  if (p === 'anthropic') return Boolean(env.ANTHROPIC_API_KEY);
  if (p === 'openai') return Boolean(env.OPENAI_API_KEY);
  return Boolean(env.GEMINI_API_KEY);
});

/**
 * Ordre d'essai : le provider demandé d'abord, puis les autres en repli.
 * Permet de survivre à un rate limit ou une panne d'un fournisseur.
 */
const providerOrder = [
  ...availableProviders.filter((p) => p === env.AI_PROVIDER),
  ...availableProviders.filter((p) => p !== env.AI_PROVIDER),
];

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  corsOrigins: env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  ai: {
    /** Vide si aucune clé n'est configurée : l'import IA renverra AI_UNAVAILABLE. */
    order: providerOrder,
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL },
    openai: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL },
    gemini: { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
  },

  youtube: { apiKey: env.YOUTUBE_API_KEY },

  auth: {
    /** false = les routes de connexion répondent GOOGLE_NOT_CONFIGURED. */
    googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      /** Doit figurer telle quelle dans « URI de redirection autorisés ». */
      redirectUri: `${env.PUBLIC_SERVER_URL.replace(/\/$/, '')}/api/auth/google/callback`,
    },
    appUrl: env.PUBLIC_APP_URL.replace(/\/$/, ''),
    sessionSecret,
    sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  },

  fetch: {
    maxBytes: env.FETCH_MAX_BYTES,
    timeoutMs: env.FETCH_TIMEOUT_MS,
    maxRedirects: env.FETCH_MAX_REDIRECTS,
    allowPrivateAddresses: env.ALLOW_PRIVATE_ADDRESSES,
  },
} as const;

export type AiProvider = (typeof config.ai.order)[number];

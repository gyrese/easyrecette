import 'dotenv/config';
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

  fetch: {
    maxBytes: env.FETCH_MAX_BYTES,
    timeoutMs: env.FETCH_TIMEOUT_MS,
    maxRedirects: env.FETCH_MAX_REDIRECTS,
    allowPrivateAddresses: env.ALLOW_PRIVATE_ADDRESSES,
  },
} as const;

export type AiProvider = (typeof config.ai.order)[number];

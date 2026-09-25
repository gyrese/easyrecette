import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { disconnect, prisma } from './database/client.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { router } from './routes/index.js';
import { cleanExpiredSessions } from './services/auth/session.js';
import { cleanTempMedia, MEDIA_ROOT } from './services/media/storage.js';
import { isAiConfigured } from './services/recipeAI/index.js';

const app = express();

// Derrière un proxy (déploiement), express-rate-limit a besoin de l'IP réelle.
app.set('trust proxy', 1);

app.use(
  helmet({
    // L'API ne sert que du JSON ; la CSP est la responsabilité du front.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  }),
);

// Plafond volontairement bas : les payloads sont des recettes, pas des fichiers.
app.use(express.json({ limit: '1mb' }));

/*
 * Cookies signés : le cookie de session et l'état OAuth.
 *
 * La signature n'apporte pas la confidentialité (le jeton reste lisible dans
 * le navigateur, c'est le principe) mais l'intégrité : un cookie bricolé à la
 * main est rejeté avant même d'atteindre la base.
 */
app.use(cookieParser(config.auth.sessionSecret));

if (!config.isProd) {
  app.use(morgan('dev'));
}

/*
 * Médias des recettes importées (vidéos et vignettes).
 *
 * Servis en statique avec un cache long : une fois rattaché à une recette,
 * un fichier ne change plus — son nom est dérivé de l'identifiant de la
 * recette, donc une nouvelle version aurait une nouvelle adresse.
 */
app.use(
  '/media',
  express.static(MEDIA_ROOT, {
    maxAge: '30d',
    immutable: true,
    index: false,
    dotfiles: 'deny',
  }),
);

app.use('/api', router);

app.use(notFoundHandler);
app.use(errorHandler);

/** Vérifie que la base répond avant d'accepter du trafic. */
async function checkDatabase(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error(
      "\nImpossible de joindre la base de données.\n" +
        "Vérifie DATABASE_URL dans server/.env, puis lance :\n" +
        '  npm run db:push\n',
    );
    throw error;
  }
}

async function start(): Promise<void> {
  await checkDatabase();

  // Les imports interrompus laissent des vidéos temporaires derrière eux.
  await cleanTempMedia();

  // Les sessions périmées aussi : la base se nettoie au démarrage plutôt que
  // par une tâche planifiée à surveiller.
  const purged = await cleanExpiredSessions();
  if (purged > 0) console.log(`  ${purged} session(s) expirée(s) purgée(s)`);

  const server = app.listen(config.port, () => {
    console.log(`\n  CookBook API  →  http://localhost:${config.port}/api`);
    console.log(`  Environnement : ${config.env}`);
    console.log(
      `  IA            : ${
        isAiConfigured() ? config.ai.order.join(', ') : 'non configurée (import automatique indisponible)'
      }`,
    );
    console.log(
      `  Connexion     : e-mail${
        config.auth.googleConfigured
          ? ` + Google (retour sur ${config.auth.google.redirectUri})`
          : ' uniquement (Google non configuré)'
      }\n`,
    );

    // Un déploiement en production sans cookie `secure` est un choix possible
    // (test avant HTTPS), mais jamais un choix silencieux.
    if (config.isProd && !config.auth.cookieSecure) {
      console.warn(
        '  ⚠ COOKIE_SECURE=false : mots de passe et sessions circulent en clair.\n' +
          '    Acceptable pour un test, pas pour un site ouvert. Passe en HTTPS dès que possible.\n',
      );
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} reçu, arrêt en cours…`);
    server.close();
    await disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('Démarrage impossible :', error);
  process.exit(1);
});

import { config } from '../../config.js';
import { appError } from '../../utils/errors.js';

/**
 * OAuth 2.0 Google, en deux appels HTTP et sans SDK.
 *
 * Le flux « Authorization Code » suffit ici : le navigateur part chez Google,
 * revient avec un code, et le serveur l'échange contre un jeton d'identité.
 * Rien n'est jamais validé côté client, et le client_secret ne quitte pas le
 * serveur.
 *
 * Le SDK officiel (google-auth-library) ferait la même chose au prix d'une
 * dépendance de plus à auditer : on n'utilise que deux endpoints, tous deux
 * stables et documentés.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
/** Vérifie la signature du jeton côté Google — pas de JWKS à gérer ici. */
const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';

/** Timeout réseau propre à l'authentification : court, c'est interactif. */
const AUTH_TIMEOUT_MS = 10_000;

export interface GoogleProfile {
  /** `sub` : identifiant stable du compte Google. */
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function ensureConfigured(): void {
  if (!config.auth.googleConfigured) {
    throw appError('INTERNAL', {
      message:
        "La connexion Google n'est pas configurée sur ce serveur. " +
        'Renseigne GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.',
      status: 503,
    });
  }
}

/**
 * URL vers laquelle rediriger le navigateur pour lancer la connexion.
 *
 * `prompt=select_account` plutôt que rien : quand plusieurs comptes Google
 * sont ouverts dans le navigateur, on laisse l'utilisateur choisir au lieu de
 * le connecter silencieusement sur le premier.
 */
export function buildAuthUrl(state: string): string {
  ensureConfigured();

  const params = new URLSearchParams({
    client_id: config.auth.google.clientId,
    redirect_uri: config.auth.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    // Pas d'accès hors ligne : on n'appelle aucune API Google au nom de
    // l'utilisateur, donc aucun refresh token à stocker.
    access_type: 'online',
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function postForm(url: string, body: URLSearchParams): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; error_description?: string }
      | null;

    if (!response.ok) {
      throw appError('AI_ERROR', {
        message: "Google a refusé la connexion. Réessaie dans un instant.",
        detail: `${response.status} ${payload?.error ?? ''} ${payload?.error_description ?? ''}`.trim(),
        status: 502,
      });
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw appError('TIMEOUT', {
        message: 'Google a mis trop de temps à répondre.',
        status: 504,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Échange le code d'autorisation contre le profil de l'utilisateur.
 *
 * Le `id_token` renvoyé par Google est un JWT signé. Plutôt que d'embarquer
 * une bibliothèque JWKS pour vérifier sa signature localement, on le fait
 * valider par l'endpoint `tokeninfo` de Google : un aller-retour de plus,
 * mais aucune clé publique à mettre en cache ni à faire tourner. À l'échelle
 * d'une connexion par mois et par utilisateur, c'est le bon compromis.
 *
 * Les trois contrôles qui comptent sont refaits ici, sans faire confiance à
 * la réponse : l'audience est bien notre client_id, l'émetteur est bien
 * Google, et l'adresse est vérifiée.
 */
export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  ensureConfigured();

  const tokens = (await postForm(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      code,
      client_id: config.auth.google.clientId,
      client_secret: config.auth.google.clientSecret,
      redirect_uri: config.auth.google.redirectUri,
      grant_type: 'authorization_code',
    }),
  )) as { id_token?: string } | null;

  const idToken = tokens?.id_token;
  if (!idToken) {
    throw appError('AI_ERROR', {
      message: "Google n'a pas renvoyé d'identité vérifiable.",
      status: 502,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  let claims: Record<string, unknown> | null;
  try {
    const response = await fetch(
      `${TOKENINFO_ENDPOINT}?id_token=${encodeURIComponent(idToken)}`,
      { signal: controller.signal },
    );
    claims = response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    claims = null;
  } finally {
    clearTimeout(timer);
  }

  if (!claims) {
    throw appError('AI_ERROR', {
      message: "L'identité renvoyée par Google n'a pas pu être vérifiée.",
      status: 502,
    });
  }

  const aud = typeof claims['aud'] === 'string' ? claims['aud'] : '';
  const iss = typeof claims['iss'] === 'string' ? claims['iss'] : '';
  const sub = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const email = typeof claims['email'] === 'string' ? claims['email'].toLowerCase() : '';
  // `email_verified` arrive en chaîne "true" depuis tokeninfo, en booléen ailleurs.
  const verified = claims['email_verified'] === true || claims['email_verified'] === 'true';

  if (aud !== config.auth.google.clientId) {
    throw appError('INVALID_INPUT', {
      message: 'Cette connexion ne vient pas de cette application.',
      detail: `audience inattendue : ${aud}`,
      status: 401,
    });
  }

  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw appError('INVALID_INPUT', {
      message: "L'émetteur de cette connexion n'est pas Google.",
      detail: `émetteur : ${iss}`,
      status: 401,
    });
  }

  if (!sub || !email) {
    throw appError('INVALID_INPUT', {
      message: "Google n'a pas fourni d'adresse e-mail pour ce compte.",
      status: 401,
    });
  }

  if (!verified) {
    throw appError('INVALID_INPUT', {
      message:
        "L'adresse de ce compte Google n'est pas vérifiée. Vérifie-la chez Google puis réessaie.",
      status: 403,
    });
  }

  return {
    googleId: sub,
    email,
    emailVerified: true,
    name: typeof claims['name'] === 'string' ? claims['name'] : null,
    picture: typeof claims['picture'] === 'string' ? claims['picture'] : null,
  };
}

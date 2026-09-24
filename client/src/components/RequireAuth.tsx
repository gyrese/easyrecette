import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Spinner } from './ui';

/**
 * Garde de route : ce qui est derrière exige un compte.
 *
 * Le cas `loading` est traité à part et ne redirige PAS. Sans lui, chaque
 * rechargement d'une page privée enverrait l'utilisateur sur /login pendant
 * l'aller-retour vers /auth/me, avant de le ramener — un clignotement à
 * chaque F5 pour quelqu'un de parfaitement connecté.
 *
 * La page demandée voyage dans `next` : après connexion, on revient
 * exactement où on allait, et pas sur un accueil générique.
 *
 * Cette garde est un confort d'interface, pas une sécurité : c'est le serveur
 * qui protège les données (voir server/src/routes/index.ts). Contourner
 * celle-ci ne donnerait accès qu'à des pages vides.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="size-6 text-ink-faint" />
      </div>
    );
  }

  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}

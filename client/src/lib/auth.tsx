import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { AuthUser } from './types';

/**
 * État de connexion, partagé par toute l'application.
 *
 * Un contexte plutôt qu'un appel par page : l'en-tête, les gardes de route et
 * les fiches recette ont tous besoin de savoir qui est connecté, et trois
 * appels concurrents à /auth/me au chargement seraient du gaspillage.
 *
 * Trois états distincts, jamais confondus :
 *  - `loading` : on ne sait pas encore. Il ne faut RIEN décider pendant ce
 *    temps — afficher la page de connexion ici ferait clignoter l'appli à
 *    chaque rechargement pour un utilisateur parfaitement connecté ;
 *  - `user === null` : visiteur anonyme. Ce n'est pas une erreur, c'est un
 *    état normal qui donne accès à la page Découvrir ;
 *  - `user` renseigné : connecté.
 */

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  /** false = le serveur n'a pas de clés Google : inutile de proposer le bouton. */
  googleConfigured: boolean;
  /** Nom sous lequel l'utilisateur publie ses recettes. */
  authorName: string;
  /** Recharge l'état depuis le serveur (après connexion, ou sur un 401). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Met à jour le nom d'auteur, localement et côté serveur. */
  setDisplayName: (name: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleConfigured, setGoogleConfigured] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const state = await api.me();
      setUser(state.user);
      setGoogleConfigured(state.googleConfigured);
    } catch {
      /*
       * Serveur injoignable : on reste sur « déconnecté » plutôt que de
       * bloquer l'appli sur un écran de chargement. L'utilisateur verra le
       * vrai message d'erreur réseau à sa première action.
       */
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    // Vidé localement quoi qu'il arrive : si le serveur n'a pas répondu, le
    // cookie a peut-être déjà expiré, et laisser l'utilisateur « connecté »
    // à l'écran serait mentir.
    setUser(null);
  }, []);

  const setDisplayName = useCallback(async (name: string | null) => {
    const { user: updated } = await api.updateProfile(name);
    setUser(updated);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      googleConfigured,
      authorName: user?.displayName?.trim() || user?.name?.trim() || 'Anonyme',
      refresh,
      logout,
      setDisplayName,
    }),
    [user, loading, googleConfigured, refresh, logout, setDisplayName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return context;
}

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IconGoogle, IconLogout, IconUser } from './Icons';
import { Label, Spinner } from './ui';

/**
 * Le coin du compte, dans l'en-tête.
 *
 * Trois états, correspondant exactement à ceux du contexte d'auth :
 *  - chargement : un simple disque, sans texte. Afficher « Se connecter »
 *    puis le remplacer par un avatar ferait sauter l'en-tête à chaque
 *    rechargement de page ;
 *  - anonyme : le bouton de connexion, qui garde la page courante en
 *    mémoire pour y revenir ;
 *  - connecté : l'avatar, qui ouvre le menu.
 *
 * Le menu se ferme au clic extérieur et à Échap. Les deux, parce qu'on
 * l'ouvre autant à la souris qu'au clavier, et qu'un menu qui reste ouvert
 * derrière une navigation est un fantôme.
 */
export function AccountMenu() {
  const { user, loading, googleConfigured, authorName, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Une navigation referme le menu : sans ça, cliquer « Mes recettes »
  // laisserait le panneau ouvert par-dessus la nouvelle page.
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (loading) {
    return (
      <span className="grid size-11 place-items-center" aria-label="Chargement du compte">
        <Spinner className="size-4 text-ink-faint" />
      </span>
    );
  }

  if (!user) {
    /* Pas de clés Google côté serveur : on mène quand même à /login, qui
       explique ce qui manque. Un bouton absent laisserait l'utilisateur sans
       aucune piste. */
    const next = `${location.pathname}${location.search}`;

    return googleConfigured ? (
      <a
        href={api.loginUrl(next)}
        className="press inline-flex min-h-11 items-center gap-2 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-[15px] py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] text-ink uppercase"
      >
        <IconGoogle className="text-base" />
        <span className="max-sm:hidden">Se connecter</span>
      </a>
    ) : (
      <Link
        to="/login"
        className="inline-flex min-h-11 items-center gap-2 rounded-control border-[1.5px] border-rule-strong px-[15px] py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] text-ink uppercase hover:bg-lime"
      >
        <IconUser className="text-base" />
        <span className="max-sm:hidden">Compte</span>
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Compte de ${authorName}`}
        className="grid size-11 place-items-center overflow-hidden rounded-full border-[1.5px] border-rule-strong bg-paper-raised text-ink transition-colors hover:bg-lime"
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="font-display text-[17px] leading-none">
            {authorName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[268px] overflow-hidden rounded-card border-[1.5px] border-rule-strong bg-paper-raised shadow-hero"
        >
          <div className="border-b-[1.5px] border-rule-strong px-4 py-3.5">
            <Label as="p">Connecté</Label>
            <p className="mt-1.5 truncate font-display text-[19px] leading-tight text-ink">
              {authorName}
            </p>
            {/* L'adresse, en petit : c'est ce qui permet de vérifier d'un
                coup d'œil sur quel compte Google on est tombé. */}
            <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">{user.email}</p>
          </div>

          <div className="flex flex-col py-1.5">
            <MenuLink to="/recipes">Mes recettes</MenuLink>
            <MenuLink to="/shopping-list">Ma liste de courses</MenuLink>
            <MenuLink to="/account">Mon compte</MenuLink>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              // Retour sur la découverte plutôt que sur la page courante :
              // celle-ci était peut-être privée, et y rester afficherait un
              // écran vide ou une redirection de plus.
              navigate('/discover');
            }}
            className="flex w-full items-center gap-2.5 border-t-[1.5px] border-rule-strong px-4 py-3 text-left font-mono text-[10px] font-medium tracking-[0.16em] text-ink uppercase transition-colors hover:bg-ember hover:text-ember-ink"
          >
            <IconLogout className="text-base" />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      role="menuitem"
      className="px-4 py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] text-ink/70 uppercase transition-colors hover:bg-lime hover:text-ink"
    >
      {children}
    </Link>
  );
}

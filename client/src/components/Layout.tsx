import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { AccountMenu } from './AccountMenu';
import { IconBook, IconCart, IconGlobe, IconSparkle } from './Icons';

/**
 * Coquille de l'application.
 *
 * Trois strates fixes, dans cet ordre de profondeur :
 *  1. les halos colorés, très flous, qui donnent de la chaleur au crème ;
 *  2. le bandeau défilant, qui annonce l'édition comme la manchette d'un
 *     journal ;
 *  3. l'en-tête collant, translucide, cerné d'un filet noir plein.
 *
 * Deux navigations distinctes selon la taille d'écran :
 *  - mobile : une barre basse fixe, à portée de pouce. C'est le cas d'usage
 *    principal (§17) ;
 *  - desktop : un segment unique cerné de noir dans l'en-tête, où l'onglet
 *    actif s'inverse en noir plein.
 *
 * La navigation dépend de l'état de connexion :
 *  - connecté : importer, ses recettes, découvrir, courses ;
 *  - anonyme : découvrir seulement. Montrer « Mes recettes » à qui n'a pas de
 *    compte serait une promesse qui mène à un écran de connexion — autant
 *    proposer directement ce qui marche, et laisser le bouton du compte faire
 *    son travail.
 *
 * Quatre entrées maximum : au-delà, la barre basse du téléphone devient
 * illisible et chaque cible passe sous les 44 px recommandés.
 */

const NAV_SIGNED_IN = [
  { to: '/', label: 'Importer', icon: IconSparkle, exact: true },
  { to: '/recipes', label: 'Mes recettes', icon: IconBook, exact: false },
  { to: '/discover', label: 'Découvrir', icon: IconGlobe, exact: false },
  { to: '/shopping-list', label: 'Courses', icon: IconCart, exact: false },
] as const;

const NAV_ANONYMOUS = [
  { to: '/discover', label: 'Découvrir', icon: IconGlobe, exact: false },
] as const;

/** Les brèves du bandeau. Répétées deux fois pour un défilement sans couture. */
const TICKER = [
  'Extraction IA',
  'Fiches classées par rayon',
  'Portions recalculées en direct',
  'Liste de courses fusionnée',
  'Minuteurs par étape',
];

function TickerRun() {
  return (
    <span className="flex shrink-0 gap-[34px] whitespace-nowrap pr-[34px]">
      {TICKER.map((item) => (
        <span key={item} className="flex gap-[34px]">
          {item}
          <span className="text-lime" aria-hidden="true">
            ·
          </span>
        </span>
      ))}
    </span>
  );
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  /* Pendant le chargement on affiche la navigation d'invité : elle est un
     sous-ensemble de l'autre, donc rien ne disparaît à l'arrivée de la
     session — des entrées s'ajoutent. L'inverse ferait clignoter la barre. */
  const nav = user ? NAV_SIGNED_IN : NAV_ANONYMOUS;

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Halos : purement atmosphériques, jamais cliquables. */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="animate-er-drift absolute -top-[18%] -right-[10%] size-[52vw] rounded-full bg-[radial-gradient(circle,rgb(214_70_31/0.17),transparent_68%)] blur-[24px]" />
        <div className="animate-er-drift absolute -bottom-[24%] -left-[12%] size-[46vw] rounded-full bg-[radial-gradient(circle,rgb(216_242_80/0.26),transparent_68%)] blur-[28px] [animation-direction:reverse] [animation-duration:28s]" />
      </div>

      {/* Manchette défilante. Décorative : masquée aux lecteurs d'écran, qui
          n'ont rien à gagner à entendre une liste d'arguments en boucle. */}
      <div
        className="relative z-40 overflow-hidden bg-ink text-paper"
        aria-hidden="true"
      >
        <div className="animate-er-tick flex w-max py-[9px] font-mono text-[11px] font-normal tracking-[0.24em] uppercase">
          <TickerRun />
          <TickerRun />
        </div>
      </div>

      <header className="sticky top-0 z-45 border-b-[1.5px] border-rule-strong bg-paper/82 backdrop-blur-[18px] backdrop-saturate-140">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-[18px] px-4 py-3 sm:px-6">
          <NavLink to="/" className="mr-1.5 flex items-baseline gap-[9px] text-ink hover:text-ink">
            <span className="font-display text-[27px] leading-none tracking-[-0.02em]">
              EasyRecette
            </span>
            <span className="hidden font-mono text-[9.5px] font-normal tracking-[0.2em] text-ink-faint uppercase sm:inline">
              Éd. 26
            </span>
          </NavLink>

          <nav className="hidden items-center overflow-hidden rounded-control border-[1.5px] border-rule-strong sm:flex">
            {nav.map(({ to, label, exact }, index) => (
              <NavLink
                key={to}
                to={to}
                end={exact}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center px-[15px] py-2.5 font-mono text-[10px] font-medium tracking-[0.16em] uppercase transition-colors duration-200 ${
                    index > 0 ? 'border-l-[1.5px] border-rule-strong' : ''
                  } ${
                    isActive
                      ? 'bg-ink text-paper hover:text-paper'
                      : 'text-ink/62 hover:bg-lime hover:text-ink'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {/* La création n'a de sens qu'avec un fichier où ranger la fiche :
              proposée à un visiteur anonyme, elle ne mènerait qu'à l'écran de
              connexion. Le menu du compte, lui, est toujours là. */}
          {user && (
            <button
              type="button"
              onClick={() => navigate('/recipe/new')}
              className="press sheen inline-flex min-h-11 items-center gap-2 rounded-control border-[1.5px] border-rule-strong bg-lime px-[18px] py-[11px] font-mono text-[11px] font-medium tracking-[0.14em] text-ink uppercase max-sm:hidden"
            >
              + Nouvelle fiche
            </button>
          )}

          <AccountMenu />
        </div>
      </header>

      {/* pb-28 réserve la place de la barre mobile fixe. */}
      <main className="relative z-10 flex-1 pb-28 sm:pb-16">
        <Outlet key={location.pathname} />
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-[1.5px] border-rule-strong bg-paper-raised/95 backdrop-blur-lg sm:hidden">
        <div className="flex">
          {nav.map(({ to, label, icon: Icon, exact }, index) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `label-mono-sm flex flex-1 flex-col items-center gap-1.5 py-3 text-[8.5px] transition-colors ${
                  index > 0 ? 'border-l-[1.5px] border-rule' : ''
                } ${isActive ? 'bg-ink text-paper hover:text-paper' : 'text-ink-soft'}`
              }
            >
              <Icon className="text-xl" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

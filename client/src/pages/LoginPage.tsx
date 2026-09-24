import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconGlobe, IconGoogle } from '../components/Icons';
import { ErrorPanel, FadeIn, Label } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Page de connexion.
 *
 * Le bouton est un vrai lien, pas un `fetch` : le flux OAuth enchaîne des
 * redirections que seul le navigateur peut suivre. Une requête XHR se
 * ferait couper par la politique CORS de Google dès le premier saut.
 *
 * L'erreur affichée ici arrive en paramètre d'URL : le callback serveur ne
 * peut pas renvoyer du JSON à un client qui n'écoute pas — c'est une
 * navigation complète. Le message est écrit pour être lu tel quel (voir
 * authController.redirectWithError).
 */

/** Ce qu'on peut faire sans compte, dit franchement. */
const WITHOUT_ACCOUNT = [
  'Parcourir les recettes partagées par les autres',
  'Lire une fiche en entier, ingrédients et étapes',
  'Suivre le mode cuisine, minuteurs compris',
];

const WITH_ACCOUNT = [
  'Importer une vidéo ou un article en fiche structurée',
  'Garder tes recettes dans un fichier privé',
  'Noter ce que tu as essayé, et ce que ça valait',
  'Composer ta liste de courses à partir de tes fiches',
  'Partager les recettes que tu veux, quand tu veux',
];

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading, googleConfigured } = useAuth();

  const error = params.get('error');
  const next = params.get('next') ?? '/recipes';

  /*
   * Déjà connecté : on s'en va. Le cas arrive en revenant en arrière après
   * une connexion, ou en ouvrant /login depuis un favori.
   */
  useEffect(() => {
    if (!loading && user) navigate(next, { replace: true });
  }, [loading, user, next, navigate]);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6 sm:py-14">
      <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <FadeIn>
          <Label>Compte</Label>
          <h1 className="mt-3 text-hero">
            Ta cuisine,
            <br />
            à ton nom.
          </h1>
          <p className="mt-6 max-w-md text-[16px] leading-[1.62] text-ink-soft">
            Connecte-toi pour garder tes recettes dans un fichier qui n'appartient qu'à toi. Ce
            que tu importes reste privé par défaut : tu choisis fiche par fiche ce que tu rends
            public.
          </p>

          <div className="mt-9">
            {error && (
              <ErrorPanel
                title="Connexion impossible"
                message={error}
                className="mb-6 max-w-md"
              />
            )}

            {googleConfigured ? (
              <a
                href={api.loginUrl(next)}
                className="press sheen inline-flex min-h-13 items-center justify-center gap-3 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-6 py-3 font-mono text-[12px] font-medium tracking-[0.2em] text-ink uppercase"
              >
                <IconGoogle className="text-xl" />
                Continuer avec Google
              </a>
            ) : (
              /* Pas de clés côté serveur : afficher un bouton qui ne peut pas
                 marcher serait pire que de dire ce qui manque. */
              <ErrorPanel
                title="Connexion indisponible"
                message="Ce serveur n'a pas de clés Google configurées. Renseigne GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans server/.env, puis redémarre-le."
                className="max-w-md"
              />
            )}

            <p className="mt-5 max-w-md text-[13px] leading-[1.6] text-ink-faint">
              EasyRecette ne reçoit de Google que ton adresse, ton nom et ta photo de profil.
              Aucun accès à tes autres données, et rien n'est publié en ton nom.
            </p>
          </div>

          <div className="mt-10">
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.16em] text-ink uppercase underline decoration-ember decoration-2 underline-offset-4 hover:text-ember"
            >
              <IconGlobe className="text-base" />
              Parcourir sans compte
            </Link>
          </div>
        </FadeIn>

        <FadeIn delay={0.12}>
          <div className="rounded-control border-[1.5px] border-rule-strong bg-paper-raised">
            <div className="border-b-[1.5px] border-rule-strong px-6 py-5">
              <Label as="h2">Sans compte</Label>
              <ul className="mt-4 space-y-2.5">
                {WITHOUT_ACCOUNT.map((item) => (
                  <li key={item} className="flex gap-3 text-[14px] leading-[1.55] text-ink-soft">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-faint" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="px-6 py-5">
              <Label as="h2" className="text-ember">
                Avec un compte
              </Label>
              <ul className="mt-4 space-y-2.5">
                {WITH_ACCOUNT.map((item) => (
                  <li key={item} className="flex gap-3 text-[14px] leading-[1.55] text-ink">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

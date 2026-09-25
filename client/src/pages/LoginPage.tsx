import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { IconGlobe, IconGoogle } from '../components/Icons';
import { Button, ErrorPanel, FadeIn, Input, Label } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Page de connexion.
 *
 * Deux portes, qui mènent aux mêmes comptes :
 *
 *  - e-mail + mot de passe : toujours disponible, c'est la porte par défaut.
 *    Un seul formulaire bascule entre connexion et inscription plutôt que
 *    deux pages : la personne qui ne sait plus si elle a un compte n'a pas à
 *    chercher ailleurs ;
 *  - Google : proposé seulement si le serveur a ses clés. C'est un vrai lien
 *    et non un `fetch`, le flux OAuth enchaîne des redirections que seul le
 *    navigateur peut suivre.
 *
 * Les erreurs du flux Google arrivent en paramètre d'URL (le callback serveur
 * est une navigation complète, il ne peut pas renvoyer du JSON) ; celles du
 * formulaire arrivent par l'API habituelle.
 */

type Mode = 'login' | 'signup';

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
  const { user, loading, googleConfigured, loginWithPassword, signup } = useAuth();

  const googleError = params.get('error');
  const next = params.get('next') ?? '/recipes';

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /*
   * Déjà connecté (ou tout juste connecté par le formulaire) : on part vers la
   * page demandée. Le même effet sert aux deux cas — le formulaire n'a qu'à
   * mettre à jour le contexte, la redirection suit.
   */
  useEffect(() => {
    if (!loading && user) navigate(next, { replace: true });
  }, [loading, user, next, navigate]);

  function switchMode(target: Mode) {
    setMode(target);
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      if (mode === 'signup') {
        await signup(email, password, name.trim() || null);
      } else {
        await loginWithPassword(email, password);
      }
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'La connexion a échoué. Réessaie dans un instant.',
      );
      // On vide le mot de passe après un échec, pas l'adresse : c'est presque
      // toujours le mot de passe qui est faux, et retaper son e-mail agace.
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

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

          <div className="mt-9 max-w-md">
            {googleError && (
              <ErrorPanel title="Connexion impossible" message={googleError} className="mb-6" />
            )}

            {/* ---------------- Bascule connexion / inscription ---------------- */}
            <div
              role="tablist"
              aria-label="Connexion ou inscription"
              className="flex overflow-hidden rounded-control border-[1.5px] border-rule-strong"
            >
              {(
                [
                  ['login', 'Se connecter'],
                  ['signup', 'Créer un compte'],
                ] as const
              ).map(([value, label], index) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => switchMode(value)}
                  className={`min-h-11 flex-1 px-4 font-mono text-[10px] font-medium tracking-[0.16em] uppercase transition-colors ${
                    index > 0 ? 'border-l-[1.5px] border-rule-strong' : ''
                  } ${mode === value ? 'bg-ink text-paper' : 'text-ink/62 hover:bg-lime hover:text-ink'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* ---------------- Formulaire ---------------- */}
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {mode === 'signup' && (
                <label className="block">
                  <Label as="span" className="mb-2 block text-ink-soft">
                    Prénom ou pseudo <span className="text-ink-faint normal-case">— facultatif</span>
                  </Label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="nickname"
                    maxLength={60}
                  />
                </label>
              )}

              <label className="block">
                <Label as="span" className="mb-2 block text-ink-soft">
                  Adresse e-mail
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  required
                />
              </label>

              <label className="block">
                <Label as="span" className="mb-2 block text-ink-soft">
                  Mot de passe
                </Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  /* `new-password` à l'inscription : le gestionnaire de mots
                     de passe propose alors d'en générer un, au lieu de
                     remplir un ancien. */
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={mode === 'signup' ? 8 : undefined}
                  required
                />
                {mode === 'signup' && (
                  <span className="mt-1.5 block text-xs text-ink-faint">
                    8 caractères minimum. Une courte phrase se retient mieux qu'un mot compliqué.
                  </span>
                )}
              </label>

              {formError && <ErrorPanel message={formError} />}

              <Button
                type="submit"
                variant="lime"
                size="lg"
                loading={submitting}
                disabled={!email || !password}
                className="w-full"
              >
                {mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}
              </Button>

              {/* Pas de « mot de passe oublié » : il faudrait envoyer un mail,
                  et le serveur n'en envoie pas. Mieux vaut le dire que
                  d'afficher un lien qui ne mène nulle part. */}
              {mode === 'login' && (
                <p className="text-[12.5px] leading-[1.55] text-ink-faint">
                  Mot de passe oublié ? La réinitialisation par e-mail n'est pas encore disponible
                  — contacte l'administrateur du site.
                </p>
              )}
            </form>

            {/* ---------------- Google, s'il est configuré ---------------- */}
            {googleConfigured && (
              <>
                <div className="my-6 flex items-center gap-3" aria-hidden="true">
                  <span className="h-[1.5px] flex-1 bg-rule" />
                  <span className="label-mono-sm text-ink-faint">ou</span>
                  <span className="h-[1.5px] flex-1 bg-rule" />
                </div>

                <a
                  href={api.loginUrl(next)}
                  className="press inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-6 py-3 font-mono text-[12px] font-medium tracking-[0.2em] text-ink uppercase"
                >
                  <IconGoogle className="text-xl" />
                  Continuer avec Google
                </a>
              </>
            )}

            <p className="mt-5 text-[13px] leading-[1.6] text-ink-faint">
              Ton adresse e-mail n'est jamais affichée à d'autres utilisateurs, même quand tu
              partages une recette.
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

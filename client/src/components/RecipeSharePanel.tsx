import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Recipe } from '../lib/types';
import { IconCheck, IconGlobe, IconLink, IconLock } from './Icons';
import { Button, ErrorPanel, Input, Label } from './ui';

/**
 * Panneau de partage d'une fiche, sur la page recette.
 *
 * Trois partis pris :
 *
 *  1. Publier est un geste en deux temps, pas une bascule immédiate. Le
 *     panneau demande d'abord sous quel nom, et rappelle ce que ça implique.
 *     Une recette rendue publique par accident est difficile à rattraper :
 *     elle a pu être copiée entre-temps, et une copie appartient à celui qui
 *     l'a faite. Le clic doit donc être conscient.
 *
 *  2. Dépublier, en revanche, est immédiat — un seul clic. Refermer sa porte
 *     ne se négocie pas. Le panneau dit en revanche clairement ce que ça ne
 *     fait pas : les copies déjà enregistrées restent chez leurs
 *     propriétaires. Promettre un retrait total serait mentir.
 *
 *  3. Ce qui est publié est le contenu de la recette, pas les annotations :
 *     la note, le commentaire d'essai et le statut de favori ne sortent
 *     jamais (c'est le serveur qui les retire, voir toDto). Le panneau le dit,
 *     parce que c'est exactement la question qu'on se pose avant de partager.
 */

interface Props {
  recipe: Recipe;
  /** Reçoit la fiche mise à jour par le serveur. */
  onChange: (recipe: Recipe) => void;
}

export function RecipeSharePanel({ recipe, onChange }: Props) {
  const { authorName } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(authorName === 'Anonyme' ? '' : authorName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const publicUrl = `${window.location.origin}/recipe/${recipe.id}`;

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      // Le nom part avec la publication : une seule requête, donc pas d'état
      // intermédiaire où la recette serait publique sous « Anonyme ».
      const updated = await api.setRecipeVisibility(recipe.id, true, name.trim() || null);
      onChange(updated);
      setExpanded(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La publication a échoué.');
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.setRecipeVisibility(recipe.id, false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Le retrait a échoué.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2400);
    } catch {
      // Presse-papiers refusé (Safari sans geste direct, contexte non
      // sécurisé) : on montre l'adresse pour qu'elle reste copiable à la main.
      setError(`Copie impossible. L'adresse : ${publicUrl}`);
    }
  }

  // ---------------------------------------------------------------------
  // Publiée
  // ---------------------------------------------------------------------
  if (recipe.isPublic) {
    return (
      <section className="rounded-card border-[1.5px] border-rule-strong bg-lime-soft px-5 py-4.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Label as="h2" className="flex items-center gap-2 text-ink">
              <IconGlobe className="text-sm" />
              Recette partagée
            </Label>
            <p className="mt-2 text-[14px] leading-[1.55] text-ink-soft">
              Visible par tout le monde sur la page Découvrir, sous le nom{' '}
              <strong className="font-medium text-ink">{recipe.author.name}</strong>.
              {recipe.copyCount > 0 && (
                <>
                  {' '}
                  Reprise {recipe.copyCount} fois.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={linkCopied ? 'lime' : 'secondary'}
              icon={linkCopied ? <IconCheck /> : <IconLink />}
              onClick={copyLink}
            >
              {linkCopied ? 'Copié' : 'Copier le lien'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconLock />}
              loading={busy}
              onClick={unpublish}
            >
              Rendre privée
            </Button>
          </div>
        </div>

        <p className="mt-3.5 border-t-[1.5px] border-ink/12 pt-3 text-[13px] leading-[1.55] text-ink-faint">
          Ta note, ton commentaire d'essai et tes favoris ne sont pas partagés — seuls les
          ingrédients, les étapes et la provenance le sont. Si tu la repasses en privé, les copies
          déjà enregistrées par d'autres restent chez eux.
        </p>

        {error && <ErrorPanel className="mt-4" message={error} />}
      </section>
    );
  }

  // ---------------------------------------------------------------------
  // Privée
  // ---------------------------------------------------------------------
  return (
    <section className="rounded-card border-[1.5px] border-rule-strong bg-paper-raised px-5 py-4.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Label as="h2" className="flex items-center gap-2 text-ink">
            <IconLock className="text-sm" />
            Recette privée
          </Label>
          <p className="mt-2 text-[14px] leading-[1.55] text-ink-soft">
            Personne d'autre que toi ne peut la voir.
          </p>
        </div>

        {!expanded && (
          <Button size="sm" variant="lime" icon={<IconGlobe />} onClick={() => setExpanded(true)}>
            Partager
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-4 border-t-[1.5px] border-rule pt-4">
          <label className="block">
            <Label as="span" className="mb-2 block text-ember">
              Publier sous le nom
            </Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ton nom ou un pseudo"
              maxLength={60}
              className="max-w-sm"
            />
          </label>
          <p className="mt-2 text-[13px] leading-[1.55] text-ink-faint">
            Ce nom apparaîtra sur toutes tes recettes partagées. Laissé vide, elles seront signées
            « Anonyme ». Ton adresse e-mail n'est jamais affichée.
          </p>

          <ul className="mt-4 space-y-1.5 text-[13px] leading-[1.55] text-ink-soft">
            <li className="flex gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ember" />
              Les ingrédients, les étapes et la provenance deviennent visibles par tout le monde,
              même sans compte.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ember" />
              Ta note, ton commentaire d'essai et tes favoris restent privés.
            </li>
            <li className="flex gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ember" />
              D'autres pourront en garder une copie. Ces copies leur appartiendront, et repasser
              la fiche en privé ne les reprendra pas.
            </li>
          </ul>

          {error && <ErrorPanel className="mt-4" message={error} />}

          <div className="mt-4.5 flex flex-wrap gap-2">
            <Button variant="lime" icon={<IconGlobe />} loading={busy} onClick={publish}>
              Rendre publique
            </Button>
            <Button variant="ghost" onClick={() => setExpanded(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Rappel de la signature courante. Le renommage mène à la page
          compte plutôt que d'ouvrir un second formulaire ici : le nom
          d'auteur vaut pour toutes les fiches, pas pour celle-ci seule, et
          le modifier depuis une recette laisserait croire le contraire. */}
      {!expanded && authorName !== 'Anonyme' && (
        <p className="mt-3 text-[13px] text-ink-faint">
          Tu publies sous « {authorName} ».{' '}
          <Link
            to="/account"
            className="underline decoration-ember decoration-2 underline-offset-2 hover:text-ink"
          >
            Changer
          </Link>
        </p>
      )}

      {!expanded && error && <ErrorPanel className="mt-4" message={error} />}
    </section>
  );
}

/**
 * Bandeau affiché en haut d'une fiche publique consultée par quelqu'un
 * d'autre que son auteur.
 *
 * Il porte l'attribution et le seul geste qui a du sens ici : prendre la
 * recette pour soi. Les boutons de l'auteur (modifier, noter, supprimer) ne
 * sont pas grisés mais absents — un bouton désactivé sans explication est une
 * énigme, une absence est une réponse.
 */
export function PublicRecipeBanner({
  recipe,
  onCopied,
}: {
  recipe: Recipe;
  onCopied: (copyId: string) => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    if (!user) {
      // Connexion d'abord, puis retour sur cette fiche : la recette est
      // toujours là, et le geste peut être refait immédiatement.
      window.location.href = api.loginUrl(`/recipe/${recipe.id}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const copied = await api.copyRecipe(recipe.id);
      onCopied(copied.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'enregistrement a échoué.");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border-[1.5px] border-rule-strong bg-paper-raised px-5 py-4.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {recipe.author.avatarUrl ? (
            <img
              src={recipe.author.avatarUrl}
              alt=""
              className="size-11 shrink-0 rounded-full border-[1.5px] border-rule-strong object-cover"
            />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-rule-strong font-display text-lg text-ink">
              {recipe.author.name.slice(0, 1).toUpperCase()}
            </span>
          )}

          <div className="min-w-0">
            <Label as="p">Recette partagée par</Label>
            <p className="mt-1 truncate font-display text-[19px] leading-tight text-ink">
              {recipe.author.name}
            </p>
          </div>
        </div>

        <Button variant="lime" icon={<IconGlobe />} loading={busy} onClick={copy}>
          {user ? 'Enregistrer dans mes recettes' : 'Me connecter pour l’enregistrer'}
        </Button>
      </div>

      <p className="mt-3.5 border-t-[1.5px] border-rule pt-3 text-[13px] leading-[1.55] text-ink-faint">
        En l'enregistrant, tu en obtiens ta propre copie : modifiable, notable, et elle reste dans
        ton fichier même si {recipe.author.name} la repasse en privé.
      </p>

      {error && <ErrorPanel className="mt-4" message={error} />}
    </section>
  );
}

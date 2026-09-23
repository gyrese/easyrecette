import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconCheck } from '../components/Icons';
import { RecipeEditor } from '../components/RecipeEditor';
import { Button, ErrorPanel, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import type { GeneratedRecipe } from '../lib/types';

/**
 * Édition d'une recette, et création depuis zéro.
 *
 * La même page sert aux deux cas : sans `:id`, on part d'un brouillon vide
 * (route /recipe/new). Cela évite de dupliquer tout le formulaire pour une
 * différence qui tient au verbe HTTP utilisé à l'enregistrement.
 */

function emptyRecipe(): GeneratedRecipe {
  return {
    title: '',
    description: '',
    servings: 4,
    prepTime: null,
    cookingTime: null,
    totalTime: null,
    difficulty: null,
    category: null,
    cuisine: null,
    ingredients: [
      { quantity: null, unit: null, ingredient: '', preparation: null, note: null, section: null },
    ],
    steps: [{ order: 1, title: null, instruction: '', duration: null, temperature: null }],
    equipment: [],
    tips: [],
    tags: [],
    imageUrl: null,
    source: { platform: 'manual', url: null, author: null, originalTitle: null },
    confidence: 1,
    warnings: [],
  };
}

export function RecipeEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;

  const [recipe, setRecipe] = useState<GeneratedRecipe | null>(isNew ? emptyRecipe() : null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    api
      .getRecipe(id)
      .then((result) => !cancelled && setRecipe(result))
      .catch((err) =>
        !cancelled && setError(err instanceof ApiError ? err.message : 'Recette introuvable.'),
      )
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [id]);

  const canSave = Boolean(
    recipe &&
      recipe.title.trim() &&
      recipe.ingredients.some((item) => item.ingredient.trim()) &&
      recipe.steps.some((step) => step.instruction.trim()),
  );

  async function save() {
    if (!recipe || !canSave) return;

    setSaving(true);
    setError(null);

    // Les lignes laissées vides par l'utilisateur ne doivent pas partir en base.
    const cleaned: GeneratedRecipe = {
      ...recipe,
      ingredients: recipe.ingredients.filter((item) => item.ingredient.trim()),
      steps: recipe.steps
        .filter((step) => step.instruction.trim())
        .map((step, index) => ({ ...step, order: index + 1 })),
    };

    try {
      const saved = isNew
        ? await api.createRecipe(cleaned)
        : await api.updateRecipe(id, cleaned);
      navigate(`/recipe/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'enregistrement a échoué.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-8 text-ember" />
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <ErrorPanel
          title="Recette introuvable"
          message={error ?? "Cette recette n'existe pas."}
          action={<Button onClick={() => navigate('/recipes')}>Retour</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(isNew ? '/' : `/recipe/${id}`)}
          aria-label="Retour"
          className="grid size-11 shrink-0 place-items-center rounded-control border-[1.5px] border-rule-strong text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          <IconArrowLeft />
        </button>

        <h1 className="text-section">
          {isNew ? 'Nouvelle recette' : 'Modifier la recette'}
        </h1>
      </header>

      {error && <ErrorPanel className="mb-5" message={error} />}

      <div className="surface p-5 sm:p-6">
        <RecipeEditor recipe={recipe} onChange={setRecipe} />
      </div>

      <div className="safe-bottom sticky bottom-20 z-30 -mx-4 mt-7 border-t-[1.5px] border-rule-strong bg-paper/95 px-4 py-3.5 backdrop-blur-lg sm:bottom-0 sm:mx-0 sm:rounded-card sm:border-[1.5px] sm:shadow-sticky">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            loading={saving}
            disabled={!canSave}
            onClick={save}
            icon={saving ? undefined : <IconCheck />}
            className="flex-1 sm:flex-none"
          >
            {isNew ? 'Créer la recette' : 'Enregistrer les modifications'}
          </Button>

          <Button
            variant="ghost"
            size="lg"
            disabled={saving}
            onClick={() => navigate(isNew ? '/' : `/recipe/${id}`)}
          >
            Annuler
          </Button>
        </div>

        {!canSave && (
          <p className="mt-2 text-xs text-ink-faint">
            Il faut au minimum un titre, un ingrédient et une étape.
          </p>
        )}
      </div>
    </div>
  );
}

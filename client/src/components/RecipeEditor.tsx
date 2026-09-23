import { useMemo } from 'react';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DIFFICULTIES,
  type GeneratedRecipe,
  type RecipeIngredient,
  type RecipeStep,
} from '../lib/types';
import { IconMinus, IconPlus, IconTrash } from './Icons';
import { Button, Field, Input, Select, Textarea } from './ui';

/**
 * Formulaire d'édition d'une recette.
 *
 * Utilisé à deux endroits : la prévisualisation avant enregistrement, et
 * l'édition d'une recette existante. Le composant est contrôlé — il ne garde
 * aucun état interne, le parent détient la recette et reçoit chaque
 * modification.
 *
 * Un point de conception important : un champ vide doit produire `null`, pas
 * `0` ni `""`. Sinon l'utilisateur qui efface une température crée un
 * « 0 °C » qui n'a aucun sens, et on perdrait la distinction entre « inconnu »
 * et « précisé », qui est le principe du produit.
 */

interface Props {
  recipe: GeneratedRecipe;
  onChange: (recipe: GeneratedRecipe) => void;
}

/** Convertit une saisie en nombre ou null. Refuse les valeurs non finies. */
function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toIntOrNull(value: string): number | null {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}

export function RecipeEditor({ recipe, onChange }: Props) {
  /** Applique une modification partielle. */
  const patch = (changes: Partial<GeneratedRecipe>) => onChange({ ...recipe, ...changes });

  // --- Ingrédients ---

  const setIngredient = (index: number, changes: Partial<RecipeIngredient>) => {
    const ingredients = recipe.ingredients.map((item, i) =>
      i === index ? { ...item, ...changes } : item,
    );
    patch({ ingredients });
  };

  const addIngredient = () =>
    patch({
      ingredients: [
        ...recipe.ingredients,
        {
          quantity: null,
          unit: null,
          ingredient: '',
          preparation: null,
          note: null,
          // Nouvelle ligne dans la même section que la précédente : c'est
          // presque toujours ce qu'on veut en ajoutant à la suite.
          section: recipe.ingredients.at(-1)?.section ?? null,
        },
      ],
    });

  const removeIngredient = (index: number) =>
    patch({ ingredients: recipe.ingredients.filter((_, i) => i !== index) });

  // --- Étapes ---

  const setStep = (index: number, changes: Partial<RecipeStep>) => {
    const steps = recipe.steps.map((step, i) => (i === index ? { ...step, ...changes } : step));
    patch({ steps });
  };

  const addStep = () =>
    patch({
      steps: [
        ...recipe.steps,
        {
          order: recipe.steps.length + 1,
          title: null,
          instruction: '',
          duration: null,
          temperature: null,
        },
      ],
    });

  const removeStep = (index: number) =>
    patch({
      steps: recipe.steps
        .filter((_, i) => i !== index)
        .map((step, i) => ({ ...step, order: i + 1 })),
    });

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= recipe.steps.length) return;

    const steps = [...recipe.steps];
    const a = steps[index];
    const b = steps[target];
    if (!a || !b) return;

    steps[index] = b;
    steps[target] = a;
    patch({ steps: steps.map((step, i) => ({ ...step, order: i + 1 })) });
  };

  // --- Listes simples (équipement, conseils, tags) ---

  const tagsValue = useMemo(() => recipe.tags.join(', '), [recipe.tags]);
  const equipmentValue = useMemo(() => recipe.equipment.join(', '), [recipe.equipment]);

  const parseCsv = (value: string): string[] =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <div className="space-y-8">
      {/* ------------------- Informations générales ------------------- */}
      <section className="space-y-4">
        <Field label="Titre">
          <Input
            value={recipe.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Nom du plat"
            className="font-display text-lg"
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={recipe.description}
            onChange={(event) => patch({ description: event.target.value })}
            rows={3}
            placeholder="Quelques phrases sur le plat…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Portions" hint="Vide = non précisé">
            <Input
              type="number"
              min={1}
              max={100}
              value={recipe.servings ?? ''}
              onChange={(event) => patch({ servings: toIntOrNull(event.target.value) })}
              placeholder="—"
            />
          </Field>

          <Field label="Préparation" hint="minutes">
            <Input
              type="number"
              min={0}
              value={recipe.prepTime ?? ''}
              onChange={(event) => patch({ prepTime: toIntOrNull(event.target.value) })}
              placeholder="—"
            />
          </Field>

          <Field label="Cuisson" hint="minutes">
            <Input
              type="number"
              min={0}
              value={recipe.cookingTime ?? ''}
              onChange={(event) => patch({ cookingTime: toIntOrNull(event.target.value) })}
              placeholder="—"
            />
          </Field>

          <Field label="Total" hint="minutes">
            <Input
              type="number"
              min={0}
              value={recipe.totalTime ?? ''}
              onChange={(event) => patch({ totalTime: toIntOrNull(event.target.value) })}
              placeholder="—"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Difficulté">
            <Select
              value={recipe.difficulty ?? ''}
              onChange={(event) =>
                patch({
                  difficulty: (event.target.value || null) as GeneratedRecipe['difficulty'],
                })
              }
            >
              <option value="">Non précisée</option>
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Catégorie">
            <Select
              value={recipe.category ?? ''}
              onChange={(event) =>
                patch({ category: (event.target.value || null) as GeneratedRecipe['category'] })
              }
            >
              <option value="">Non précisée</option>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Cuisine">
            <Input
              value={recipe.cuisine ?? ''}
              onChange={(event) => patch({ cuisine: event.target.value || null })}
              placeholder="japonaise, italienne…"
            />
          </Field>
        </div>
      </section>

      {/* ------------------- Ingrédients ------------------- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[34px] leading-none tracking-[-0.03em]">Ingrédients</h3>
          <Button size="sm" variant="secondary" icon={<IconPlus />} onClick={addIngredient}>
            Ajouter
          </Button>
        </div>

        <div className="space-y-2">
          {recipe.ingredients.map((item, index) => (
            <div
              key={index}
              className="grid grid-cols-[4.5rem_5.5rem_1fr_auto] gap-2 rounded-control border-[1.5px] border-rule-strong bg-paper-raised p-2"
            >
              <Input
                type="number"
                step="any"
                min={0}
                value={item.quantity ?? ''}
                onChange={(event) =>
                  setIngredient(index, {
                    quantity: toNumberOrNull(event.target.value),
                    // Effacer la note quand on renseigne enfin la quantité.
                    note:
                      toNumberOrNull(event.target.value) !== null &&
                      item.note === 'quantité non précisée'
                        ? null
                        : item.note,
                  })
                }
                placeholder="—"
                aria-label={`Quantité de ${item.ingredient || 'l\'ingrédient'}`}
                className="px-2 text-center"
              />

              <Input
                value={item.unit ?? ''}
                onChange={(event) => setIngredient(index, { unit: event.target.value || null })}
                placeholder="unité"
                aria-label="Unité"
                className="px-2"
              />

              <div className="min-w-0 space-y-1.5">
                <Input
                  value={item.ingredient}
                  onChange={(event) => setIngredient(index, { ingredient: event.target.value })}
                  placeholder="Nom de l'ingrédient"
                  aria-label="Ingrédient"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <Input
                    value={item.preparation ?? ''}
                    onChange={(event) =>
                      setIngredient(index, { preparation: event.target.value || null })
                    }
                    placeholder="émincé, râpé…"
                    aria-label="Préparation"
                    className="min-h-9 py-1.5 text-sm"
                  />
                  <Input
                    value={item.section ?? ''}
                    onChange={(event) =>
                      setIngredient(index, { section: event.target.value || null })
                    }
                    placeholder="groupe (Sauce…)"
                    aria-label="Groupe"
                    className="min-h-9 py-1.5 text-sm"
                  />
                </div>
                {item.note && (
                  <p className="px-1 text-xs text-amber-warn">{item.note}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeIngredient(index)}
                aria-label={`Supprimer ${item.ingredient || 'cet ingrédient'}`}
                className="grid size-9 place-items-center self-start rounded-control text-ink-faint transition-colors hover:bg-danger hover:text-paper"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>

        {recipe.ingredients.length === 0 && (
          <p className="label-mono rounded-control border-[1.5px] border-dashed border-rule px-4 py-7 text-center text-ink-faint">
            Aucun ingrédient. Ajoute au moins une ligne pour pouvoir enregistrer.
          </p>
        )}
      </section>

      {/* ------------------- Étapes ------------------- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[34px] leading-none tracking-[-0.03em]">Méthode</h3>
          <Button size="sm" variant="secondary" icon={<IconPlus />} onClick={addStep}>
            Ajouter
          </Button>
        </div>

        <div className="space-y-3">
          {recipe.steps.map((step, index) => (
            <div key={index} className="rounded-control border-[1.5px] border-rule-strong bg-paper-raised p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-control border-[1.5px] border-rule-strong bg-lime font-mono text-xs font-medium text-ink tabular-nums">
                  {index + 1}
                </span>

                <Input
                  value={step.title ?? ''}
                  onChange={(event) => setStep(index, { title: event.target.value || null })}
                  placeholder="Titre de l'étape (facultatif)"
                  aria-label="Titre de l'étape"
                  className="min-h-9 py-1.5 font-medium"
                />

                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    aria-label="Monter cette étape"
                    className="grid size-8 place-items-center rounded-control text-ink-faint transition-colors hover:bg-lime hover:text-ink disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === recipe.steps.length - 1}
                    aria-label="Descendre cette étape"
                    className="grid size-8 place-items-center rounded-control text-ink-faint transition-colors hover:bg-lime hover:text-ink disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    aria-label="Supprimer cette étape"
                    className="grid size-8 place-items-center rounded-control text-ink-faint transition-colors hover:bg-danger hover:text-paper"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>

              <Textarea
                value={step.instruction}
                onChange={(event) => setStep(index, { instruction: event.target.value })}
                rows={2}
                placeholder="Que faut-il faire ?"
                aria-label={`Instruction de l'étape ${index + 1}`}
              />

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Durée (min)">
                  <Input
                    type="number"
                    min={0}
                    value={step.duration ?? ''}
                    onChange={(event) =>
                      setStep(index, { duration: toIntOrNull(event.target.value) })
                    }
                    placeholder="—"
                    className="min-h-9 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Température (°C)">
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={step.temperature ?? ''}
                    onChange={(event) =>
                      setStep(index, { temperature: toIntOrNull(event.target.value) })
                    }
                    placeholder="—"
                    className="min-h-9 py-1.5 text-sm"
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>

        {recipe.steps.length === 0 && (
          <p className="label-mono rounded-control border-[1.5px] border-dashed border-rule px-4 py-7 text-center text-ink-faint">
            Aucune étape. Ajoute au moins une étape pour pouvoir enregistrer.
          </p>
        )}
      </section>

      {/* ------------------- Compléments ------------------- */}
      <section className="space-y-4">
        <Field label="Ustensiles" hint="Séparés par des virgules">
          <Input
            value={equipmentValue}
            onChange={(event) => patch({ equipment: parseCsv(event.target.value) })}
            placeholder="Poêle, fouet, moule à tarte"
          />
        </Field>

        <Field label="Tags" hint="Séparés par des virgules — servent à filtrer la bibliothèque">
          <Input
            value={tagsValue}
            onChange={(event) => patch({ tags: parseCsv(event.target.value) })}
            placeholder="poulet, rapide, asiatique"
          />
        </Field>

        <Field label="Conseils" hint="Un conseil par ligne">
          <Textarea
            value={recipe.tips.join('\n')}
            onChange={(event) =>
              patch({
                tips: event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            rows={3}
            placeholder="Le panko ne se remplace pas vraiment par de la chapelure classique."
          />
        </Field>

        <Field label="Image" hint="URL d'une photo du plat">
          <Input
            type="url"
            value={recipe.imageUrl ?? ''}
            onChange={(event) => patch({ imageUrl: event.target.value || null })}
            placeholder="https://…"
          />
        </Field>
      </section>
    </div>
  );
}

/** Sélecteur de portions réutilisé par la fiche et l'éditeur. */
export function ServingsStepper({
  value,
  onChange,
  min = 1,
  max = 50,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    // Un seul bloc cerné, divisé par deux filets : les trois parties forment
    // un objet unique, pas trois boutons côte à côte.
    <div className="inline-flex items-center overflow-hidden rounded-control border-[1.5px] border-rule-strong">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Moins de portions"
        className="grid h-9.5 w-10 place-items-center border-r-[1.5px] border-rule-strong text-lg text-ink transition-colors hover:bg-lime disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconMinus />
      </button>

      <span className="label-mono-sm min-w-29 text-center tabular-nums">
        {value} {value === 1 ? 'portion' : 'portions'}
      </span>

      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Plus de portions"
        className="grid h-9.5 w-10 place-items-center border-l-[1.5px] border-rule-strong text-lg text-ink transition-colors hover:bg-lime disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconPlus />
      </button>
    </div>
  );
}

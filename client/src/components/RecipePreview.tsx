import { useState } from 'react';
import { attributionLine, formatDuration, formatServings } from '../lib/format';
import { formatIngredientLine } from '../lib/units';
import type { GeneratedRecipe } from '../lib/types';
import { CATEGORY_LABELS } from '../lib/types';
import { IconCheck, IconEdit, IconExternal } from './Icons';
import { ImportNotes } from './ImportProgress';
import { RecipeEditor } from './RecipeEditor';
import { Badge, Button, ErrorPanel, Label, RecipeImage, SideNote, WarningPanel } from './ui';

/**
 * Prévisualisation avant enregistrement (§7).
 *
 * Deux vues sur la même donnée : une fiche lisible (par défaut) et le
 * formulaire d'édition. On commence par la fiche parce que dans la majorité
 * des cas la recette est bonne et l'utilisateur veut juste vérifier puis
 * enregistrer ; l'édition est à un clic pour les cas où il faut corriger.
 *
 * Les `warnings` sont placés AVANT la fiche, pas en note de bas de page :
 * ce sont eux qui indiquent où l'utilisateur doit porter son attention.
 */

interface Props {
  recipe: GeneratedRecipe;
  notes?: string[];
  saving?: boolean;
  error?: string | null;
  onSave: (recipe: GeneratedRecipe) => void;
  onCancel: () => void;
}

export function RecipePreview({
  recipe: initial,
  notes = [],
  saving = false,
  error,
  onSave,
  onCancel,
}: Props) {
  const [recipe, setRecipe] = useState(initial);
  const [editing, setEditing] = useState(false);

  const canSave =
    recipe.title.trim().length > 0 &&
    recipe.ingredients.some((item) => item.ingredient.trim()) &&
    recipe.steps.some((step) => step.instruction.trim());

  /** Ingrédients regroupés par section, l'ordre d'apparition faisant foi. */
  const sections = groupBySection(recipe);

  const attribution = attributionLine(recipe.source);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-rule-strong pb-4.5">
        <div>
          <Label className="text-olive">
            <IconCheck className="mr-1 inline text-sm" />
            Épreuve · fiche extraite
          </Label>
          <h1 className="mt-2.5 text-section">Vérifier avant classement</h1>
        </div>

        <Button
          variant={editing ? 'lime' : 'secondary'}
          icon={<IconEdit />}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Voir la fiche' : 'Modifier'}
        </Button>
      </header>

      {/* Ce que l'IA n'a pas trouvé — en évidence, pas en bas de page. */}
      <WarningPanel warnings={recipe.warnings} title="Informations manquantes dans la source" />

      {recipe.confidence < 0.5 && (
        <div className="border-l-[3px] border-amber-warn bg-amber-soft px-4 py-3.5 text-sm leading-relaxed text-ink-soft">
          La source était peu explicite : cette fiche est une reconstitution partielle.
          Relisez-la attentivement avant de l'enregistrer.
        </div>
      )}

      {error && <ErrorPanel message={error} />}

      <div className="surface overflow-hidden">
        {editing ? (
          <div className="p-5 sm:p-6">
            <RecipeEditor recipe={recipe} onChange={setRecipe} />
          </div>
        ) : (
          <article>
            {recipe.imageUrl && (
              <RecipeImage
                src={recipe.imageUrl}
                alt={recipe.title}
                priority
                className="aspect-video w-full border-b-[1.5px] border-rule-strong object-cover"
              />
            )}

            <div className="p-5 sm:p-7">
              <h2 className="text-section">{recipe.title}</h2>

              {recipe.description && (
                <p className="mt-3 text-[15px] leading-[1.6] text-ink-soft">
                  {recipe.description}
                </p>
              )}

              {/* Métadonnées : uniquement celles qui sont connues. */}
              <div className="mt-4.5 flex flex-wrap items-center gap-1.5">
                {recipe.totalTime !== null && (
                  <Badge tone="ember">{formatDuration(recipe.totalTime)}</Badge>
                )}
                {recipe.difficulty && <Badge>{recipe.difficulty}</Badge>}
                {recipe.servings !== null && <Badge>{formatServings(recipe.servings)}</Badge>}
                {recipe.category && <Badge>{CATEGORY_LABELS[recipe.category]}</Badge>}
                {recipe.cuisine && <Badge>{recipe.cuisine}</Badge>}
              </div>

              {/* --------- Ingrédients --------- */}
              <section className="mt-8">
                <h3 className="border-b-[1.5px] border-rule-strong pb-3 text-[34px] leading-none tracking-[-0.03em]">
                  Ingrédients
                </h3>

                <div className="mt-4 space-y-5">
                  {sections.map(({ section, items }) => (
                    <div key={section ?? '__default'}>
                      {section && (
                        <Label as="p" className="mb-1.5 block text-ember">
                          {section}
                        </Label>
                      )}
                      <ul className="space-y-1">
                        {items.map((item, index) => (
                          <li
                            key={index}
                            // Le survol décale la ligne d'un cran : le doigt
                            // sait quelle ligne il vise avant de la lire.
                            className="flex items-baseline gap-2 border-b border-dotted border-rule py-2 pl-1 text-[15px] transition-[background-color,padding-left] duration-200 last:border-0 hover:bg-lime-soft hover:pl-[9px]"
                          >
                            <span className="text-ink">
                              {formatIngredientLine({
                                quantity: item.quantity,
                                unit: item.unit,
                                label: item.ingredient,
                                preparation: item.preparation,
                              })}
                            </span>
                            {item.note && (
                              <span className="text-xs text-amber-warn">({item.note})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              {/* --------- Préparation --------- */}
              <section className="mt-8">
                <h3 className="border-b-[1.5px] border-rule-strong pb-3 text-[34px] leading-none tracking-[-0.03em]">Méthode</h3>

                <ol className="mt-4 space-y-5">
                  {recipe.steps.map((step) => (
                    <li
                      key={step.order}
                      className="flex gap-4 rounded-control p-1.5 transition-colors duration-250 hover:bg-lime-soft"
                    >
                      {/* Le numéro composé en gros chiffre pâle : il balise la
                          colonne sans jamais concurrencer l'instruction. */}
                      <span className="w-11 shrink-0 font-display text-[42px] leading-[0.8] tracking-[-0.04em] text-ink/26 tabular-nums">
                        {String(step.order).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        {step.title && (
                          <p className="mb-1 font-display text-lg text-ink">{step.title}</p>
                        )}
                        <p className="text-[15px] leading-[1.62] text-ink-soft">
                          {step.instruction}
                        </p>
                        {(step.duration !== null || step.temperature !== null) && (
                          <div className="mt-2.5 flex gap-1.5">
                            {step.duration !== null && (
                              <Badge tone="ember">{formatDuration(step.duration)}</Badge>
                            )}
                            {step.temperature !== null && <Badge>{step.temperature} °C</Badge>}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              {recipe.equipment.length > 0 && (
                <section className="mt-8">
                  <Label as="div" className="mb-2.5 block text-ember">
                    Ustensiles
                  </Label>
                  <p className="text-[15px] text-ink-soft">{recipe.equipment.join(' · ')}</p>
                </section>
              )}

              {recipe.tips.length > 0 && (
                <section className="mt-8">
                  <Label as="div" className="mb-2.5 block text-ember">
                    Conseils
                  </Label>
                  <div className="flex flex-col gap-2.5">
                    {recipe.tips.map((tip, index) => (
                      <SideNote key={index}>{tip}</SideNote>
                    ))}
                  </div>
                </section>
              )}

              {recipe.tags.length > 0 && (
                <div className="mt-8 flex flex-wrap gap-1.5">
                  {recipe.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              )}

              {/* --------- Provenance (§13) --------- */}
              {attribution && (
                <footer className="mt-8 border-t-[1.5px] border-rule-strong pt-4">
                  <p className="text-sm leading-relaxed text-ink-soft">{attribution}</p>
                  {recipe.source.url && (
                    <a
                      href={recipe.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="label-mono-sm mt-2.5 inline-flex items-center gap-1.5 text-ember hover:text-ink"
                    >
                      Voir la source originale
                      <IconExternal className="text-xs" />
                    </a>
                  )}
                </footer>
              )}
            </div>
          </article>
        )}
      </div>

      <ImportNotes notes={notes} />

      {/* Barre d'action collante : le bouton d'enregistrement reste
          atteignable même sur une longue recette. */}
      <div className="safe-bottom sticky bottom-20 z-30 -mx-4 border-t-[1.5px] border-rule-strong bg-paper/95 px-4 py-3.5 backdrop-blur-lg sm:bottom-0 sm:mx-0 sm:rounded-card sm:border-[1.5px] sm:shadow-sticky">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="lg"
            loading={saving}
            disabled={!canSave}
            onClick={() => onSave(recipe)}
            icon={saving ? undefined : <IconCheck />}
            className="flex-1 sm:flex-none"
          >
            Classer la fiche
          </Button>
          <Button variant="ghost" size="lg" onClick={onCancel} disabled={saving}>
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

/** Regroupe les ingrédients par section en conservant l'ordre d'apparition. */
export function groupBySection(recipe: {
  ingredients: GeneratedRecipe['ingredients'];
}): Array<{ section: string | null; items: GeneratedRecipe['ingredients'] }> {
  const order: Array<string | null> = [];
  const map = new Map<string | null, GeneratedRecipe['ingredients']>();

  for (const item of recipe.ingredients) {
    const key = item.section?.trim() || null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)?.push(item);
  }

  return order.map((section) => ({ section, items: map.get(section) ?? [] }));
}

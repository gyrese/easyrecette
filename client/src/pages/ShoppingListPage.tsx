import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconCart, IconClose, IconPlus, IconTrash } from '../components/Icons';
import { Button, EmptyState, ErrorPanel, Input, Label, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatQuantity } from '../lib/units';
import type { ShoppingList } from '../lib/types';

/**
 * Liste de courses (§12).
 *
 * Le regroupement des ingrédients est fait côté serveur (c'est lui qui connaît
 * les unités compatibles). Cette page se concentre sur l'usage en magasin :
 * cocher d'un pouce, voir ce qui reste, savoir d'où vient chaque ligne.
 *
 * Les articles cochés glissent en bas plutôt que de disparaître — on peut se
 * tromper, et retrouver une ligne effacée serait pénible.
 */
export function ShoppingListPage() {
  const [list, setList] = useState<ShoppingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getShoppingList()
      .then(setList)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Impossible de charger la liste.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const { pending, done } = useMemo(() => {
    const items = list?.items ?? [];
    return {
      pending: items.filter((item) => !item.checked),
      done: items.filter((item) => item.checked),
    };
  }, [list]);

  /** Exécute une action serveur en remplaçant la liste par sa réponse. */
  async function run(action: () => Promise<ShoppingList>) {
    setError(null);
    try {
      setList(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "L'opération a échoué.");
    }
  }

  async function toggle(itemId: string) {
    // Optimiste : cocher doit être instantané, on est debout dans un rayon.
    setList((previous) =>
      previous
        ? {
            ...previous,
            items: previous.items.map((item) =>
              item.id === itemId ? { ...item, checked: !item.checked } : item,
            ),
          }
        : previous,
    );

    try {
      setList(await api.toggleShoppingItem(itemId));
    } catch {
      // Resynchronisation depuis le serveur en cas d'échec.
      void api.getShoppingList().then(setList).catch(() => undefined);
    }
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    const label = newItem.trim();
    if (!label) return;

    setBusy(true);
    // Une saisie type « 2 citrons » : on isole la quantité en tête si elle existe.
    const match = label.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
    const quantity = match?.[1] ? Number(match[1].replace(',', '.')) : null;
    const name = match?.[2] ?? label;

    await run(() => api.addShoppingItem(name, quantity, null));
    setNewItem('');
    setBusy(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="size-8 text-ember" />
      </div>
    );
  }

  const isEmpty = (list?.items.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-11 sm:px-6">
      <header className="animate-er-in flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-rule-strong pb-4.5">
        <div>
          <Label>
            {isEmpty
              ? 'Épicerie · vide'
              : `Épicerie · ${pending.length} à acheter${
                  done.length > 0 ? ` · ${done.length} au panier` : ''
                }`}
          </Label>
          <h1 className="mt-2.5 text-title">Courses</h1>
        </div>

        {done.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconTrash />}
            onClick={() => void run(() => api.clearShoppingList(true))}
          >
            Vider le panier
          </Button>
        )}
      </header>

      {error && <ErrorPanel className="mt-6" message={error} />}

      {/* Recettes représentées dans la liste */}
      {list && list.recipes.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-1.5">
          {list.recipes.map((recipe) => (
            <span
              key={recipe.id}
              className="label-mono-sm inline-flex items-center gap-1 rounded-control border-[1.5px] border-rule-strong bg-paper-raised py-1 pr-1 pl-2.5"
            >
              <Link to={`/recipe/${recipe.id}`} className="text-ink hover:text-ember">
                {recipe.title}
              </Link>
              <button
                type="button"
                onClick={() => void run(() => api.removeRecipeFromList(recipe.id))}
                aria-label={`Retirer ${recipe.title} de la liste`}
                className="grid size-6 place-items-center text-ink-faint transition-colors hover:bg-danger hover:text-paper"
              >
                <IconClose className="text-xs" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Ajout manuel */}
      <form onSubmit={addItem} className="mt-6 flex gap-2">
        <Input
          value={newItem}
          onChange={(event) => setNewItem(event.target.value)}
          placeholder="Ajouter un article… (ex. 2 citrons)"
          aria-label="Ajouter un article"
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          icon={<IconPlus />}
          disabled={!newItem.trim()}
          loading={busy}
          aria-label="Ajouter"
        />
      </form>

      {isEmpty ? (
        <EmptyState
          icon={<IconCart />}
          title="Aucune course en attente"
          description="Ajoutez les ingrédients d'une fiche : EasyRecette fusionne les doublons et range tout par rayon."
          action={
            <Link to="/recipes">
              <Button variant="secondary">Partir d'une fiche</Button>
            </Link>
          }
        />
      ) : (
        <div className="mt-7 space-y-7">
          {/* --- À acheter --- */}
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {pending.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="group"
                >
                  <div className="flex items-center gap-3 rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-3 py-3 transition-colors hover:bg-lime-soft">
                    <Tick checked={false} onToggle={() => void toggle(item.id)} label={item.label} />

                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-snug">
                        {item.quantity !== null && (
                          <span className="label-mono-sm tabular-nums">
                            {formatQuantity(item.quantity)}
                            {item.unit ? ` ${item.unit}` : ''}{' '}
                          </span>
                        )}
                        {item.label}
                      </p>

                      {(item.note || item.recipeTitle) && (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {item.note && <span className="text-amber-warn">{item.note}</span>}
                          {item.note && item.recipeTitle && ' · '}
                          {item.recipeTitle}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => void run(() => api.removeShoppingItem(item.id))}
                      aria-label={`Supprimer ${item.label}`}
                      className="grid size-9 shrink-0 place-items-center rounded-control text-ink-faint opacity-0 transition-all hover:bg-danger hover:text-paper focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <IconTrash />
                    </button>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {/* --- Dans le panier --- */}
          {done.length > 0 && (
            <section>
              <Label as="h2" className="mb-2.5 block text-ember">
                Dans le panier
              </Label>
              <ul className="space-y-1">
                <AnimatePresence initial={false}>
                  {done.map((item) => (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors hover:bg-paper-sunk">
                        <Tick checked onToggle={() => void toggle(item.id)} label={item.label} />
                        <span className="flex-1 text-[15px] text-ink-faint line-through">
                          {item.quantity !== null && (
                            <span className="tabular-nums">
                              {formatQuantity(item.quantity)}
                              {item.unit ? ` ${item.unit}` : ''}{' '}
                            </span>
                          )}
                          {item.label}
                        </span>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          )}

          <div className="border-t-[1.5px] border-rule-strong pt-5">
            <Button
              variant="ghost"
              size="sm"
              icon={<IconTrash />}
              onClick={() => void run(() => api.clearShoppingList(false))}
            >
              Vider toute la liste
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * La case à cocher de l'édition : un carré au filet, tamponné d'une croix.
 *
 * Le `<input>` natif est remplacé plutôt que stylé parce que `accent-color`
 * ne sait produire ni le filet de 1.5px ni le coup de tampon — et que la
 * case est ici l'objet le plus manipulé de la page, debout dans un rayon.
 * La cible tactile fait 44px, le carré dessiné n'en fait que 17.
 */
function Tick({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`${checked ? 'Décocher' : 'Cocher'} ${label}`}
      onClick={onToggle}
      className="-m-3 grid shrink-0 cursor-pointer place-items-center p-3"
    >
      <span
        className={`grid size-[17px] place-items-center border-[1.5px] font-mono text-[10px] font-medium text-ember transition-colors duration-200 ${
          checked ? 'animate-er-pop border-ember bg-ember/12' : 'border-rule'
        }`}
      >
        {checked ? '✕' : ''}
      </span>
    </button>
  );
}

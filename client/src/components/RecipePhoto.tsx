import { useRef, useState } from 'react';
import { IconCamera, IconTrash } from './Icons';
import { Button, Label } from './ui';
import { ApiError } from '../lib/api';

/**
 * Photo du plat prise par l'utilisateur.
 *
 * Le pendant de la note : la note dit ce que ça valait, la photo montre ce
 * que ça a donné. Une fois déposée, elle remplace l'image de la source
 * partout où la recette est illustrée — mais ne l'efface jamais : retirer sa
 * photo rend la fiche à son visuel d'origine.
 *
 * Le bouton porte `capture="environment"` : sur téléphone, il ouvre
 * directement l'appareil photo arrière plutôt que la galerie. C'est le geste
 * attendu quand on vient de dresser l'assiette.
 */

/** Doit rester aligné sur PHOTO_TYPES côté serveur. */
const ACCEPTED = 'image/jpeg,image/png,image/webp';

interface Props {
  photoUrl: string | null;
  title: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}

export function RecipePhoto({ photoUrl, title, onUpload, onRemove }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Aperçu local pendant l'envoi.
   *
   * Une photo de téléphone pèse quelques mégaoctets : sans cet aperçu, on
   * cliquerait puis attendrait plusieurs secondes devant l'ancienne image,
   * sans savoir si le geste a été pris en compte. L'objet URL est révoqué
   * dans tous les cas, succès comme échec, pour ne pas fuir de mémoire.
   */
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);
    setBusy(true);
    setError(null);

    try {
      await onUpload(file);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "La photo n'a pas pu être envoyée.",
      );
    } finally {
      URL.revokeObjectURL(localUrl);
      setPreview(null);
      setBusy(false);
      // Sans ce reset, reprendre deux fois la même photo ne déclencherait pas
      // de second `change` : la valeur de l'input n'aurait pas changé.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "La photo n'a pas pu être retirée.",
      );
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? photoUrl;

  return (
    <section className="surface mt-6.5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-rule-strong pb-3.5">
        <div>
          <Label className="text-ember">Ta photo</Label>
          <h2 className="mt-2 text-[34px]">{shown ? 'Ton assiette' : 'Montre le résultat'}</h2>
        </div>

        {shown && (
          <Button
            variant="ghost"
            size="sm"
            icon={<IconTrash />}
            disabled={busy}
            onClick={handleRemove}
          >
            Retirer
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        capture="environment"
        className="sr-only"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {shown ? (
        <figure className="mt-5">
          <div className="relative overflow-hidden rounded-card border-[1.5px] border-rule-strong bg-paper-sunk">
            <img
              src={shown}
              alt={`Votre photo de ${title}`}
              className={`block max-h-[520px] w-full object-cover transition-opacity duration-300 ${
                busy ? 'opacity-50' : 'opacity-100'
              }`}
            />
          </div>

          <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="label-mono-sm text-ink-faint">
              Cette photo illustre la fiche dans le fichier
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<IconCamera />}
              loading={busy}
              onClick={() => inputRef.current?.click()}
            >
              Remplacer
            </Button>
          </figcaption>
        </figure>
      ) : (
        <div className="mt-5 flex flex-col items-center gap-4 rounded-card border-[1.5px] border-dashed border-rule-strong px-6 py-11 text-center">
          <div className="grid size-16 place-items-center rounded-full border-[1.5px] border-rule-strong text-2xl text-ink-faint">
            <IconCamera />
          </div>

          <p className="max-w-sm text-[15px] leading-[1.6] text-ink-soft">
            Prends ton plat en photo : c'est elle qu'on verra sur la fiche, à la
            place de l'image de la source.
          </p>

          <Button
            variant="lime"
            icon={<IconCamera />}
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            Ajouter ma photo
          </Button>

          <span className="label-mono-sm text-ink-faint">JPEG, PNG ou WebP — 8 Mo max</span>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </section>
  );
}

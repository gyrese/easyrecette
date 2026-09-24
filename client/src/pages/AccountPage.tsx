import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconGlobe, IconLogout, IconTrash } from '../components/Icons';
import { Button, ErrorPanel, FadeIn, Input, Label, SectionHead } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Page compte.
 *
 * Quatre blocs, du plus courant au plus définitif : l'identité, le nom
 * d'auteur, les sessions, la suppression. L'ordre compte — ce qu'on vient
 * faire le plus souvent est en haut, et ce qui ne se défait pas est en bas,
 * derrière une confirmation tapée.
 *
 * La suppression demande d'écrire « SUPPRIMER » plutôt qu'un simple second
 * clic : elle emporte toutes les recettes, les listes et l'historique
 * d'import, et un double-clic malheureux ne doit pas pouvoir y suffire.
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { user, authorName, setDisplayName, logout } = useAuth();

  const [name, setName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionsClosed, setSessionsClosed] = useState<number | null>(null);

  const [confirmText, setConfirmText] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // La garde de route ne rend cette page qu'à un utilisateur connecté ; ce
  // garde-fou couvre l'instant entre une déconnexion et la redirection.
  if (!user) return null;

  async function saveName() {
    setSavingName(true);
    setError(null);
    setNameSaved(false);
    try {
      await setDisplayName(name.trim() || null);
      setNameSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Le nom n'a pas pu être enregistré.");
    } finally {
      setSavingName(false);
    }
  }

  async function closeAllSessions() {
    setBusy(true);
    setError(null);
    try {
      const { sessions } = await api.logoutEverywhere();
      setSessionsClosed(sessions);
      // La session courante part avec les autres : on rafraîchit l'état
      // plutôt que de laisser l'en-tête afficher un compte déjà fermé.
      await logout();
      navigate('/discover');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La déconnexion a échoué.');
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount();
      await logout();
      navigate('/discover', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La suppression a échoué.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-11 sm:px-6">
      <FadeIn>
        <SectionHead label="Compte" title="Mon compte" />
      </FadeIn>

      {error && <ErrorPanel className="mt-6" message={error} />}

      {/* ---------------- Identité ---------------- */}
      <section className="surface mt-7 p-6">
        <div className="flex items-center gap-4">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="size-14 shrink-0 rounded-full border-[1.5px] border-rule-strong object-cover"
            />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-full border-[1.5px] border-rule-strong font-display text-2xl text-ink">
              {authorName.slice(0, 1).toUpperCase()}
            </span>
          )}

          <div className="min-w-0">
            <p className="truncate font-display text-[22px] leading-tight text-ink">
              {user.name ?? authorName}
            </p>
            <p className="mt-1 truncate font-mono text-[12px] text-ink-faint">{user.email}</p>
          </div>
        </div>

        <p className="mt-5 border-t-[1.5px] border-rule pt-4 text-[13px] leading-[1.6] text-ink-faint">
          Ton nom, ta photo et ton adresse viennent de Google et se mettent à jour à chaque
          connexion. Pour les changer, modifie-les dans ton compte Google.
        </p>
      </section>

      {/* ---------------- Nom d'auteur ---------------- */}
      <section className="surface mt-6 p-6">
        <Label as="h2" className="flex items-center gap-2 text-ink">
          <IconGlobe className="text-sm" />
          Nom d'auteur
        </Label>
        <p className="mt-2.5 text-[14px] leading-[1.58] text-ink-soft">
          Le nom qui signe les recettes que tu rends publiques. Il peut différer de ton nom
          Google — un pseudo fait très bien l'affaire.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-2.5">
          <label className="min-w-0 flex-1">
            <Label as="span" className="mb-2 block text-ember">
              Signature
            </Label>
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameSaved(false);
              }}
              placeholder={user.name ?? 'Ton nom ou un pseudo'}
              maxLength={60}
            />
          </label>

          <Button variant="lime" loading={savingName} onClick={saveName}>
            {nameSaved ? 'Enregistré' : 'Enregistrer'}
          </Button>
        </div>

        <p className="mt-2.5 text-[13px] text-ink-faint">
          Laissé vide, tes recettes publiques sont signées «&nbsp;
          {user.name?.trim() || 'Anonyme'}&nbsp;». Ton adresse e-mail n'est jamais affichée.
        </p>
      </section>

      {/* ---------------- Sessions ---------------- */}
      <section className="surface mt-6 p-6">
        <Label as="h2" className="flex items-center gap-2 text-ink">
          <IconLogout className="text-sm" />
          Appareils connectés
        </Label>
        <p className="mt-2.5 text-[14px] leading-[1.58] text-ink-soft">
          Ferme toutes les sessions, ici et ailleurs. Utile si tu as perdu un téléphone ou utilisé
          un ordinateur partagé. Tu devras te reconnecter.
        </p>

        {sessionsClosed !== null && (
          <p className="mt-3 label-mono-sm text-ember">
            {sessionsClosed} session{sessionsClosed > 1 ? 's' : ''} fermée
            {sessionsClosed > 1 ? 's' : ''}
          </p>
        )}

        <Button className="mt-4" variant="secondary" loading={busy} onClick={closeAllSessions}>
          Me déconnecter partout
        </Button>
      </section>

      {/* ---------------- Suppression ---------------- */}
      <section className="mt-6 rounded-card border-[1.5px] border-danger bg-danger-soft p-6">
        <Label as="h2" className="flex items-center gap-2 text-danger">
          <IconTrash className="text-sm" />
          Supprimer mon compte
        </Label>
        <p className="mt-2.5 text-[14px] leading-[1.58] text-ink-soft">
          Efface définitivement ton compte, tes recettes, tes listes de courses et ton historique
          d'import. Les copies que d'autres ont enregistrées de tes recettes partagées restent
          chez eux : ce sont désormais leurs fiches.
        </p>

        {!confirmingDelete ? (
          <Button
            className="mt-4"
            variant="danger"
            onClick={() => setConfirmingDelete(true)}
          >
            Supprimer mon compte
          </Button>
        ) : (
          <div className="mt-4">
            <label className="block">
              <Label as="span" className="mb-2 block text-danger">
                Écris SUPPRIMER pour confirmer
              </Label>
              <Input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder="SUPPRIMER"
                autoComplete="off"
                className="max-w-xs"
              />
            </label>

            <div className="mt-3.5 flex flex-wrap gap-2">
              <Button
                variant="danger"
                loading={busy}
                disabled={confirmText.trim().toUpperCase() !== 'SUPPRIMER'}
                onClick={deleteAccount}
              >
                Supprimer définitivement
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmingDelete(false);
                  setConfirmText('');
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

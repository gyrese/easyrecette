import { motion, useReducedMotion } from 'framer-motion';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { IconWarning } from './Icons';

/**
 * Briques d'interface communes.
 *
 * Elles portent l'identité visuelle : ce sont elles qui garantissent qu'une
 * nouvelle page ressemblera au reste de l'édition sans avoir à recopier des
 * classes. Toutes reposent sur le même vocabulaire : filet noir de 1.5px,
 * angle coupé à 2-3px, ombre dure décalée, étiquette mono capitalisée.
 */

// ---------------------------------------------------------------------------
// Étiquette mono — la légende de toute l'interface
// ---------------------------------------------------------------------------

/**
 * Le petit texte capitalisé et espacé qui surmonte les titres et annote les
 * cartes. Il remplace partout le « petit gris » des interfaces classiques :
 * ici l'information secondaire n'est pas effacée, elle est composée
 * différemment.
 */
export function Label({
  children,
  className = '',
  as: Tag = 'span',
}: {
  children: ReactNode;
  className?: string;
  /* `h2`/`h3` servent quand l'étiquette EST le titre de la section — elle
     garde alors son rôle sémantique sans prendre la serif d'affiche. */
  as?: 'span' | 'p' | 'div' | 'h2' | 'h3';
}) {
  return <Tag className={`label-mono text-ink-faint ${className}`}>{children}</Tag>;
}

/** Filet noir plein — sépare deux blocs de la page, comme une règle de maquette. */
export function Rule({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t-[1.5px] border-rule-strong ${className}`} />;
}

// ---------------------------------------------------------------------------
// Bouton
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'lime' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

/**
 * `primary` et `lime` portent l'ombre dure : ce sont les gestes qui engagent
 * (importer, cuisiner, envoyer aux courses). `secondary` reste plat pour ne
 * pas encombrer une barre d'outils. La distinction est volontairement forte —
 * dans cette maquette, le relief est une information, pas une décoration.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-rule-strong bg-ember text-ember-ink press',
  lime: 'border-rule-strong bg-lime text-ink press sheen',
  secondary: 'border-rule-strong bg-transparent text-ink hover:bg-ink hover:text-paper',
  ghost: 'border-transparent bg-transparent text-ink-soft hover:text-ink hover:bg-lime-soft',
  danger: 'border-danger bg-transparent text-danger hover:bg-danger hover:text-paper',
};

/* Les trois gabarits relevés dans la maquette : l'onglet et le filtre
   (10px/.16em), l'action courante (11px/.18em) et l'action principale
   (12px/.2em — « Lancer l'extraction », « Passer en mode cuisine »). Le
   `letter-spacing` croît avec la taille : c'est ce qui fait tenir un mono
   capitalisé à grande échelle sans paraître compressé. */
const SIZES: Record<ButtonSize, string> = {
  // min-h-11 = 44px : la cible tactile recommandée, on cuisine avec les doigts.
  sm: 'min-h-9 px-[15px] gap-1.5 text-[10px] tracking-[0.16em]',
  md: 'min-h-11 px-[18px] gap-2 text-[11px] tracking-[0.18em]',
  lg: 'min-h-13 px-6 gap-2.5 text-[12px] tracking-[0.2em]',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-control border-[1.5px] font-mono font-medium uppercase transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

/**
 * Filtre de la bibliothèque.
 *
 * Un bouton à bascule, pas un bouton d'action : il n'a donc ni ombre dure ni
 * relief. L'état actif s'inverse en encre pleine — c'est le seul signal, ce
 * qui laisse une rangée de filtres lisible d'un coup d'œil même à dix
 * entrées. Le filet de l'état inactif est volontairement à .3 d'encre : plein
 * noir, la rangée entière deviendrait un damier.
 */
export function Pill({
  active = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center rounded-control border-[1.5px] px-3.5 py-[9px] font-mono text-[10px] font-medium tracking-[0.16em] uppercase transition-colors duration-200 ${
        active ? 'border-rule-strong bg-ink text-paper' : 'border-ink/30 bg-transparent text-ink/60 hover:border-rule-strong hover:text-ink'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Chargement"
    />
  );
}

// ---------------------------------------------------------------------------
// Champs de formulaire
// ---------------------------------------------------------------------------

/* Le champ est un rectangle cerné, sans ombre : il se remplit, il ne se
   presse pas. Au focus, le filet passe en terre cuite plutôt que d'ajouter
   un halo. */
const FIELD_BASE =
  'w-full rounded-control border-[1.5px] border-rule-strong bg-paper-raised px-3.5 py-2.5 text-ink placeholder:text-ink-faint transition-colors focus:border-ember focus:outline-none';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_BASE} min-h-11 ${className}`} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_BASE} resize-y leading-relaxed ${className}`} />;
}

export function Select({
  className = '',
  children,
  ...props
}: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={`${FIELD_BASE} min-h-11 cursor-pointer ${className}`}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <Label as="span" className="mb-2 block text-ink-soft">
        {label}
      </Label>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Indicateurs
// ---------------------------------------------------------------------------

/**
 * Pastille cernée de noir. Le vert acide est réservé au « neuf » et au
 * validé ; la terre cuite à ce qui demande une action.
 */
export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ember' | 'lime' | 'olive' | 'amber';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-paper text-ink',
    ember: 'bg-ember text-ember-ink',
    lime: 'bg-lime text-ink',
    olive: 'bg-olive-soft text-olive',
    amber: 'bg-amber-soft text-amber-warn',
  };

  return (
    <span
      className={`label-mono-sm inline-flex items-center gap-1 rounded-control border-[1.5px] border-rule-strong px-2 py-1 ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Bandeau d'avertissement.
 *
 * Sert à afficher les `warnings` de l'IA : ce qu'elle n'a PAS trouvé. C'est
 * un élément central du parti pris du produit — l'honnêteté sur l'incertitude
 * est mise en avant, pas cachée en bas de page. D'où le filet épais à gauche,
 * le même que celui des notes de marge dans une recette.
 */
export function WarningPanel({
  warnings,
  title = 'À vérifier',
  className = '',
}: {
  warnings: string[];
  title?: string;
  className?: string;
}) {
  if (warnings.length === 0) return null;

  return (
    <div
      className={`border-l-[3px] border-amber-warn bg-amber-soft px-4 py-3.5 ${className}`}
      role="note"
    >
      <p className="label-mono-sm flex items-center gap-2 text-amber-warn">
        <IconWarning className="text-sm" />
        {title}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink-soft">
        {warnings.map((warning, index) => (
          <li key={index} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-amber-warn" />
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ErrorPanel({
  title,
  message,
  action,
  className = '',
}: {
  title?: string;
  message: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border-l-[3px] border-danger bg-danger-soft px-4 py-3.5 ${className}`}
      role="alert"
    >
      {title && <p className="label-mono-sm text-danger">{title}</p>}
      <p className={`text-sm leading-relaxed text-ink-soft ${title ? 'mt-1.5' : ''}`}>{message}</p>
      {action && <div className="mt-3.5">{action}</div>}
    </div>
  );
}

/**
 * Note de marge : le commentaire du chef à côté d'une étape. Même filet
 * terre cuite que dans la maquette d'origine.
 */
export function SideNote({
  label = 'Note',
  children,
  className = '',
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 border-l-[3px] border-ember bg-ember-soft px-3.5 py-3 ${className}`}>
      <span className="label-mono-sm shrink-0 pt-0.5 text-ember">{label}</span>
      <span className="text-[13px] leading-[1.58] text-ink-soft">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mise en page
// ---------------------------------------------------------------------------

/**
 * En-tête de section : l'étiquette mono, puis le grand titre serif. C'est le
 * motif répété en haut de chaque page — il donne le rythme de l'édition.
 */
export function SectionHead({
  label,
  title,
  action,
  className = '',
}: {
  label: ReactNode;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-rule-strong pb-4 ${className}`}
    >
      <div>
        <Label>{label}</Label>
        <h2 className="mt-2 text-section">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {/* Le tampon rond : un cachet posé sur une page vide. */}
      <div className="animate-er-stamp grid size-21 place-items-center rounded-full border-[1.5px] border-rule-strong font-display text-[34px] text-ink">
        {icon ?? '∅'}
      </div>
      <h2 className="mt-6 text-section">{title}</h2>
      <p className="mt-4 max-w-sm text-[15px] leading-[1.6] text-ink-soft">{description}</p>
      {action && <div className="mt-7">{action}</div>}
    </div>
  );
}

/** Apparition discrète — désactivée si l'utilisateur préfère moins d'animation. */
export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Image de plat : ratio fixe, chargement paresseux, repli si URL cassée. */
export function RecipeImage({
  src,
  alt,
  className = '',
  priority = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-paper-sunk ${className}`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 48 48"
          className="size-10 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="24" cy="26" r="13" />
          <path d="M11 26h26" />
          <path d="M18 13c0-2 1-3 3-3M24 13c0-2 1-3 3-3M30 13c0-2 1-3 3-3" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
      onError={(event) => {
        // Une image morte ne doit pas laisser un cadre vide bizarre.
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}

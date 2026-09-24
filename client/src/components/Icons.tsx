import type { SVGProps } from 'react';

/**
 * Jeu d'icônes.
 *
 * Trait fin et uniforme (1.6), bouts arrondis : cohérent avec le trait d'un
 * carnet. Le cahier des charges proscrit les emojis comme icônes principales
 * (§16), d'où ce jeu maison plutôt qu'une police d'émojis.
 *
 * Toutes héritent de `currentColor` et de la taille du texte : une icône
 * posée dans un bouton prend automatiquement sa couleur et son échelle.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconClock = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const IconUsers = (props: IconProps) => (
  <Base {...props}>
    <path d="M16 19v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V19" />
    <circle cx="9" cy="7" r="3.2" />
    <path d="M22 19v-1.5a4 4 0 0 0-3-3.87" />
    <path d="M16 4.13a4 4 0 0 1 0 5.74" />
  </Base>
);

export const IconFlame = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3c.5 3 2 4 3.5 5.5A7 7 0 0 1 12 21a7 7 0 0 1-3.5-12.5C10 7 11 5.5 12 3Z" />
    <path d="M12 21a3 3 0 0 0 3-3c0-1.5-1.5-2.5-3-4.5-1.5 2-3 3-3 4.5a3 3 0 0 0 3 3Z" />
  </Base>
);

export const IconSearch = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const IconHeart = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Base {...props} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-9.2A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7 2.8C19 15.6 12 20 12 20Z" />
  </Base>
);

export const IconPlus = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconMinus = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14" />
  </Base>
);

export const IconCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
);

export const IconArrowLeft = (props: IconProps) => (
  <Base {...props}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Base>
);

export const IconArrowRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Base>
);

export const IconExternal = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Base>
);

export const IconBook = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5Z" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19v4H6.5A2.5 2.5 0 0 1 4 19.5Z" />
  </Base>
);

export const IconCart = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h7.9a1.5 1.5 0 0 0 1.5-1.2L20 7H6" />
    <circle cx="9.5" cy="19.5" r="1.4" />
    <circle cx="17" cy="19.5" r="1.4" />
  </Base>
);

export const IconSparkle = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
    <path d="M18.5 3.5 19 5l1.5.5L19 6l-.5 1.5L18 6l-1.5-.5L18 5Z" />
  </Base>
);

export const IconLink = (props: IconProps) => (
  <Base {...props}>
    <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
    <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
  </Base>
);

export const IconChef = (props: IconProps) => (
  <Base {...props}>
    <path d="M6 18h12v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1Z" />
    <path d="M6 18V13a4 4 0 0 1-.8-7.8A3.6 3.6 0 0 1 12 4a3.6 3.6 0 0 1 6.8 1.2A4 4 0 0 1 18 13v5" />
  </Base>
);

export const IconPlay = (props: IconProps) => (
  <Base {...props}>
    <path d="M8 5.5v13l11-6.5Z" />
  </Base>
);

export const IconPause = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 5v14M15 5v14" />
  </Base>
);

export const IconReset = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 10a8 8 0 1 1 .8 5" />
    <path d="M4 5v5h5" />
  </Base>
);

export const IconClose = (props: IconProps) => (
  <Base {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Base>
);

export const IconWarning = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4.5 21 19.5H3Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </Base>
);

/**
 * L'étoile de notation.
 *
 * `filled` la remplit à l'encre courante ; le contour reste tracé dans les
 * deux états, pour que les étoiles vides et pleines aient exactement la même
 * silhouette et que la rangée ne « bouge » pas quand on survole.
 */
export const IconStar = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <Base {...props} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.4 9.9l6-.9z" />
  </Base>
);

/** Appareil photo — le geste « je montre ce que j'ai vraiment cuisiné ». */
export const IconCamera = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 8.5h3.2l1.5-2.2h8.6l1.5 2.2H21v10.5H3z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </Base>
);

export const IconTrash = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
  </Base>
);

export const IconEdit = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17Z" />
    <path d="m15 6 3 3" />
  </Base>
);

export const IconMaximize = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4" />
    <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
    <path d="M4 15v4a1 1 0 0 0 1 1h4" />
    <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
  </Base>
);

export const IconFilter = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 6h16" />
    <path d="M7 12h10" />
    <path d="M10 18h4" />
  </Base>
);

// --- Logos de plateformes ---
// Glyphes simplifiés : ils servent de repère visuel dans un badge, pas de
// reproduction de marque.

export const IconTikTok = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 4v9.5a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M14 4a4.5 4.5 0 0 0 4.5 4.5" />
  </Base>
);

export const IconInstagram = (props: IconProps) => (
  <Base {...props}>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M16.8 7.2h.01" />
  </Base>
);

export const IconYouTube = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="6" width="18" height="12" rx="3.5" />
    <path d="M11 10.2v3.6l3-1.8Z" />
  </Base>
);

export const IconFacebook = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 8.5h2.5" />
    <path d="M14 21v-8.5h2.2" />
    <path d="M14 12.5h-2.5" />
    <path d="M14 21v-12a2.5 2.5 0 0 1 2.5-2.5H18" />
  </Base>
);

export const IconGlobe = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17Z" />
  </Base>
);

/**
 * Cadenas : marque une fiche gardée pour soi. C'est l'état par défaut, donc
 * l'icône reste discrète — c'est le globe qui signale l'exception.
 */
export const IconLock = (props: IconProps) => (
  <Base {...props}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Base>
);

export const IconUser = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.8 20.5a7.4 7.4 0 0 1 14.4 0" />
  </Base>
);

/** Sortie : la flèche quitte le cadre. */
export const IconLogout = (props: IconProps) => (
  <Base {...props}>
    <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
    <path d="M10 12h9.5" />
    <path d="M13 8.5 9.5 12l3.5 3.5" />
  </Base>
);

/** Duplication : une fiche qui passe dans un autre fichier. */
export const IconCopy = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 5.5H6a2 2 0 0 0-2 2v9" />
  </Base>
);

/**
 * Logo Google.
 *
 * Seule icône du jeu à ne pas suivre le trait maison : c'est une marque, et
 * les règles de Google demandent son « G » quadrichrome tel quel. On garde
 * donc les couleurs officielles et un tracé plein, sans `Base`.
 */
export const IconGoogle = (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      fill="#4285F4"
      d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.4a4.62 4.62 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.96-4.33 2.96-7.38Z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.7 0 4.96-.9 6.64-2.4l-3.24-2.51c-.9.6-2.05.96-3.4.96a5.98 5.98 0 0 1-5.62-4.13H3.03v2.6A10 10 0 0 0 12 22Z"
    />
    <path
      fill="#FBBC05"
      d="M6.38 13.92a6 6 0 0 1 0-3.84v-2.6H3.03a10 10 0 0 0 0 9.04l3.35-2.6Z"
    />
    <path
      fill="#EA4335"
      d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.97 5.48l3.35 2.6A5.98 5.98 0 0 1 12 5.98Z"
    />
  </svg>
);

# EasyRecette — spécification exacte de l'artifact

Source : `artifact-markup.html` (le DOM rendu) et `artifact-logic.js` (les styles calculés).
Toute valeur ci-dessous est **relevée** dans ces deux fichiers, pas inventée.
En cas de doute, la source fait foi — ouvrez-la et relisez la ligne concernée.

## Couleurs (valeurs littérales, jamais d'approximation)

| Rôle | Valeur |
|---|---|
| Papier | `#F2EDE3` |
| Papier fiche | `#F7F3EA` |
| Papier creux (fond image) | `#E4DCCD` |
| Encre | `#17140F` |
| Encre secondaire (panneaux sombres) | `#221D17` |
| Terre cuite | `#D6461F` |
| Encre sur terre cuite | `#F7F2E8` |
| Vert acide | `#D8F250` |

Opacités d'encre récurrentes : `.62` (texte courant), `.55`, `.5`, `.45` (étiquettes),
`.36`, `.32`, `.3`, `.26` (filets pointillés), `.24`, `.22`, `.16`, `.14`.
Sur fond sombre, même échelle mais en `rgba(242,237,227,…)`.

## Typographie

- **Instrument Serif** (`font-weight:400` toujours) — titres, chiffres d'étape, minuteur.
- **Bricolage Grotesque** `font-weight:300` — texte courant uniquement.
- **DM Mono** `400` ou `500` — étiquettes, boutons, badges. Toujours
  `text-transform:uppercase` avec `letter-spacing` entre `.1em` et `.24em`.

Tailles relevées :
- Hero : `clamp(46px,7.6vw,104px)`, `line-height:.88`, `letter-spacing:-.04em`
- Titre de section : `clamp(32px,4.6vw,52px)`, `line-height:.92`, `letter-spacing:-.035em`
- Titre bibliothèque : `clamp(38px,6.4vw,74px)`, `line-height:.9`, `letter-spacing:-.04em`
- Titre de fiche (carte) : `25px`, `line-height:1.02`, `letter-spacing:-.025em`
- Titre de panneau (Ingrédients/Méthode) : `34px`, `letter-spacing:-.03em`, `line-height:1`
- Corps : `15px`/`line-height:1.62` (méthode), `16px`/`1.6` (accroche), `13px`/`1.55` (encarts)
- Étiquette mono : `9.5px`–`11px`, `letter-spacing:.16em`–`.24em`

## Géométrie

- Filet : **`1.5px solid #17140F`** partout (jamais 1px, jamais 2px).
- Rayon : `2px` sur les contrôles, `3px` sur les fiches et panneaux. Rien d'autre.
- Ombres **dures, sans flou** :
  - fiche : `7px 7px 0 rgba(23,20,15,.14)` → survol `14px 14px 0 rgba(23,20,15,.18)`
  - panneau héros : `10px 10px 0 rgba(23,20,15,.16)` → survol `18px 18px 0 rgba(23,20,15,.2)`
  - console d'import : `9px 9px 0 rgba(23,20,15,.14)`
  - barre collante : `5px 5px 0 rgba(23,20,15,.12)`
  - bouton pressable : `3px 3px 0 #17140F` ; survol `translate(-1.5px,-1.5px)` +
    `5px 5px 0` ; actif `translate(2px,2px)` + `0 0 0`
- Largeur de page : `max-width:1320px`, `padding:0 24px`.

## Animations (toutes présentes dans la source)

```
er-in    from{opacity:0;transform:translateY(26px)} to{opacity:1;transform:none}
er-tick  from{translateX(0)} to{translateX(-50%)}            34s linear infinite
er-scan  0%{translateY(-120%)} 100%{translateY(520%)}        1.7s linear infinite
er-blink 0%,45%{opacity:1} 50%,95%{opacity:.15}              1.4s steps(1) infinite
er-pop   0%{scale(.5) rotate(-12deg)} 62%{scale(1.16) rotate(4deg)} 100%{scale(1) rotate(0)}
er-drift 0%,100%{translate3d(0,0,0) scale(1)} 50%{translate3d(2%,-4%,0) scale(1.06)}
er-stamp 0%,100%{rotate(-8deg) scale(1)} 50%{rotate(-5deg) scale(1.04)}
er-sheen 0%{translateX(-140%)} 60%,100%{translateX(260%)}
```

Courbe standard : `cubic-bezier(.16,1,.3,1)`.
Révélation en cascade : `er-in .7s cubic-bezier(.16,1,.3,1)` avec un décalage de
**70 ms par enfant** (`i * 70`).

## Interactions exactes (artifact-logic.js)

**Fiche inclinée** (`fiche`) — au survol : `rotate(0deg) translateY(-8px)`.
Au départ : retour à `rotate(<data-rot>deg)`. Angles utilisés dans la source :
`-1.4`, `1`, `-0.7`, `1.3`, `-1.6`, `1.1`, `-0.8`.

**Carte héros 3D** (`tilt`) — au mouvement du pointeur :
`perspective(1600px) rotateX(-y*3.6deg) rotateY(x*4.4deg) translateY(-5px)`
où `x = (clientX-left)/width - .5` et `y = (clientY-top)/height - .5`.
Au départ : `transform` vidé.

**Halo de la console** (`glow`) — écrit `--mx` / `--my` en pourcentage du survol.
Fond : `radial-gradient(420px circle at var(--mx,70%) var(--my,10%),rgba(216,242,80,.14),transparent 62%)`.

**Zoom d'image** — le conteneur interne porte
`transform:scale(calc(1 + var(--er-reveal,0) * .06))` et
`transition:transform .8s cubic-bezier(.16,1,.3,1)` ; le survol de la fiche pose
`--er-reveal:1`. Sur la carte héros le facteur est `.045`.

**Ligne d'ingrédient** — survol : `background:rgba(216,242,80,.24)` et
`padding-left:9px` (depuis `4px`), `transition:background .18s,padding-left .2s`.
Case cochée : carré `17×17px`, filet `1.5px` qui passe de `rgba(23,20,15,.32)` à
`#D6461F`, fond `rgba(214,70,31,.12)`, glyphe `✕` en DM Mono 10px `#D6461F`,
et l'animation `er-pop .34s cubic-bezier(.16,1,.3,1)` au moment du cochage.
Libellé coché : `rgba(23,20,15,.36)` + `line-through`.

**Étape de méthode** — survol : `background:rgba(216,242,80,.16)`, `transition:.25s`.
Numéro : Instrument Serif `42px`, `line-height:.8`, `letter-spacing:-.04em`,
`color:rgba(23,20,15,.26)`, largeur de colonne `44px`, format `01`…`07` (padStart 2).

**Barres de progression** :
- ingrédients : `height:3px`, fond `rgba(23,20,15,.1)`, remplissage `#D6461F`,
  `transition:width .45s cubic-bezier(.16,1,.3,1)`
- import : `height:2px`, fond `rgba(242,237,227,.14)`, remplissage `#D8F250`,
  `transition:width .7s cubic-bezier(.16,1,.3,1)`

**Pastilles d'état de l'import** (`hudDot`) — `7×7px`, carrées :
faite `#D8F250` / en cours `#D6461F` + `er-blink 1s steps(1) infinite` /
à venir `rgba(242,237,227,.22)`.
Texte (`hudPill`) : DM Mono `11px`, `letter-spacing:.1em`, couleur
faite `#D8F250` / en cours `#F2EDE3` / à venir `rgba(242,237,227,.35)`, `transition:.4s`.

**Scanline** — `height:22%`,
`linear-gradient(to bottom,transparent,rgba(216,242,80,.16),transparent)`,
`animation:er-scan 1.7s linear infinite`, visible seulement pendant l'analyse.

## Boutons (états relevés)

- **Onglet de nav** (`navPill`) : `padding:10px 15px`, filet droit `1.5px #17140F`,
  actif `background:#17140F;color:#F2EDE3`, inactif `transparent` +
  `color:rgba(23,20,15,.62)`, DM Mono `500 10px`, `letter-spacing:.16em`.
- **Filtre** (`pill`) : `padding:9px 14px`, `border-radius:2px`, actif identique
  à ci-dessus, inactif filet `rgba(23,20,15,.3)` + `color:rgba(23,20,15,.6)`.
- **Mode cuisine / action principale** : fond `#D6461F`, texte `#F7F2E8`,
  filet `1.5px #17140F`, ombre pressable `3px 3px 0 #17140F`.
- **Nouvelle fiche** : fond `#D8F250`, texte `#17140F`, même ombre pressable,
  plus le reflet `er-sheen 4.2s ease-in-out infinite` en `::before`.

## Fond de page (trois couches fixes)

1. Lignes d'horizon : `linear-gradient(rgba(23,20,15,.045) 1px,transparent 1px)`,
   `background-size:100% 34px`.
2. Deux halos `er-drift` : en haut à droite `52vw` terre cuite `.17` (22s),
   en bas à gauche `46vw` vert acide `.26` (28s, `reverse`).
3. Grain : SVG `feTurbulence baseFrequency='.9' numOctaves='3'`,
   `opacity:.055`, `mix-blend-mode:multiply`, `z-index:70`.

## Fiche de recette — anatomie exacte

```
article  rotate(<angle>deg), fond #F7F3EA, filet 1.5px, rayon 3px,
         ombre 7px 7px 0, clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%)
 ├ œillet  9×9px, rond, filet 1.5px, fond #F2EDE3, à top:11px left:13px, z-index:3
 ├ badge   « NOUVEAU » : top:7px right:30px, padding:3px 7px, fond #D8F250,
 │         DM Mono 500 8.5px, letter-spacing:.18em
 ├ image   margin:26px 13px 0, filet 1.5px, aspect-ratio:4/3, fond #E4DCCD
 │  └ durée  top:8px right:8px, padding:5px 9px, filet 1.5px,
 │           DM Mono 500 9px, letter-spacing:.16em
 ├ corps   padding:16px 15px 0
 │  ├ ligne  catégorie (DM Mono 9.5px, .2em, rgba(23,20,15,.45))
 │  │        + numéro (Instrument Serif 26px, rgba(23,20,15,.24))
 │  ├ titre  Instrument Serif 25px, line-height:1.02, letter-spacing:-.025em
 │  └ pied   border-top:1px dashed rgba(23,20,15,.26), padding-top:11px,
 │           DM Mono 10px, .12em — plateforme à gauche, auteur à droite
 └ talon   height:22px, margin-top:6px,
           radial-gradient(circle at 9px 0,#F2EDE3 6.5px,transparent 7px),
           background-size:18px 22px, repeat-x, position:0 12px
```

## Règles de conformité

1. **Aucune valeur inventée.** Si une mesure n'est pas dans la source, reprendre
   la valeur de l'élément équivalent le plus proche et le dire en commentaire.
2. **Pas de coins arrondis** au-delà de 3px, **pas d'ombre floue**, **pas de
   dégradé** hors de ceux listés (halos, voiles d'image, reflet, scanline).
3. Le **vert acide n'est jamais une couleur de texte sur crème** (contraste
   insuffisant) — uniquement fond, filet, ou texte sur encre.
4. Les jetons du projet vivent dans `client/src/index.css`. Utiliser les
   utilitaires Tailwind existants (`bg-lime`, `border-rule-strong`, `press`,
   `clip-corner`, `edge-punched`, `label-mono`, `shadow-card`…) plutôt que de
   réécrire des valeurs en dur, **sauf** dans le mode cuisine qui impose l'encre.
5. L'application est **réelle** : les données viennent de l'API, pas du jeu de
   démonstration de l'artifact. Ne jamais coder en dur « Gnocchi de ricotta »,
   « 64 fiches », « @chef_artisan » ni aucun contenu d'exemple. Le design est à
   copier, le contenu vient des props/API.
6. Accessibilité à préserver : `aria-label` existants, cibles tactiles ≥ 44px,
   `prefers-reduced-motion` respecté (toutes les animations doivent s'éteindre).
7. TypeScript strict : `npx tsc -b --noEmit` doit passer, et `npm run build` aussi.

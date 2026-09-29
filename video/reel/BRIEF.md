---
workflow: general-video
flow: automation
storyboard: no
message: "Tu vois une recette en vidéo, tu colles le lien, ta fiche est prête"
destination: website-hero
aspect: 1080x1920
language: fr
length: 15s
---

## Intent

Reel vertical muet (~15 s, en boucle) pour la page de connexion de PassePlat,
pensé pour être compris sur un téléphone sans le son. Il doit ressembler à un
reel de réseau social et raconter l'usage en trois étapes numérotées, avec de
gros sous-titres lisibles :

1. Tu vois une recette en vidéo (reel, partager → copier le lien).
2. Tu colles le lien dans PassePlat (l'IA lit la vidéo).
3. Ta fiche est prête (la fiche cartonnée, enregistrée).

## Customizations

- Barres de progression façon stories en haut, une par étape.
- Sous-titres en encre sur crème, gros (≥ 56 px à 1080 de large).
- Identité du site : crème #f2ede3, encre #17140f, terre cuite #d6461f,
  vert acide #d8f250 ; Instrument Serif, Bricolage Grotesque, DM Mono.

## Notes

- Remplace la boucle 16:9 `video/hero-loop`, jugée peu compréhensible et trop
  petite sur téléphone.

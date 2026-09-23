import { PrismaClient } from '@prisma/client';
import { ingredientSlug } from '../src/utils/units.js';

/**
 * Seed : crée l'utilisateur local et deux recettes de démonstration.
 *
 * Les recettes servent à avoir une bibliothèque non vide au premier lancement,
 * et à vérifier l'affichage (sections d'ingrédients, étapes minutées,
 * quantité manquante, provenance). Elles sont marquées comme saisies
 * manuellement, pas importées.
 */

const prisma = new PrismaClient();

const LOCAL_USER_EMAIL = 'local@cookbook.app';

interface SeedIngredient {
  quantity: number | null;
  unit: string | null;
  label: string;
  preparation?: string;
  note?: string;
  section?: string;
}

interface SeedStep {
  title?: string;
  instruction: string;
  duration?: number;
  temperature?: number;
}

interface SeedRecipe {
  title: string;
  description: string;
  imageUrl: string;
  servings: number;
  prepTime: number;
  cookingTime: number;
  difficulty: string;
  category: string;
  cuisine: string;
  equipment: string[];
  tips: string[];
  tags: string[];
  ingredients: SeedIngredient[];
  steps: SeedStep[];
}

const RECIPES: SeedRecipe[] = [
  {
    title: 'Poulet katsu',
    description:
      "Des filets de poulet panés au panko, dorés et croustillants, servis avec une sauce tonkatsu maison. Le plat de réconfort japonais par excellence.",
    imageUrl:
      'https://images.unsplash.com/photo-1626645738196-c2a7c87a8f58?auto=format&fit=crop&w=1200&q=80',
    servings: 4,
    prepTime: 20,
    cookingTime: 15,
    difficulty: 'facile',
    category: 'plat',
    cuisine: 'japonaise',
    equipment: ['Poêle large', 'Trois assiettes creuses', 'Papier absorbant'],
    tips: [
      "Aplatir les filets à épaisseur égale garantit une cuisson homogène : c'est l'étape qui fait toute la différence.",
      "Le panko ne se remplace pas vraiment par de la chapelure classique — la texture est bien moins aérée.",
    ],
    tags: ['poulet', 'japonais', 'friture', 'rapide'],
    ingredients: [
      { quantity: 4, unit: null, label: 'filets de poulet', section: 'Poulet' },
      { quantity: 100, unit: 'g', label: 'farine', section: 'Poulet' },
      { quantity: 2, unit: null, label: 'œufs', preparation: 'battus', section: 'Poulet' },
      { quantity: 150, unit: 'g', label: 'panko', section: 'Poulet' },
      { quantity: null, unit: null, label: 'huile de friture', note: 'quantité non précisée', section: 'Poulet' },
      { quantity: 3, unit: 'c. à soupe', label: 'ketchup', section: 'Sauce tonkatsu' },
      { quantity: 2, unit: 'c. à soupe', label: 'sauce Worcestershire', section: 'Sauce tonkatsu' },
      { quantity: 1, unit: 'c. à soupe', label: 'sauce soja', section: 'Sauce tonkatsu' },
      { quantity: 1, unit: 'c. à café', label: 'sucre', section: 'Sauce tonkatsu' },
    ],
    steps: [
      {
        title: 'Préparer le poulet',
        instruction:
          "Placer les filets entre deux feuilles de papier cuisson et les aplatir au rouleau jusqu'à environ 1,5 cm d'épaisseur. Saler et poivrer des deux côtés.",
      },
      {
        title: 'Préparer la sauce',
        instruction:
          'Mélanger le ketchup, la sauce Worcestershire, la sauce soja et le sucre dans un bol. Réserver.',
      },
      {
        title: 'Paner',
        instruction:
          'Disposer la farine, les œufs battus et le panko dans trois assiettes creuses. Passer chaque filet successivement dans la farine, puis dans l\'œuf, puis dans le panko en pressant bien pour faire adhérer.',
      },
      {
        title: 'Cuire',
        instruction:
          "Chauffer 1 cm d'huile dans une poêle à feu moyen-vif. Frire les filets 3 à 4 minutes de chaque côté, jusqu'à ce qu'ils soient dorés. Égoutter sur du papier absorbant.",
        duration: 8,
      },
      {
        title: 'Servir',
        instruction:
          'Trancher les filets en lanières d\'environ 2 cm. Servir avec du riz blanc, du chou blanc émincé et la sauce tonkatsu.',
      },
    ],
  },
  {
    title: 'Rougail saucisses',
    description:
      "Le plat créole familial par excellence : des saucisses fumées mijotées dans une sauce tomate relevée au curcuma et au gingembre. Encore meilleur réchauffé le lendemain.",
    imageUrl:
      'https://images.unsplash.com/photo-1604909052743-94e838986d24?auto=format&fit=crop&w=1200&q=80',
    servings: 6,
    prepTime: 15,
    cookingTime: 40,
    difficulty: 'facile',
    category: 'plat',
    cuisine: 'créole',
    equipment: ['Cocotte ou faitout'],
    tips: [
      "Pocher les saucisses avant de les faire revenir retire l'excès de sel et de gras fumé.",
      "Le rougail se bonifie : préparé la veille, il est nettement meilleur.",
    ],
    tags: ['porc', 'créole', 'mijoté', 'épicé'],
    ingredients: [
      { quantity: 6, unit: null, label: 'saucisses fumées' },
      { quantity: 3, unit: null, label: 'oignons', preparation: 'émincés' },
      { quantity: 4, unit: null, label: 'tomates', preparation: 'concassées' },
      { quantity: 3, unit: 'gousse', label: 'ail', preparation: 'écrasé' },
      { quantity: 1, unit: 'c. à café', label: 'curcuma' },
      { quantity: 1, unit: 'c. à café', label: 'gingembre frais', preparation: 'râpé' },
      { quantity: 1, unit: null, label: 'piment', preparation: 'facultatif', note: 'selon le goût' },
      { quantity: 3, unit: 'c. à soupe', label: "huile" },
      { quantity: 2, unit: null, label: 'brins de thym' },
    ],
    steps: [
      {
        title: 'Pocher les saucisses',
        instruction:
          "Plonger les saucisses dans une casserole d'eau froide, porter à ébullition et laisser frémir 10 minutes. Égoutter et couper en tronçons de 3 cm.",
        duration: 10,
      },
      {
        title: 'Faire revenir',
        instruction:
          'Chauffer l\'huile dans la cocotte. Faire dorer les tronçons de saucisse sur toutes les faces, puis les réserver.',
        duration: 5,
      },
      {
        title: 'Monter le rougail',
        instruction:
          "Dans la même cocotte, faire suer les oignons jusqu'à ce qu'ils soient translucides. Ajouter l'ail, le gingembre, le curcuma et le piment. Remuer 1 minute pour réveiller les épices.",
        duration: 6,
      },
      {
        title: 'Mijoter',
        instruction:
          "Ajouter les tomates concassées, le thym et les saucisses. Saler légèrement. Couvrir et laisser mijoter à feu doux en remuant de temps en temps, jusqu'à ce que la sauce épaississe.",
        duration: 25,
      },
      {
        title: 'Servir',
        instruction: 'Servir bien chaud avec du riz blanc et des grains (lentilles ou haricots rouges).',
      },
    ],
  },
];

async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: LOCAL_USER_EMAIL },
    update: {},
    create: { email: LOCAL_USER_EMAIL, name: 'Moi' },
  });

  console.log(`Utilisateur local : ${user.email}`);

  for (const seed of RECIPES) {
    const existing = await prisma.recipe.findFirst({
      where: { userId: user.id, title: seed.title },
    });

    if (existing) {
      console.log(`  « ${seed.title} » existe déjà, ignorée.`);
      continue;
    }

    const recipe = await prisma.recipe.create({
      data: {
        userId: user.id,
        title: seed.title,
        description: seed.description,
        imageUrl: seed.imageUrl,
        servings: seed.servings,
        prepTime: seed.prepTime,
        cookingTime: seed.cookingTime,
        totalTime: seed.prepTime + seed.cookingTime,
        difficulty: seed.difficulty,
        category: seed.category,
        cuisine: seed.cuisine,
        equipment: JSON.stringify(seed.equipment),
        tips: JSON.stringify(seed.tips),
        warnings: '[]',
        confidence: null,
        sourcePlatform: 'manual',
        steps: {
          create: seed.steps.map((step, index) => ({
            order: index + 1,
            title: step.title ?? null,
            instruction: step.instruction,
            duration: step.duration ?? null,
            temperature: step.temperature ?? null,
          })),
        },
      },
    });

    for (const [index, item] of seed.ingredients.entries()) {
      const slug = ingredientSlug(item.label);
      const ingredient = await prisma.ingredient.upsert({
        where: { slug },
        update: {},
        create: { name: item.label, slug },
      });

      await prisma.recipeIngredient.create({
        data: {
          recipeId: recipe.id,
          ingredientId: ingredient.id,
          quantity: item.quantity,
          unit: item.unit,
          label: item.label,
          preparation: item.preparation ?? null,
          note: item.note ?? null,
          section: item.section ?? null,
          position: index,
        },
      });
    }

    for (const tagName of seed.tags) {
      const slug = ingredientSlug(tagName);
      const tag = await prisma.tag.upsert({
        where: { slug },
        update: {},
        create: { name: tagName, slug },
      });
      await prisma.recipeTag.create({ data: { recipeId: recipe.id, tagId: tag.id } });
    }

    console.log(`  « ${seed.title} » créée.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

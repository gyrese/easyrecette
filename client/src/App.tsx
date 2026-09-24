import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/AccountPage';
import { CookModePage } from './pages/CookModePage';
import { DiscoverPage } from './pages/DiscoverPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RecipeEditPage } from './pages/RecipeEditPage';
import { RecipePage } from './pages/RecipePage';
import { ShoppingListPage } from './pages/ShoppingListPage';

/**
 * Routage.
 *
 * Le mode cuisine est hors Layout : c'est un plein écran sans navigation,
 * pensé pour un téléphone posé sur le plan de travail. Il reste accessible
 * sans compte — suivre une recette partagée en cuisinant ne modifie rien.
 *
 * Trois périmètres, du plus ouvert au plus fermé :
 *
 *  - libre : la connexion, la découverte, et la consultation d'une fiche.
 *    Un lien de recette partagée doit s'ouvrir chez qui le reçoit, sans
 *    inscription — c'est tout l'intérêt de pouvoir partager ;
 *  - `RequireAuth` : l'import, son propre fichier, ses courses, son compte.
 *    Tout ce qui écrit dans un fichier personnel ;
 *  - `/recipe/:id` est volontairement dans le premier groupe : le serveur y
 *    sert sa propre fiche ou une fiche publique, et répond 404 sur la
 *    recette privée d'autrui. La page s'adapte via `recipe.isOwner`.
 *
 * Cette garde est un confort de navigation. La barrière réelle est côté
 * serveur (voir server/src/routes/index.ts) : la contourner ne donnerait
 * accès qu'à des pages qui n'ont rien à afficher.
 */
export function App() {
  return (
    <Routes>
      <Route path="/recipe/:id/cook" element={<CookModePage />} />

      <Route element={<Layout />}>
        {/* --- Libre --- */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/discover" element={<DiscoverPage />} />

        {/* --- Compte requis --- */}
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/recipes" element={<LibraryPage />} />
          {/* Avant `/recipe/:id` : React Router 7 classe les routes par
              spécificité, mais l'ordre explicite évite d'avoir à s'en
              souvenir — « new » n'est pas un identifiant de recette. */}
          <Route path="/recipe/new" element={<RecipeEditPage />} />
          <Route path="/recipe/:id/edit" element={<RecipeEditPage />} />
          <Route path="/shopping-list" element={<ShoppingListPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Route>

        {/* Après les routes privées : une fiche est consultable par tous,
            mais `/recipe/new` et `/recipe/:id/edit` ne le sont pas. */}
        <Route path="/recipe/:id" element={<RecipePage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

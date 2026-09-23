import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { RecipePage } from './pages/RecipePage';
import { RecipeEditPage } from './pages/RecipeEditPage';
import { CookModePage } from './pages/CookModePage';
import { ShoppingListPage } from './pages/ShoppingListPage';
import { NotFoundPage } from './pages/NotFoundPage';

/**
 * Routage.
 *
 * Le mode cuisine est hors Layout : c'est un plein écran sans navigation,
 * pensé pour un téléphone posé sur le plan de travail.
 */
export function App() {
  return (
    <Routes>
      <Route path="/recipe/:id/cook" element={<CookModePage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/recipes" element={<LibraryPage />} />
        <Route path="/recipe/:id" element={<RecipePage />} />
        <Route path="/recipe/:id/edit" element={<RecipeEditPage />} />
        <Route path="/recipe/new" element={<RecipeEditPage />} />
        <Route path="/shopping-list" element={<ShoppingListPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

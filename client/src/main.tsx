import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error("Élément #root introuvable dans index.html");

/*
 * L'AuthProvider entoure le routeur : la navigation elle-même dépend de
 * l'état de connexion (voir Layout et RequireAuth), et un seul appel à
 * /auth/me sert toute l'application.
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

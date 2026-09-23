import { useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '../components/ui';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <EmptyState
      title="Page introuvable"
      description="Cette adresse ne correspond à aucune fiche du fichier."
      action={
        <Button variant="secondary" onClick={() => navigate('/')}>
          Retour à l'accueil
        </Button>
      }
    />
  );
}

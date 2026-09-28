import { getPetAvatar } from '../lib/pets';

interface Props {
  avatarPet: string | null | undefined;
  avatarUrl: string | null | undefined;
  name: string;
  className?: string;
}

/** Avatar unique pour le compte et l'attribution des recettes publiques. */
export function PetAvatar({ avatarPet, avatarUrl, name, className = 'size-11' }: Props) {
  const pet = getPetAvatar(avatarPet);
  const image = pet?.src ?? avatarUrl;

  return (
    <span
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full border-[1.5px] border-rule-strong bg-paper-raised ${className}`}
      title={pet?.name}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className={pet ? 'size-full object-contain p-0.5' : 'size-full object-cover'}
        />
      ) : (
        <span className="font-display text-[0.42em] leading-none text-ink">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

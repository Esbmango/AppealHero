import { DEMO_PERSONAS, type PersonaId } from '@appealhero/shared';
import { useLocalStorage } from '../../hooks';
export type Profile = {
  persona: PersonaId | 'custom';
  name: string;
  address: string;
  email: string;
  vehicles: { plate: string; state: string; make: string; color: string }[];
  ready: boolean;
};
export const EMPTY_PROFILE: Profile = { persona: 'custom', name: '', address: '', email: '', vehicles: [], ready: false };
export function personaProfile(id: PersonaId): Profile {
  const persona = DEMO_PERSONAS[id];
  return {
    persona: id,
    name: persona.name,
    address: persona.mailingAddress,
    email: persona.email,
    vehicles: persona.vehicles.map((v) => ({ ...v })),
    ready: false,
  };
}
export function validProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Profile;
  return (
    (profile.persona === 'custom' || Object.hasOwn(DEMO_PERSONAS, profile.persona)) &&
    ['name', 'address', 'email'].every((key) => typeof profile[key as 'name'] === 'string') &&
    typeof profile.ready === 'boolean' &&
    Array.isArray(profile.vehicles) &&
    profile.vehicles.every((v) => v && ['plate', 'state', 'make', 'color'].every((key) => typeof v[key as 'plate'] === 'string'))
  );
}
export function useProfile() {
  const [stored, save] = useLocalStorage<unknown>('appealhero.profile.v1', EMPTY_PROFILE);
  return [validProfile(stored) ? stored : EMPTY_PROFILE, save] as const;
}

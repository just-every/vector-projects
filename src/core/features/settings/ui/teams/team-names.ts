import type { Administration } from '../../../administration/schema';

/** A person's name in the team lists; someone who has left reads as "Former member". */
export const memberName = (data: Administration, id: string) => data.operators.find(person => person.id === id)?.name ?? 'Former member';

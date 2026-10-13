/**
 * Screen name for a stored role. The stored value `field_officer` is an
 * internal key (it stays that way in the database and the API); people
 * only ever see "Officer". Other roles get a readable title.
 */
export function roleName(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'field_officer') return 'Officer';
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

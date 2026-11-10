/** Kleinbuchstaben ohne Akzente/Umlaut-Punkte ("Müller" -> "muller"), damit die Suche auf dem Handy nicht an
 * der Tastatur scheitert. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Mitglieder, deren Name ALLE Suchwörter enthält (beliebige Reihenfolge), ohne die ausgeschlossenen Ids. */
export function filterMembers<T extends { id: string; name: string }>(members: T[], query: string, excludeIds: string[]): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return members.filter((member) => {
    if (excludeIds.includes(member.id)) return false;
    const name = normalize(member.name);
    return words.every((word) => name.includes(word));
  });
}

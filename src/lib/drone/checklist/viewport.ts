const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden']);

/** Öffnet dieses Element auf dem Handy eine Tastatur oder ein Auswahlrad (Text, Zahl, Datum, Uhrzeit)?
 * Dann blendet der Wizard den Fuß aus, damit der Inhalt den verbleibenden Platz bekommt. Auswahllisten
 * (SELECT) öffnen ein eigenes Menü und zählen nicht. */
export function isTextEntry(tagName: string, type?: string): boolean {
  const tag = tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has((type ?? 'text').toLowerCase());
}

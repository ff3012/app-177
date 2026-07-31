import { redirect } from 'next/navigation';

// Verwaltung-Brief.md: "Neuer Benutzer" ist jetzt ein Sheet über /admin/benutzer statt einer
// eigenen Seite (siehe UserFormSheet). Diese Route bleibt als gültiger Deep-Link/Lesezeichen
// bestehen, leitet aber nur noch dorthin um, mit dem Sheet direkt im Anlegen-Modus geöffnet.
export default function NeuerBenutzerPage() {
  redirect('/admin/benutzer?new=1');
}

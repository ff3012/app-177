import { redirect } from 'next/navigation';

// Verwaltung-Brief.md: "Bearbeiten" ist jetzt ein Sheet über /admin/benutzer statt einer eigenen
// Seite (siehe UserFormSheet). Diese Route bleibt als gültiger Deep-Link/Lesezeichen bestehen
// (z. B. aus alten Kopier-Links), leitet aber nur noch dorthin um, mit dem Sheet direkt im
// Bearbeiten-Modus für diesen Benutzer geöffnet.
export default async function BenutzerBearbeitenPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  redirect(`/admin/benutzer?edit=${userId}`);
}

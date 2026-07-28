import { redirect } from 'next/navigation';

// Meine Feuerwehr und Abschnitt-Kalender wurden zu einem Kalender mit umschaltbaren Ebenen zusammengeführt.
export default function AbschnittKalenderRedirectPage() {
  redirect('/kalender');
}

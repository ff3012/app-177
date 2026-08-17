/** Erlaubte MIME-Typen für Wappen-Uploads (Security-Review S3) - SVG bewusst ausgeschlossen: ein
 * SVG kann eingebettetes `<script>` enthalten, das die Auslieferungsroute unverändert mit
 * `Content-Type: image/svg+xml` zurückgab und damit im Session-Kontext jedes angemeldeten
 * Benutzers ausgeführt worden wäre. `image/gif` ist bewusst MIT dabei, obwohl der Security-Review
 * es nicht nennt: ein reines Rasterformat ohne jede Skript-Fähigkeit, also kein Teil des
 * XSS-Bedrohungsmodells - beim Ausrollen zeigte eine echte Prod-Abfrage zwei bestehende, harmlose
 * Wappen mit genau diesem MIME-Typ (FF Purkersdorf, FF Gablitz); ohne diesen Eintrag hätte die
 * neue zweite Verteidigungslinie in der Auslieferungsroute (unten) beide beim nächsten Aufruf
 * ausgeblendet. Geteilt zwischen dem Upload (setOrganizationWappen, wo der Client-Content-Type nur
 * die erste, nicht die einzige Prüfung ist - siehe dort) und der Auslieferungsroute (zweite
 * Verteidigungslinie gegen einen bereits in der DB stehenden, nicht erlaubten Wert). */
export const ALLOWED_WAPPEN_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Erlaubte MIME-Typen für Wappen-Uploads (Security-Review S3) - SVG bewusst ausgeschlossen: ein
 * SVG kann eingebettetes `<script>` enthalten, das die Auslieferungsroute unverändert mit
 * `Content-Type: image/svg+xml` zurückgab und damit im Session-Kontext jedes angemeldeten
 * Benutzers ausgeführt worden wäre. Geteilt zwischen dem Upload (setOrganizationWappen, wo der
 * Client-Content-Type nur die erste, nicht die einzige Prüfung ist - siehe dort) und der
 * Auslieferungsroute (zweite Verteidigungslinie gegen einen bereits in der DB stehenden,
 * nicht erlaubten Wert). */
export const ALLOWED_WAPPEN_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

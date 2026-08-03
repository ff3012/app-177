/** Neutrales Ersatzsymbol für den Wappen-Home-Tab, wenn eine Feuerwehr noch kein eigenes Wappen
 * hinterlegt hat (siehe Startbildschirm-Brief.md §3: "nie ein fremdes Wappen"). Hand-rolled Inline-SVG,
 * matching der bestehenden Konvention (keine Icon-Bibliothek). */
export function WappenFallbackIcon({ size = 30 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="#aeaeb2"
      strokeWidth="1.75"
      aria-hidden="true"
    >
      <path
        d="M12 2.5c2.6 1.4 5 2 7.5 2 0 8.5-3.2 13.6-7.5 17-4.3-3.4-7.5-8.5-7.5-17 2.5 0 4.9-.6 7.5-2Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

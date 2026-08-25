export function Footer() {
  return (
    <footer className="bg-[#474747] py-4 text-center text-sm text-neutral-300">
      BFKDO St. Pölten ·{' '}
      <a
        href="https://bfkdo-stpoelten.at/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-neutral-200 hover:text-white hover:underline"
      >
        bfkdo-stpoelten.at
      </a>{' '}
      ·{' '}
      <a href="/datenschutz" className="text-neutral-200 hover:text-white hover:underline">
        Datenschutz
      </a>
    </footer>
  );
}

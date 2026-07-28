'use client';

import { useState } from 'react';

export function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-Zugriff kann in seltenen Browser-Kontexten fehlschlagen – dann bleibt nur der sichtbare Linktext.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Link kopieren"
      title="Link kopieren"
      className="shrink-0 rounded border border-neutral-300 bg-white p-2 text-neutral-600 hover:bg-neutral-100"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12l5 5 9-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}

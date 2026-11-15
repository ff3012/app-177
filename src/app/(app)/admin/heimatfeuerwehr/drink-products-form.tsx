'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  DEFAULT_DRINK_PRODUCTS,
  DRINK_PRODUCTS_MAX,
  DRINK_PRODUCT_MAX_LENGTH,
} from '@/lib/heimatfeuerwehr/notification-form-constants';
import { setDrinkProducts, type ReportRecipientsState } from './actions';

const initialState: ReportRecipientsState = {};

/**
 * Produktliste des Getränkeautomaten je Feuerwehr (Chips, Hinzufügen/Entfernen, höchstens 12 Produkte). Eine leere Liste
 * speichert die Standardprodukte. Die Liste geht als JSON in einem Hidden-Feld an die Server Action (wie die
 * E-Mail-Chips).
 */
export function DrinkProductsForm({ organizationId, initialProducts }: { organizationId: string; initialProducts: string[] }) {
  const [state, formAction, pending] = useActionState(setDrinkProducts.bind(null, organizationId), initialState);
  const [products, setProducts] = useState<string[]>(initialProducts);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.success) setDirty(false);
  }, [state]);

  const saved = state.success && !dirty;

  function add() {
    const name = draft.replace(/\s+/g, ' ').trim();
    if (!name || products.some((p) => p.toLowerCase() === name.toLowerCase()) || products.length >= DRINK_PRODUCTS_MAX) {
      setDraft('');
      return;
    }
    setProducts((current) => [...current, name]);
    setDraft('');
    setDirty(true);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-3">
      <input type="hidden" name="products" value={JSON.stringify(products)} />
      <p className="text-[13px] font-medium text-ink">Produkte am Automaten</p>
      <div className="flex flex-wrap gap-2">
        {products.map((product) => (
          <span key={product} className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-3 py-1 text-sm text-ink">
            {product}
            <button
              type="button"
              aria-label={`${product} entfernen`}
              className="text-ink-muted hover:text-danger"
              onClick={() => {
                setProducts((current) => current.filter((p) => p !== product));
                setDirty(true);
              }}
            >
              ×
            </button>
          </span>
        ))}
        {products.length === 0 && <span className="text-sm text-ink-faint">Standard: {DEFAULT_DRINK_PRODUCTS.join(', ')}</span>}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          maxLength={DRINK_PRODUCT_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Produkt hinzufügen"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink"
        />
        <button type="button" onClick={add} className="rounded-md bg-neutral-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-600">
          Hinzufügen
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        Höchstens {DRINK_PRODUCTS_MAX} Produkte. Ohne Einträge gilt die Standardliste.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
            saved ? 'bg-success hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
          }`}
        >
          {pending ? 'Speichern…' : saved ? 'Gespeichert' : 'Speichern'}
        </button>
        {state.error && <p className="text-xs text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

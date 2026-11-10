export type SaveOutcome = { ok: true; savedAt: string } | { ok: false; error: string };

interface AutosaverOptions {
  save: () => Promise<SaveOutcome>;
  onSaved: (savedAt: Date) => void;
  onError: (message: string) => void;
  delayMs: number;
}

export const CONNECTION_ERROR = 'Keine Verbindung zum Server oder die App wurde aktualisiert. Bitte die Seite neu laden.';

/**
 * Entprelltes Speichern für den Wizard: `markDirty` plant ein Speichern `delayMs` nach der letzten Änderung,
 * `flush` speichert sofort (Schrittwechsel, Speichern, Schließen) und meldet, ob danach alles gesichert ist.
 *
 * Wirft nie. Ein Fehler (auch eine geworfene Ausnahme, z. B. ohne Netz oder nach einem Deploy mit veralteter
 * Server-Action-ID) wird gemeldet und lässt die Änderung offen; spätere Versuche bleiben möglich. Früher blieb
 * in diesem Fall ein abgelehntes Versprechen hängen, und jedes weitere Speichern/Schließen scheiterte lautlos.
 */
export function createAutosaver({ save, onSaved, onError, delayMs }: AutosaverOptions) {
  let dirty = false;
  let inflight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function flush(): Promise<boolean> {
    clearTimer();
    // Läuft bereits ein Speichern, danach den dann aktuellen Stand sichern (letzter Stand gewinnt).
    while (inflight) await inflight;
    if (!dirty) return true;
    dirty = false;
    const run = (async () => {
      try {
        const result = await save();
        if (result.ok) {
          onSaved(new Date(result.savedAt));
          return true;
        }
        dirty = true;
        onError(result.error);
        return false;
      } catch (error) {
        console.error('Checkliste: Speichern fehlgeschlagen', error);
        dirty = true;
        onError(CONNECTION_ERROR);
        return false;
      } finally {
        inflight = null;
      }
    })();
    inflight = run;
    return run;
  }

  return {
    markDirty() {
      dirty = true;
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    dispose: clearTimer,
  };
}

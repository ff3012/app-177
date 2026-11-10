import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosaver, type SaveOutcome } from './autosave';

const ok = (savedAt = '2026-06-15T10:00:00.000Z'): SaveOutcome => ({ ok: true, savedAt });

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save: () => Promise<SaveOutcome>) {
    const onSaved = vi.fn();
    const onError = vi.fn();
    const saver = createAutosaver({ save, onSaved, onError, delayMs: 2000 });
    return { saver, onSaved, onError };
  }

  it('speichert 2 s nach der letzten Änderung, nicht früher', async () => {
    const save = vi.fn().mockResolvedValue(ok());
    const { saver, onSaved } = setup(save);
    saver.markDirty();
    await vi.advanceTimersByTimeAsync(1999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(new Date('2026-06-15T10:00:00.000Z'));
  });

  it('setzt die Wartezeit bei jeder weiteren Änderung zurück (ein Speichern für viele Tastendrücke)', async () => {
    const save = vi.fn().mockResolvedValue(ok());
    const { saver } = setup(save);
    saver.markDirty();
    await vi.advanceTimersByTimeAsync(1500);
    saver.markDirty();
    await vi.advanceTimersByTimeAsync(1500);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush speichert sofort und meldet true', async () => {
    const save = vi.fn().mockResolvedValue(ok());
    const { saver } = setup(save);
    saver.markDirty();
    expect(await saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush ohne Änderung speichert nichts und meldet true', async () => {
    const save = vi.fn().mockResolvedValue(ok());
    const { saver } = setup(save);
    expect(await saver.flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('ein vom Server gemeldeter Fehler wird gemeldet, die Änderung bleibt offen', async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Du darfst diesen Entwurf nicht bearbeiten.' }).mockResolvedValueOnce(ok());
    const { saver, onError, onSaved } = setup(save);
    saver.markDirty();
    expect(await saver.flush()).toBe(false);
    expect(onError).toHaveBeenCalledWith('Du darfst diesen Entwurf nicht bearbeiten.');
    expect(await saver.flush()).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('eine geworfene Ausnahme (z. B. Netzwerk, veraltete App-Version) wird gemeldet und blockiert spätere Versuche nicht', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(ok());
    const { saver, onError } = setup(save);
    saver.markDirty();
    expect(await saver.flush()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/Verbindung|neu laden/i);
    // Früher blieb hier ein abgelehntes Versprechen hängen und jedes weitere Speichern/Schließen warf erneut.
    expect(await saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('speichert nach einem laufenden Speichern erneut, wenn inzwischen weiter geändert wurde', async () => {
    let release!: (value: SaveOutcome) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<SaveOutcome>((resolve) => (release = resolve)))
      .mockResolvedValueOnce(ok('2026-06-15T10:05:00.000Z'));
    const { saver, onSaved } = setup(save);
    saver.markDirty();
    const first = saver.flush();
    saver.markDirty();
    const second = saver.flush();
    release(ok());
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenLastCalledWith(new Date('2026-06-15T10:05:00.000Z'));
  });

  it('dispose stoppt das geplante Speichern', async () => {
    const save = vi.fn().mockResolvedValue(ok());
    const { saver } = setup(save);
    saver.markDirty();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});

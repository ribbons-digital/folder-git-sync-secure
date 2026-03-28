export interface DeferredSelectionController<T> {
  choose: (item: T) => void;
  finalize: () => void;
}

export function createDeferredSelection<T>(
  onPick: (item: T | null) => void
): DeferredSelectionController<T> {
  let selected: T | null = null;
  let hasSelection = false;
  let resolved = false;
  let finalizeScheduled = false;

  const resolve = (value: T | null): void => {
    if (resolved) {
      return;
    }

    resolved = true;
    onPick(value);
  };

  const scheduleFinalize = (): void => {
    if (resolved || finalizeScheduled) {
      return;
    }

    finalizeScheduled = true;
    const run = (): void => {
      finalizeScheduled = false;
      if (resolved) {
        return;
      }

      resolve(hasSelection ? selected : null);
    };

    if (typeof globalThis.queueMicrotask === "function") {
      globalThis.queueMicrotask(run);
      return;
    }

    if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(run, 0);
      return;
    }

    run();
  };

  return {
    choose(item: T): void {
      selected = item;
      hasSelection = true;
      resolve(item);
    },
    finalize(): void {
      scheduleFinalize();
    }
  };
}

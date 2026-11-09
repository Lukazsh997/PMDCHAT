import { useSyncExternalStore } from 'react';

/** Estado global mínimo (sem bibliotecas): um valor, assinantes e um hook. */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((prev: T) => T)) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    use<S>(selector: (v: T) => S): S {
      return useSyncExternalStore(this.subscribe, () => selector(value));
    },
  };
}

/**
 * A listener function for an event payload.
 *
 * @example
 * ```ts
 * const onPage: Listener<number> = (index) => console.log(index);
 * ```
 */
export type Listener<T> = (payload: T) => void;

/**
 * The subscription side of a typed event emitter. `on` returns an unsubscribe function.
 *
 * @example
 * ```ts
 * const off = viewport.on("pagechange", (index) => setPage(index));
 * off();
 * ```
 */
export interface Subscribable<Events extends object> {
  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void;
  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void;
}

/**
 * A small typed event emitter. A listener that throws does not stop the other listeners; the
 * error is passed to `onListenerError`.
 *
 * @example
 * ```ts
 * const e = new Emitter<{ change: number }>();
 * e.on("change", (n) => console.log(n));
 * e.emit("change", 1);
 * ```
 */
export class Emitter<Events extends object> implements Subscribable<Events> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>();
  #onListenerError: (error: unknown) => void;

  constructor(onListenerError: (error: unknown) => void = (error) => queueMicrotask(() => { throw error; })) {
    this.#onListenerError = onListenerError;
  }

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.#listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        this.#onListenerError(error);
      }
    }
  }

  /** Number of listeners for `type`. Useful in tests. */
  listenerCount(type: keyof Events): number {
    return this.#listeners.get(type)?.size ?? 0;
  }

  /** Removes every listener. */
  clear(): void {
    this.#listeners.clear();
  }
}

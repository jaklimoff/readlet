/**
 * The machine-readable reason of a {@link ReadletError}.
 *
 * - `invalid-pdf`: the bytes are not a valid document.
 * - `password-required`: the document is encrypted.
 * - `network`: the source could not be fetched.
 * - `render-cancelled`: a newer render or a release replaced this render.
 * - `worker-failed`: the background worker could not start or crashed.
 * - `destroyed`: the object was used after `destroy()`.
 * - `unknown`: anything else. The original error is in `cause`.
 *
 * @example
 * ```ts
 * if (error.code === "password-required") askForPassword();
 * ```
 */
export type ReadletErrorCode =
  | "invalid-pdf"
  | "password-required"
  | "network"
  | "render-cancelled"
  | "worker-failed"
  | "destroyed"
  | "unknown";

/**
 * The only error type that Readlet surfaces. Branch on `code`, not on the message.
 *
 * @example
 * ```ts
 * try {
 *   await loadDocument(src, { backend });
 * } catch (e) {
 *   if (isReadletError(e) && e.code === "network") showOffline();
 * }
 * ```
 */
export class ReadletError extends Error {
  readonly code: ReadletErrorCode;

  constructor(code: ReadletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReadletError";
    this.code = code;
  }
}

/**
 * Type guard for {@link ReadletError}.
 *
 * @example
 * ```ts
 * if (isReadletError(err)) console.log(err.code);
 * ```
 */
export function isReadletError(value: unknown): value is ReadletError {
  return value instanceof ReadletError;
}

/**
 * Wraps any thrown value as a {@link ReadletError}. A `ReadletError` passes through unchanged.
 *
 * @example
 * ```ts
 * emitter.emit("error", toReadletError(e, "unknown"));
 * ```
 */
export function toReadletError(
  value: unknown,
  fallback: ReadletErrorCode = "unknown",
): ReadletError {
  if (value instanceof ReadletError) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new ReadletError(fallback, message, { cause: value });
}

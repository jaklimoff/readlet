import { describe, expect, it, vi } from "vitest";
import { Emitter } from "../../src/model/emitter";
import { isReadletError, ReadletError, toReadletError } from "../../src/model/errors";

describe("Emitter", () => {
  it("emits, unsubscribes and isolates listener errors", () => {
    const errors: unknown[] = [];
    const e = new Emitter<{ a: number; b: string }>((err) => errors.push(err));
    const fn = vi.fn();
    const off = e.on("a", fn);
    e.on("a", () => {
      throw new Error("boom");
    });
    const fn2 = vi.fn();
    e.on("a", fn2);
    e.emit("a", 1);
    expect(fn).toHaveBeenCalledWith(1);
    expect(fn2).toHaveBeenCalledWith(1);
    expect(errors).toHaveLength(1);
    off();
    e.emit("a", 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(e.listenerCount("a")).toBe(2);
    e.emit("b", "nobody listens");
    e.clear();
    expect(e.listenerCount("a")).toBe(0);
  });
  it("rethrows listener errors asynchronously by default", async () => {
    const e = new Emitter<{ a: number }>();
    e.on("a", () => {
      throw new Error("later");
    });
    const seen = new Promise<unknown>((resolve) => {
      const handler = (err: unknown) => {
        process.off("uncaughtException", handler);
        resolve(err);
      };
      process.prependListener("uncaughtException", handler);
    });
    // vitest reports uncaught errors; intercept it with a microtask-level listener.
    const original = globalThis.queueMicrotask;
    let captured: (() => void) | undefined;
    globalThis.queueMicrotask = (cb) => {
      captured = cb;
    };
    e.emit("a", 1);
    globalThis.queueMicrotask = original;
    expect(() => captured?.()).toThrow("later");
    void seen;
  });
});

describe("ReadletError", () => {
  it("wraps values", () => {
    const err = new ReadletError("network", "offline");
    expect(isReadletError(err)).toBe(true);
    expect(toReadletError(err)).toBe(err);
    const wrapped = toReadletError(new Error("x"), "invalid-pdf");
    expect(wrapped.code).toBe("invalid-pdf");
    expect(wrapped.message).toBe("x");
    expect(toReadletError("str").code).toBe("unknown");
    expect(isReadletError(new Error("x"))).toBe(false);
  });
});

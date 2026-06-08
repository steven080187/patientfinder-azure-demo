function ensureReadableStreamAsyncIteration() {
  const proto = globalThis.ReadableStream && ReadableStream.prototype;
  if (!proto) return;

  if (typeof proto[Symbol.asyncIterator] !== "function") {
    proto[Symbol.asyncIterator] = function () {
      const reader = this.getReader();
      return {
        async next() {
          const result = await reader.read();
          if (result.done) {
            try {
              reader.releaseLock();
            } catch {}
          }
          return result;
        },
        async return() {
          try {
            reader.releaseLock();
          } catch {}
          return { done: true, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };
  }

  if (typeof proto.values !== "function") {
    proto.values = function () {
      return this[Symbol.asyncIterator]();
    };
  }
}

ensureReadableStreamAsyncIteration();

await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");

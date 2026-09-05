/**
 * Limita chamadas a uma por `ms`, garantindo que a última sempre é executada
 * (trailing). Usado para o arraste de token não inundar o servidor.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const flush = () => {
    timer = null;
    if (pending) {
      last = Date.now();
      const args = pending;
      pending = null;
      fn(...args);
    }
  };

  return (...args: A) => {
    const now = Date.now();
    if (now - last >= ms && !timer) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      if (!timer) timer = setTimeout(flush, ms - (now - last));
    }
  };
}

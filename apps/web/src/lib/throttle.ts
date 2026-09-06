/**
 * Limita chamadas a uma por `ms`, garantindo que a última sempre é executada
 * (trailing). Usado para o arraste de token não inundar o servidor.
 * `cancel()` descarta a chamada pendente (ex.: ao soltar o token, a posição
 * final já foi enviada e uma pendente atrasada gravaria uma posição velha).
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

  const throttled = (...args: A) => {
    const now = Date.now();
    if (now - last >= ms && !timer) {
      last = now;
      fn(...args);
    } else {
      pending = args;
      if (!timer) timer = setTimeout(flush, ms - (now - last));
    }
  };

  throttled.cancel = () => {
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return throttled;
}

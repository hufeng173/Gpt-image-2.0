type LimiterState = {
  active: number;
  queue: Array<() => void>;
};

const globalForLimiter = globalThis as unknown as {
  taijituLimiter?: LimiterState;
};

const state = globalForLimiter.taijituLimiter ?? { active: 0, queue: [] };
globalForLimiter.taijituLimiter = state;

export async function runWithGenerationLimit<T>(limit: number, task: () => Promise<T>): Promise<T> {
  const safeLimit = Math.min(12, Math.max(1, Number(limit || 1)));

  if (state.active >= safeLimit) {
    await new Promise<void>((resolve) => {
      state.queue.push(resolve);
    });
  }

  state.active += 1;

  try {
    return await task();
  } finally {
    state.active = Math.max(0, state.active - 1);
    const next = state.queue.shift();
    if (next) next();
  }
}

export function getLimiterSnapshot() {
  return {
    active: state.active,
    waiting: state.queue.length,
  };
}

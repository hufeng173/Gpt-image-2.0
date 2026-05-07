type LimiterState = {
  active: number;
  queue: Array<{
    id: number;
    enqueuedAt: number;
    resolve: () => void;
  }>;
  nextId: number;
  completed: number;
};

const globalForLimiter = globalThis as unknown as {
  taijituLimiter?: LimiterState;
};

const state = globalForLimiter.taijituLimiter ?? { active: 0, queue: [], nextId: 1, completed: 0 };
globalForLimiter.taijituLimiter = state;

export type GenerationQueueResult<T> = {
  result: T;
  queued: boolean;
  queueId: number | null;
  waitingAhead: number;
  waitMs: number;
  limit: number;
};

export async function runWithGenerationLimit<T>(limit: number, task: () => Promise<T>): Promise<GenerationQueueResult<T>> {
  const safeLimit = Math.min(20, Math.max(1, Number(limit || 1)));
  let queueId: number | null = null;
  let waitingAhead = 0;
  let enqueuedAt = Date.now();

  if (state.active >= safeLimit) {
    await new Promise<void>((resolve) => {
      queueId = state.nextId++;
      enqueuedAt = Date.now();
      waitingAhead = state.queue.length;
      state.queue.push({ id: queueId, enqueuedAt, resolve });
    });
  }

  state.active += 1;
  const waitMs = queueId ? Date.now() - enqueuedAt : 0;

  try {
    const result = await task();
    return {
      result,
      queued: queueId !== null,
      queueId,
      waitingAhead,
      waitMs,
      limit: safeLimit,
    };
  } finally {
    state.active = Math.max(0, state.active - 1);
    const next = state.queue.shift();
    state.completed += 1;
    if (next) next.resolve();
  }
}

export function getLimiterSnapshot() {
  return {
    active: state.active,
    waiting: state.queue.length,
    completed: state.completed,
    nextQueueId: state.nextId,
    oldestWaitingMs: state.queue[0] ? Date.now() - state.queue[0].enqueuedAt : 0,
  };
}

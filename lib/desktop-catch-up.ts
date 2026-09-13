type TimerHandle = number | ReturnType<typeof setTimeout>;

export type DesktopCatchUpCoordinator = {
  trigger(force?: boolean): void;
  dispose(): void;
};

export function createDesktopCatchUpCoordinator(
  run: () => Promise<unknown>,
  options: {
    cooldownMs?: number;
    now?: () => number;
    setTimer?: (callback: () => void, delay: number) => TimerHandle;
    clearTimer?: (timer: TimerHandle) => void;
  } = {},
): DesktopCatchUpCoordinator {
  const cooldownMs = options.cooldownMs ?? 30_000;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let disposed = false;
  let active: Promise<void> | null = null;
  let lastStartedAt: number | null = null;
  let pending = false;
  let pendingForce = false;
  let timer: TimerHandle | null = null;

  const clearScheduled = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const trigger = (force = false) => {
    if (disposed) return;
    if (active) {
      pending = true;
      pendingForce ||= force;
      return;
    }

    const current = now();
    const remaining = lastStartedAt === null ? 0 : cooldownMs - (current - lastStartedAt);
    if (!force && remaining > 0) {
      pending = true;
      if (timer === null) {
        timer = setTimer(() => {
          timer = null;
          const queuedForce = pendingForce;
          pending = false;
          pendingForce = false;
          trigger(queuedForce);
        }, remaining);
      }
      return;
    }

    clearScheduled();
    pending = false;
    pendingForce = false;
    lastStartedAt = current;
    active = Promise.resolve()
      .then(run)
      .then(() => {}, () => {})
      .finally(() => {
        active = null;
        if (disposed || !pending) return;
        const queuedForce = pendingForce;
        pending = false;
        pendingForce = false;
        trigger(queuedForce);
      });
  };

  return {
    trigger,
    dispose() {
      disposed = true;
      pending = false;
      pendingForce = false;
      clearScheduled();
    },
  };
}

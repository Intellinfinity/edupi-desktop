const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~=-]{0,255}$/u;

declare global {
  var __edupiAmbientSessionLocks: Map<string, Promise<void>> | undefined;
}

const locks = globalThis.__edupiAmbientSessionLocks ??= new Map<string, Promise<void>>();

export async function withEduPiAmbientSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  if (!ID.test(sessionId) || typeof operation !== "function") throw new Error("invalid_ambient_session_lock");
  const previous = locks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.catch(() => {}).then(() => gate);
  locks.set(sessionId, current);
  await previous.catch(() => {});
  try { return await operation(); }
  finally {
    release();
    if (locks.get(sessionId) === current) locks.delete(sessionId);
  }
}

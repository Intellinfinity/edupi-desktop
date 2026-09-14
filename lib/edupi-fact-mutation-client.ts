"use client";

let factMutationTail: Promise<void> = Promise.resolve();

export function runSerializedFactMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = factMutationTail.then(operation, operation);
  factMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

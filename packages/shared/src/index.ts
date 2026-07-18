export const APP_NAME = "PulseATX";

export function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Operation aborted"),
      );
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Operation aborted"),
        );
      },
      { once: true },
    );
  });
}

export async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

export interface LearningEvaluationRecord {
  actual: number;
  predictedWithMemory: number;
  predictedWithoutMemory: number;
}

export interface LearningEvaluation {
  improvementPercent: number;
  sampleCount: number;
  withMemoryMae: number;
  withoutMemoryMae: number;
}

export function evaluateLearning(
  records: readonly LearningEvaluationRecord[],
): LearningEvaluation {
  if (records.length === 0) {
    return {
      improvementPercent: 0,
      sampleCount: 0,
      withMemoryMae: 0,
      withoutMemoryMae: 0,
    };
  }
  const withoutMemoryMae =
    records.reduce(
      (total, record) =>
        total + Math.abs(record.predictedWithoutMemory - record.actual),
      0,
    ) / records.length;
  const withMemoryMae =
    records.reduce(
      (total, record) =>
        total + Math.abs(record.predictedWithMemory - record.actual),
      0,
    ) / records.length;
  return {
    improvementPercent:
      withoutMemoryMae === 0
        ? 0
        : Math.round(
            ((withoutMemoryMae - withMemoryMae) / withoutMemoryMae) * 10_000,
          ) / 100,
    sampleCount: records.length,
    withMemoryMae: Math.round(withMemoryMae * 100) / 100,
    withoutMemoryMae: Math.round(withoutMemoryMae * 100) / 100,
  };
}

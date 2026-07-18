export interface ScheduledSource {
  id: string;
  intervalMs: number;
  poll(signal?: AbortSignal): Promise<{ changed: number; received: number }>;
}

export interface SourcePollOutcome {
  changed: number;
  error: string | null;
  id: string;
  received: number;
}

interface SourceState {
  lastAttemptAt: number | null;
  source: ScheduledSource;
}

export class SourceScheduler {
  private readonly sources: SourceState[];

  constructor(sources: ScheduledSource[]) {
    this.sources = sources.map((source) => ({ lastAttemptAt: null, source }));
  }

  async pollDue(
    now: number,
    signal?: AbortSignal,
  ): Promise<SourcePollOutcome[]> {
    const outcomes: SourcePollOutcome[] = [];
    for (const state of this.sources) {
      if (
        state.lastAttemptAt !== null &&
        now - state.lastAttemptAt < state.source.intervalMs
      ) {
        continue;
      }
      state.lastAttemptAt = now;
      try {
        const summary = await state.source.poll(signal);
        outcomes.push({ ...summary, error: null, id: state.source.id });
      } catch (error) {
        outcomes.push({
          changed: 0,
          error:
            error instanceof Error ? error.message : "Unknown polling error",
          id: state.source.id,
          received: 0,
        });
      }
    }
    return outcomes;
  }
}

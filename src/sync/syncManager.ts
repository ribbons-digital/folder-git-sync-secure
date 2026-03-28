import type { FolderMappingSettings } from "../types.ts";
import { FolderGitSyncError } from "../utils/errors.ts";

export type SyncJobKind =
  | "commit"
  | "pull"
  | "push"
  | "sync"
  | "auto-sync"
  | "review";

interface QueueState {
  failureCount: number;
  nextAllowedAt: number;
  tail: Promise<unknown>;
}

interface EnqueueOptions {
  respectBackoff?: boolean;
  recordFailures?: boolean;
}

export class SyncManager {
  private readonly states = new Map<string, QueueState>();

  public async enqueue<T>(
    mapping: Pick<FolderMappingSettings, "id" | "folderPath">,
    jobKind: SyncJobKind,
    work: () => Promise<T>,
    options: EnqueueOptions = {}
  ): Promise<T> {
    const state = this.ensureState(mapping.id);
    const respectBackoff = options.respectBackoff ?? true;
    const recordFailures = options.recordFailures ?? respectBackoff;

    const next = state.tail
      .catch(() => undefined)
      .then(async () => {
        if (respectBackoff) {
          this.assertNotBackingOff(mapping.folderPath, state.nextAllowedAt, jobKind);
        }

        try {
          const result = await work();
          if (recordFailures) {
            state.failureCount = 0;
            state.nextAllowedAt = 0;
          }
          return result;
        } catch (error) {
          if (recordFailures) {
            state.failureCount += 1;
            state.nextAllowedAt =
              Date.now() + Math.min(300000, 5000 * 2 ** (state.failureCount - 1));
          }
          throw error;
        }
      });

    state.tail = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  public getBackoffRemaining(mappingId: string): number {
    const state = this.states.get(mappingId);
    if (!state) {
      return 0;
    }

    return Math.max(0, state.nextAllowedAt - Date.now());
  }

  private ensureState(mappingId: string): QueueState {
    const existing = this.states.get(mappingId);
    if (existing) {
      return existing;
    }

    const created: QueueState = {
      failureCount: 0,
      nextAllowedAt: 0,
      tail: Promise.resolve()
    };

    this.states.set(mappingId, created);
    return created;
  }

  private assertNotBackingOff(
    folderPath: string,
    nextAllowedAt: number,
    jobKind: SyncJobKind
  ): void {
    if (nextAllowedAt <= Date.now()) {
      return;
    }

    const seconds = Math.ceil((nextAllowedAt - Date.now()) / 1000);
    throw new FolderGitSyncError(
      "sync-backoff",
      `${jobKind} is temporarily paused for ${folderPath}. Retry in about ${seconds}s.`
    );
  }
}

export interface PeriodicPullConfig {
  enabled: boolean;
  intervalSeconds: number;
}

export interface PeriodicPullApplyOptions {
  immediate: boolean;
}

export interface PeriodicPullEngineDeps {
  runCycle: () => Promise<void>;
  onError?: (error: unknown) => void;
  setIntervalFn?: (
    handler: () => void,
    ms: number
  ) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

type PeriodicPullTimer = ReturnType<typeof setInterval>;

export class PeriodicPullEngine {
  private readonly deps: PeriodicPullEngineDeps;
  private timer: PeriodicPullTimer | undefined;
  private running = false;

  public constructor(deps: PeriodicPullEngineDeps) {
    this.deps = deps;
  }

  public async applyConfig(
    config: PeriodicPullConfig,
    options: PeriodicPullApplyOptions
  ): Promise<void> {
    this.stop();

    if (!config.enabled) {
      return;
    }

    if (options.immediate) {
      await this.runOnce();
    }

    if (config.intervalSeconds <= 0) {
      return;
    }

    this.timer = this.getSetIntervalFn()(() => {
      void this.runOnce();
    }, config.intervalSeconds * 1000);
  }

  public async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.deps.runCycle();
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.running = false;
    }
  }

  public stop(): void {
    if (this.timer !== undefined) {
      this.getClearIntervalFn()(this.timer);
      this.timer = undefined;
    }
  }

  private getSetIntervalFn(): (
    handler: () => void,
    ms: number
  ) => PeriodicPullTimer {
    return this.deps.setIntervalFn ?? globalThis.setInterval.bind(globalThis);
  }

  private getClearIntervalFn(): (timer: PeriodicPullTimer) => void {
    return this.deps.clearIntervalFn ?? globalThis.clearInterval.bind(globalThis);
  }
}

import { randomUUID } from 'node:crypto';

import { recordQueueEventMetric } from '../observability/metrics.js';

export interface JobRecord<TPayload> {
  id: string;
  type: string;
  payload: TPayload;
  attempts: number;
  runAfterMs: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

type JobHandler<TPayload> = (payload: TPayload, job: JobRecord<TPayload>) => Promise<void>;

export interface QueueConfig {
  pollIntervalMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function createDefaultConfig(): QueueConfig {
  return {
    pollIntervalMs: parsePositiveInt(process.env.JOB_QUEUE_POLL_INTERVAL_MS, 1_000),
    maxAttempts: parsePositiveInt(process.env.JOB_QUEUE_MAX_ATTEMPTS, 5),
    backoffBaseMs: parsePositiveInt(process.env.JOB_QUEUE_BACKOFF_BASE_MS, 5_000)
  };
}

export class InMemoryJobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly pendingJobs: JobRecord<unknown>[] = [];
  private readonly deadLetterJobs: JobRecord<unknown>[] = [];
  private readonly config: QueueConfig;
  private processing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: QueueConfig = createDefaultConfig()) {
    this.config = config;
  }

  registerHandler<TPayload>(type: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  enqueue<TPayload>(type: string, payload: TPayload, nowMs = Date.now()): JobRecord<TPayload> {
    const job: JobRecord<TPayload> = {
      id: randomUUID(),
      type,
      payload,
      attempts: 0,
      runAfterMs: nowMs,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      lastError: null
    };

    this.pendingJobs.push(job as JobRecord<unknown>);
    recordQueueEventMetric(`enqueued:${type}`);
    return job;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.processNextDueJob();
    }, this.config.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processNextDueJob(nowMs = Date.now()): Promise<boolean> {
    if (this.processing) {
      return false;
    }

    const dueJobIndex = this.pendingJobs.findIndex((job) => job.runAfterMs <= nowMs);
    if (dueJobIndex === -1) {
      return false;
    }

    this.processing = true;
    const job = this.pendingJobs[dueJobIndex];
    if (!job) {
      this.processing = false;
      return false;
    }

    this.pendingJobs.splice(dueJobIndex, 1);
    const handler = this.handlers.get(job.type);

    if (!handler) {
      job.attempts += 1;
      job.lastError = `No registered handler for job type "${job.type}"`;
      job.updatedAt = new Date(nowMs).toISOString();
      this.deadLetterJobs.push(job);
      recordQueueEventMetric(`dead_letter:${job.type}`);
      this.processing = false;
      return true;
    }

    try {
      await handler(job.payload, job);
      recordQueueEventMetric(`processed:${job.type}`);
      this.processing = false;
      return true;
    } catch (error) {
      job.attempts += 1;
      job.lastError = error instanceof Error ? error.message : 'Unknown job error';
      job.updatedAt = new Date(nowMs).toISOString();
      recordQueueEventMetric(`failed:${job.type}`);

      if (job.attempts >= this.config.maxAttempts) {
        this.deadLetterJobs.push(job);
        recordQueueEventMetric(`dead_letter:${job.type}`);
      } else {
        const delayMs = this.config.backoffBaseMs * (2 ** (job.attempts - 1));
        job.runAfterMs = nowMs + delayMs;
        this.pendingJobs.push(job);
      }

      this.processing = false;
      return true;
    }
  }

  getSnapshot(): {
    pending: number;
    dead_letter: number;
    handlers: string[];
  } {
    return {
      pending: this.pendingJobs.length,
      dead_letter: this.deadLetterJobs.length,
      handlers: Array.from(this.handlers.keys()).sort()
    };
  }

  resetForTests(): void {
    this.pendingJobs.length = 0;
    this.deadLetterJobs.length = 0;
    this.handlers.clear();
    this.processing = false;
    this.stop();
  }
}

export const jobQueue = new InMemoryJobQueue();

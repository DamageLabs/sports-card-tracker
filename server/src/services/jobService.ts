import Database from '../database';
import EventService from './eventService';
import { Job } from '../types';

export type JobHandler = (job: Job, updateProgress: (progress: number, completedItems: number) => Promise<void>) => Promise<Record<string, unknown>>;

class JobService {
  private db: Database;
  private eventService: EventService;
  private handlers: Map<string, JobHandler> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(db: Database, eventService: EventService) {
    this.db = db;
    this.eventService = eventService;
  }

  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  start(intervalMs: number = 5000): void {
    this.stop();
    this.pollInterval = setInterval(() => this.processNextJob(), intervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async processNextJob(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const job = await this.db.getNextPendingJob();
      if (!job) return;

      const handler = this.handlers.get(job.type);
      if (!handler) {
        await this.db.updateJob(job.id, {
          status: 'failed',
          error: `No handler registered for job type: ${job.type}`,
        });
        this.eventService.broadcast('job:failed', { jobId: job.id, error: `No handler for type: ${job.type}` });
        return;
      }

      await this.db.updateJob(job.id, { status: 'running' });
      this.eventService.broadcast('job:started', { jobId: job.id, type: job.type });

      const updateProgress = async (progress: number, completedItems: number): Promise<void> => {
        await this.db.updateJob(job.id, { progress, completedItems });
        this.eventService.broadcast('job:progress', { jobId: job.id, progress, completedItems });
      };

      try {
        const result = await handler(job, updateProgress);
        await this.db.updateJob(job.id, {
          status: 'completed',
          result,
          progress: 100,
        });
        this.eventService.broadcast('job:completed', { jobId: job.id, type: job.type, result });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.db.updateJob(job.id, {
          status: 'failed',
          error: errorMessage,
        });
        this.eventService.broadcast('job:failed', { jobId: job.id, error: errorMessage });
      }
    } finally {
      this.processing = false;
    }
  }
}

export default JobService;

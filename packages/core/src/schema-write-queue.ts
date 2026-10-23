import { Injectable } from '@nestjs/common';

/** Serializes every write to the project's schema files (content types, content groups): one at a time. */
@Injectable()
export class SchemaWriteQueue {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

// Tracks real atlas completion. Retry asks Library for the same pages, preserving
// its successful textures and shared decode limit.
export class Loading {
  constructor(onError) {
    this.onError = onError;
    this.jobs = new Set();
    this.box = document.getElementById("loading");
    this.line = document.getElementById("loading-line");
    this.progress = document.getElementById("loading-progress");
    this.retry = document.getElementById("loading-retry");
    this.retry.addEventListener("click", () => {
      for (const job of this.jobs) job.retry?.();
    });
    document.getElementById("loading-reload").addEventListener("click", () => location.reload());
  }

  ready() {
    if (!this.jobs.size) this.box.hidden = true;
  }

  async run(operation) {
    const job = { done: 0, total: 0, error: false, retry: null };
    this.jobs.add(job);
    try {
      for (;;) {
        job.error = false;
        this.draw();
        try {
          return await operation((done, total) => {
            Object.assign(job, { done, total });
            this.draw();
          });
        } catch (error) {
          job.error = true;
          this.onError(error);
          this.draw();
          await new Promise(resolve => { job.retry = resolve; });
          job.retry = null;
        }
      }
    } finally {
      this.jobs.delete(job);
      this.draw();
    }
  }

  draw() {
    this.box.hidden = !this.jobs.size;
    let done = 0;
    let total = 0;
    let failed = false;
    for (const job of this.jobs) {
      done += job.done;
      total += job.total;
      failed ||= job.error;
    }
    this.line.textContent = failed ? "Artwork download was interrupted. Check your connection and try again."
      : `Loading artwork${total ? ` · ${done} of ${total}` : "…"}`;
    this.progress.max = Math.max(1, total);
    this.progress.value = done;
    this.retry.hidden = !failed;
    document.getElementById("loading-reload").hidden = !failed;
  }
}

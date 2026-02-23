import { Worker } from "bullmq";
import { redis } from "./queue/redis.js";
import { runProxy } from "./services/proxyService.js";

const worker = new Worker(
  "proxy",
  async (job) => {
    const { userId, payload } = job.data as {
      userId: string;
      payload: { model: string; messages: { role: string; content: string }[]; dry_run?: boolean };
    };
    return runProxy({ userId, payload });
  },
  { connection: redis }
);

worker.on("failed", () => undefined);

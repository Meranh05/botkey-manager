import { Queue } from "bullmq";
import { redis } from "./redis.js";

export const proxyQueue = new Queue("proxy", {
  connection: redis
});

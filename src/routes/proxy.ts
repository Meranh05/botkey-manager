import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { bumpAggregate, mapResultToFlags } from "../utils/usage.js";
import { env } from "../config/env.js";
import dayjs from "dayjs";
import { runProxy } from "../services/proxyService.js";
import { proxyQueue } from "../queue/proxyQueue.js";

const router = Router();

const proxySchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
  dry_run: z.boolean().optional(),
  async: z.boolean().optional()
});

const isUserRateLimited = async (userId: string): Promise<boolean> => {
  if (env.userRateLimitPerMinute <= 0) return false;
  const since = dayjs().subtract(1, "minute").toDate();
  const count = await prisma.usageEvent.count({
    where: { userId, timestamp: { gte: since } }
  });
  return count >= env.userRateLimitPerMinute;
};

router.post("/chat", async (req, res) => {
  const user = req.auth;
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const payload = proxySchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  if (await isUserRateLimited(user.id)) {
    res.status(429).json({ error: "user_rate_limited" });
    return;
  }

  if (payload.data.async) {
    const job = await proxyQueue.add(
      "proxy",
      { userId: user.id, payload: payload.data },
      {
        attempts: env.proxyMaxRetries + 1,
        backoff: { type: "exponential", delay: env.proxyBackoffMs }
      }
    );
    res.json({ jobId: job.id });
    return;
  }

  const result = await runProxy({ userId: user.id, payload: payload.data });
  if (result.result === "dry_run" || result.result === "success") {
    res.json(result);
    return;
  }
  res.status(429).json({ error: result.reason });
});

router.get("/jobs/:id", async (req, res) => {
  const job = await proxyQueue.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const state = await job.getState();
  res.json({
    id: job.id,
    state,
    result: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null
  });
});

router.post("/usage/simulate", async (req, res) => {
  const user = req.auth;
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const schema = z.object({
    accountId: z.string().uuid(),
    tokens: z.number().int().min(0).default(0),
    result: z.enum(["success", "fail", "rate_limited"]).optional()
  });

  const payload = schema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const usage = await prisma.usageEvent.create({
    data: {
      accountId: payload.data.accountId,
      userId: user.id,
      action: "chat",
      requestTokens: payload.data.tokens,
      responseTokens: 0,
      totalTokens: payload.data.tokens,
      result: payload.data.result ?? "success"
    }
  });

  const flags = mapResultToFlags(usage.result);
  await bumpAggregate({
    accountId: usage.accountId,
    date: usage.timestamp,
    tokens: usage.totalTokens ?? 0,
    isFailure: flags.isFailure,
    isRateLimited: flags.isRateLimited
  });

  res.json({ id: usage.id });
});

export default router;

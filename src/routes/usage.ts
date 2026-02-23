import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { bumpAggregate, mapResultToFlags } from "../utils/usage.js";
import dayjs from "dayjs";

const router = Router();

const manualUsageSchema = z.object({
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  date: z.string().datetime(),
  requests: z.number().int().min(1).default(1),
  tokens: z.number().int().min(0).default(0),
  result: z.enum(["success", "fail", "rate_limited"]).optional()
});

router.post("/manual", async (req, res) => {
  const payload = manualUsageSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const timestamp = dayjs(payload.data.date).toDate();
  const usage = await prisma.usageEvent.create({
    data: {
      accountId: payload.data.accountId,
      userId: payload.data.userId,
      action: "api_call",
      requestTokens: payload.data.tokens,
      responseTokens: 0,
      totalTokens: payload.data.tokens,
      result: payload.data.result ?? "success",
      timestamp
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

router.get("/", async (req, res) => {
  const { from, to, provider_id: providerId, account_id: accountId, user_id: userId } =
    req.query;
  const where: Record<string, unknown> = {};
  if (typeof accountId === "string") where.accountId = accountId;
  if (typeof userId === "string") where.userId = userId;
  if (typeof from === "string" || typeof to === "string") {
    where.timestamp = {
      ...(typeof from === "string" ? { gte: new Date(from) } : {}),
      ...(typeof to === "string" ? { lte: new Date(to) } : {})
    };
  }

  const events = await prisma.usageEvent.findMany({
    where,
    include: { account: { include: { provider: true } } },
    orderBy: { timestamp: "desc" },
    take: 200
  });

  const filtered = providerId
    ? events.filter((e) => e.account.providerId === providerId)
    : events;

  res.json(
    filtered.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      accountId: e.accountId,
      providerId: e.account.providerId,
      userId: e.userId,
      action: e.action,
      totalTokens: e.totalTokens,
      result: e.result
    }))
  );
});

export default router;

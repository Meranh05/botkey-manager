import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { encryptToken, decryptToken } from "../security/encryption.js";
import { writeAudit } from "../audit/audit.js";

const router = Router();

const accountSchema = z.object({
  providerId: z.string().uuid(),
  label: z.string().min(2),
  plan: z.string().optional(),
  token: z.string().min(8),
  renewalType: z.enum(["manual", "auto"]).optional(),
  startDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  quotaType: z.enum(["requests", "tokens", "seats", "mixed"]).optional(),
  quotaLimit: z.record(z.any()).optional(),
  status: z
    .enum(["active", "expiring", "expired", "suspended", "rate_limited", "unknown"])
    .optional(),
  slaPriority: z.number().int().min(1).max(1000).optional(),
  notes: z.string().optional()
});

router.get("/", async (_req, res) => {
  const accounts = await prisma.account.findMany({
    include: { provider: true, currentKey: true }
  });
  res.json(
    accounts.map((a) => ({
      ...a,
      tokenEncrypted: undefined,
      tokenLast4: a.currentKey?.tokenLast4 ?? null
    }))
  );
});

router.get("/:id", async (req, res) => {
  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: { provider: true, currentKey: true, keys: true }
  });
  if (!account) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({
    ...account,
    tokenEncrypted: undefined,
    tokenLast4: account.currentKey?.tokenLast4 ?? null
  });
});

router.post("/", async (req, res) => {
  const payload = accountSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  const tokenLast4 = payload.data.token.slice(-4);
  const tokenEncrypted = encryptToken(payload.data.token);
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.account.create({
      data: {
        providerId: payload.data.providerId,
        label: payload.data.label,
        plan: payload.data.plan,
        renewalType: payload.data.renewalType,
        startDate: payload.data.startDate ? new Date(payload.data.startDate) : undefined,
        expiryDate: payload.data.expiryDate ? new Date(payload.data.expiryDate) : undefined,
        quotaType: payload.data.quotaType,
        quotaLimit: payload.data.quotaLimit,
        status: payload.data.status,
        slaPriority: payload.data.slaPriority,
        notes: payload.data.notes
      }
    });
    const key = await tx.accountKey.create({
      data: {
        accountId: created.id,
        tokenEncrypted,
        tokenLast4,
        isPrimary: true
      }
    });
    await tx.account.update({
      where: { id: created.id },
      data: { currentKeyId: key.id }
    });
    return created;
  });

  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "create_account",
      targetType: "account",
      targetId: account.id
    });
  }

  res.json({ id: account.id, status: account.status });
});

router.put("/:id", async (req, res) => {
  const payload = accountSchema.partial().safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  const data: Record<string, unknown> = { ...payload.data };
  if (payload.data.token) {
    const tokenEncrypted = encryptToken(payload.data.token);
    const tokenLast4 = payload.data.token.slice(-4);
    const key = await prisma.accountKey.create({
      data: {
        accountId: req.params.id,
        tokenEncrypted,
        tokenLast4,
        isPrimary: true
      }
    });
    data.currentKeyId = key.id;
  }
  if (payload.data.startDate) {
    data.startDate = new Date(payload.data.startDate);
  }
  if (payload.data.expiryDate) {
    data.expiryDate = new Date(payload.data.expiryDate);
  }
  delete data.token;

  const account = await prisma.account.update({
    where: { id: req.params.id },
    data
  });
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "update_account",
      targetType: "account",
      targetId: account.id
    });
  }
  res.json({ id: account.id, status: account.status });
});

router.post("/:id/token", async (req, res) => {
  const mfaVerified = req.headers["x-mfa-verified"] === "true";
  if (!mfaVerified) {
    res.status(403).json({ error: "mfa_required" });
    return;
  }
  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: { currentKey: true }
  });
  if (!account || !account.currentKey) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const token = decryptToken(account.currentKey.tokenEncrypted);
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "view_token",
      targetType: "account",
      targetId: account.id
    });
  }
  res.json({ token });
});

router.post("/:id/keys", async (req, res) => {
  const payload = z
    .object({ token: z.string().min(8), makePrimary: z.boolean().optional() })
    .safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }
  const tokenEncrypted = encryptToken(payload.data.token);
  const tokenLast4 = payload.data.token.slice(-4);
  const key = await prisma.accountKey.create({
    data: {
      accountId: req.params.id,
      tokenEncrypted,
      tokenLast4,
      isPrimary: payload.data.makePrimary ?? false
    }
  });
  if (payload.data.makePrimary) {
    await prisma.account.update({
      where: { id: req.params.id },
      data: { currentKeyId: key.id }
    });
  }
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "add_key",
      targetType: "account",
      targetId: req.params.id
    });
  }
  res.json({ id: key.id, last4: key.tokenLast4 });
});

router.post("/:id/keys/:keyId/activate", async (req, res) => {
  const key = await prisma.accountKey.findUnique({
    where: { id: req.params.keyId }
  });
  if (!key || key.accountId !== req.params.id) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await prisma.account.update({
    where: { id: req.params.id },
    data: { currentKeyId: key.id }
  });
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "activate_key",
      targetType: "account",
      targetId: req.params.id
    });
  }
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  await prisma.account.delete({ where: { id: req.params.id } });
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "delete_account",
      targetType: "account",
      targetId: req.params.id
    });
  }
  res.json({ ok: true });
});

export default router;

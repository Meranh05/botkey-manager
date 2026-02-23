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
    notes: z.string().optional()
});
router.get("/", async (_req, res) => {
    const accounts = await prisma.account.findMany({
        include: { provider: true }
    });
    res.json(accounts.map((a) => ({
        ...a,
        tokenEncrypted: undefined
    })));
});
router.get("/:id", async (req, res) => {
    const account = await prisma.account.findUnique({
        where: { id: req.params.id },
        include: { provider: true }
    });
    if (!account) {
        res.status(404).json({ error: "not_found" });
        return;
    }
    res.json({ ...account, tokenEncrypted: undefined });
});
router.post("/", async (req, res) => {
    const payload = accountSchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const tokenLast4 = payload.data.token.slice(-4);
    const tokenEncrypted = encryptToken(payload.data.token);
    const account = await prisma.account.create({
        data: {
            providerId: payload.data.providerId,
            label: payload.data.label,
            plan: payload.data.plan,
            tokenEncrypted,
            tokenLast4,
            renewalType: payload.data.renewalType,
            startDate: payload.data.startDate ? new Date(payload.data.startDate) : undefined,
            expiryDate: payload.data.expiryDate ? new Date(payload.data.expiryDate) : undefined,
            quotaType: payload.data.quotaType,
            quotaLimit: payload.data.quotaLimit,
            status: payload.data.status,
            notes: payload.data.notes
        }
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
    const data = { ...payload.data };
    if (payload.data.token) {
        data.tokenEncrypted = encryptToken(payload.data.token);
        data.tokenLast4 = payload.data.token.slice(-4);
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
        where: { id: req.params.id }
    });
    if (!account) {
        res.status(404).json({ error: "not_found" });
        return;
    }
    const token = decryptToken(account.tokenEncrypted);
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

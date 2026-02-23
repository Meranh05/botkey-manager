import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { writeAudit } from "../audit/audit.js";
const router = Router();
const accessSchema = z.object({
    accountId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.enum(["consumer", "manager"]).optional(),
    limitPolicy: z.record(z.any()).optional(),
    active: z.boolean().optional()
});
router.get("/", async (req, res) => {
    const { user_id: userId, account_id: accountId } = req.query;
    const accesses = await prisma.accountAccess.findMany({
        where: {
            userId: typeof userId === "string" ? userId : undefined,
            accountId: typeof accountId === "string" ? accountId : undefined
        }
    });
    res.json(accesses);
});
router.post("/", async (req, res) => {
    const payload = accessSchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const access = await prisma.accountAccess.create({
        data: payload.data
    });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "grant_access",
            targetType: "account_access",
            targetId: access.id
        });
    }
    res.json(access);
});
router.put("/:id", async (req, res) => {
    const payload = accessSchema.partial().safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const access = await prisma.accountAccess.update({
        where: { id: req.params.id },
        data: payload.data
    });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "update_access",
            targetType: "account_access",
            targetId: access.id
        });
    }
    res.json(access);
});
router.delete("/:id", async (req, res) => {
    await prisma.accountAccess.delete({ where: { id: req.params.id } });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "revoke_access",
            targetType: "account_access",
            targetId: req.params.id
        });
    }
    res.json({ ok: true });
});
export default router;

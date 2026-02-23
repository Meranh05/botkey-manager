import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { writeAudit } from "../audit/audit.js";
const router = Router();
const providerSchema = z.object({
    key: z
        .enum(["openai", "openai_compatible", "anthropic", "google", "perplexity"])
        .optional(),
    name: z.string().min(2),
    type: z.enum(["chat_subscription", "api_key"]),
    authMode: z.enum(["api_key", "oauth", "session_cookie"]),
    status: z.enum(["active", "disabled"]).optional(),
    apiBaseUrl: z.string().url().optional(),
    chatPath: z.string().optional(),
    extraHeaders: z.record(z.string()).optional()
});
router.get("/", async (_req, res) => {
    const providers = await prisma.provider.findMany();
    res.json(providers);
});
router.post("/", async (req, res) => {
    const payload = providerSchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const provider = await prisma.provider.create({ data: payload.data });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "create_provider",
            targetType: "provider",
            targetId: provider.id
        });
    }
    res.json(provider);
});
router.put("/:id", async (req, res) => {
    const payload = providerSchema.partial().safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const provider = await prisma.provider.update({
        where: { id: req.params.id },
        data: payload.data
    });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "update_provider",
            targetType: "provider",
            targetId: provider.id
        });
    }
    res.json(provider);
});
router.delete("/:id", async (req, res) => {
    await prisma.provider.delete({ where: { id: req.params.id } });
    if (req.auth) {
        await writeAudit({
            actorId: req.auth.id,
            action: "delete_provider",
            targetType: "provider",
            targetId: req.params.id
        });
    }
    res.json({ ok: true });
});
export default router;

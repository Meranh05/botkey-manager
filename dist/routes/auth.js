import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { hashPassword, verifyPassword } from "../security/password.js";
const router = Router();
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8)
});
router.post("/bootstrap", async (req, res) => {
    const payload = loginSchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const existing = await prisma.user.count();
    if (existing > 0) {
        res.status(403).json({ error: "bootstrap_disabled" });
        return;
    }
    const password = await hashPassword(payload.data.password);
    const user = await prisma.user.create({
        data: {
            email: payload.data.email,
            password,
            roles: {
                create: {
                    role: {
                        connectOrCreate: {
                            where: { name: "admin" },
                            create: { name: "admin" }
                        }
                    }
                }
            }
        }
    });
    res.json({ id: user.id, email: user.email });
});
router.post("/login", async (req, res) => {
    const payload = loginSchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const user = await prisma.user.findUnique({
        where: { email: payload.data.email },
        include: { roles: { include: { role: true } } }
    });
    if (!user) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
    }
    const ok = await verifyPassword(payload.data.password, user.password);
    if (!ok) {
        res.status(401).json({ error: "invalid_credentials" });
        return;
    }
    const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: "12h" });
    res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            roles: user.roles.map((r) => r.role.name)
        }
    });
});
router.get("/me", async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    try {
        const token = header.slice("Bearer ".length);
        const payload = jwt.verify(token, env.jwtSecret);
        const user = await prisma.user.findUnique({
            where: { id: payload.sub },
            include: { roles: { include: { role: true } } }
        });
        if (!user) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        res.json({
            id: user.id,
            email: user.email,
            roles: user.roles.map((r) => r.role.name)
        });
    }
    catch {
        res.status(401).json({ error: "unauthorized" });
    }
});
export default router;

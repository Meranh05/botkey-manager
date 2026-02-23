import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
export const authMiddleware = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const token = header.slice("Bearer ".length);
    try {
        const payload = jwt.verify(token, env.jwtSecret);
        const user = await prisma.user.findUnique({
            where: { id: payload.sub },
            include: { roles: { include: { role: true } } }
        });
        if (!user) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }
        req.auth = {
            id: user.id,
            email: user.email,
            roles: user.roles.map((r) => r.role.name)
        };
        next();
    }
    catch {
        res.status(401).json({ error: "unauthorized" });
    }
};

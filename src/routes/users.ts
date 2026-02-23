import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../security/password.js";
import { writeAudit } from "../audit/audit.js";

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  roles: z.array(z.string()).min(1)
});

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      roles: { include: { role: true } },
      createdAt: true
    }
  });
  res.json(
    users.map((u) => ({
      ...u,
      roles: u.roles.map((r) => r.role.name)
    }))
  );
});

router.post("/", async (req, res) => {
  const payload = createUserSchema.safeParse(req.body);
  if (!payload.success) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const password = await hashPassword(payload.data.password);
  const user = await prisma.user.create({
    data: {
      email: payload.data.email,
      name: payload.data.name,
      password,
      roles: {
        create: payload.data.roles.map((role) => ({
          role: {
            connectOrCreate: {
              where: { name: role },
              create: { name: role }
            }
          }
        }))
      }
    }
  });

  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "create_user",
      targetType: "user",
      targetId: user.id,
      meta: { email: user.email }
    });
  }

  res.json({ id: user.id, email: user.email });
});

export default router;

import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { writeAudit } from "../audit/audit.js";

const router = Router();

router.get("/", async (_req, res) => {
  const alerts = await prisma.alert.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json(alerts);
});

router.post("/:id/resolve", async (req, res) => {
  const alert = await prisma.alert.update({
    where: { id: req.params.id },
    data: { isResolved: true }
  });
  if (req.auth) {
    await writeAudit({
      actorId: req.auth.id,
      action: "resolve_alert",
      targetType: "alert",
      targetId: alert.id
    });
  }
  res.json({ ok: true });
});

export default router;

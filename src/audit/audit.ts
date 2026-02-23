import { prisma } from "../db/prisma.js";

export const writeAudit = async (params: {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  meta?: Record<string, unknown>;
}): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      meta: params.meta ?? {}
    }
  });
};

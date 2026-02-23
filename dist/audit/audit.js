import { prisma } from "../db/prisma.js";
export const writeAudit = async (params) => {
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

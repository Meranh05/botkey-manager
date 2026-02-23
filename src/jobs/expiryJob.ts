import dayjs from "dayjs";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";

export const runExpiryJob = async (): Promise<void> => {
  const now = dayjs();
  const soonDate = now.add(env.expirySoonDays, "day").toDate();

  const accounts = await prisma.account.findMany({
    where: { expiryDate: { not: null } }
  });

  for (const account of accounts) {
    if (!account.expiryDate) continue;

    const isExpired = dayjs(account.expiryDate).isBefore(now);
    const isExpiring = dayjs(account.expiryDate).isBefore(soonDate);

    const nextStatus = isExpired ? "expired" : isExpiring ? "expiring" : "active";
    const canOverride = ["active", "expiring", "expired", "unknown"].includes(account.status);
    if (canOverride && account.status !== nextStatus) {
      await prisma.account.update({
        where: { id: account.id },
        data: { status: nextStatus }
      });
    }

    if (isExpired || isExpiring) {
      const type = "expiry_soon";
      const existing = await prisma.alert.findFirst({
        where: { accountId: account.id, type, isResolved: false }
      });
      if (!existing) {
        await prisma.alert.create({
          data: {
            accountId: account.id,
            type,
            severity: isExpired ? "high" : "medium",
            message: isExpired
              ? "Account expired"
              : `Account expires in ${env.expirySoonDays} days`
          }
        });
      }
    }
  }
};

export const startExpiryJob = (): void => {
  const run = () => runExpiryJob().catch(() => undefined);
  run();
  setInterval(run, 60 * 60 * 1000);
};

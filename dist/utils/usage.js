import dayjs from "dayjs";
import { prisma } from "../db/prisma.js";
export const bumpAggregate = async (params) => {
    const dateKey = dayjs(params.date).startOf("day").toDate();
    await prisma.usageAggregate.upsert({
        where: {
            date_accountId: {
                date: dateKey,
                accountId: params.accountId
            }
        },
        update: {
            requests: { increment: 1 },
            tokens: { increment: params.tokens },
            failures: params.isFailure ? { increment: 1 } : undefined,
            rateLimited: params.isRateLimited ? { increment: 1 } : undefined
        },
        create: {
            date: dateKey,
            accountId: params.accountId,
            requests: 1,
            tokens: params.tokens,
            failures: params.isFailure ? 1 : 0,
            rateLimited: params.isRateLimited ? 1 : 0
        }
    });
};
export const mapResultToFlags = (result) => ({
    isFailure: result === "fail",
    isRateLimited: result === "rate_limited"
});

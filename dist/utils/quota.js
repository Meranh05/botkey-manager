import dayjs from "dayjs";
import { prisma } from "../db/prisma.js";
const getUsage = async (params) => {
    const agg = await prisma.usageEvent.aggregate({
        where: {
            accountId: params.accountId,
            userId: params.userId,
            timestamp: { gte: params.from, lte: params.to }
        },
        _count: { _all: true },
        _sum: { totalTokens: true }
    });
    return {
        requests: agg._count._all,
        tokens: agg._sum.totalTokens ?? 0
    };
};
export const checkQuota = async (params) => {
    const now = dayjs();
    const dayStart = now.startOf("day").toDate();
    const dayEnd = now.endOf("day").toDate();
    const monthStart = now.startOf("month").toDate();
    const monthEnd = now.endOf("month").toDate();
    const [dayUsageUser, monthUsageUser, dayUsageAccount, monthUsageAccount] = await Promise.all([
        getUsage({ accountId: params.accountId, userId: params.userId, from: dayStart, to: dayEnd }),
        getUsage({ accountId: params.accountId, userId: params.userId, from: monthStart, to: monthEnd }),
        getUsage({ accountId: params.accountId, from: dayStart, to: dayEnd }),
        getUsage({ accountId: params.accountId, from: monthStart, to: monthEnd })
    ]);
    const userPolicy = params.userPolicy ?? {};
    const accountQuota = params.accountQuota ?? {};
    if (userPolicy.daily_requests && dayUsageUser.requests >= userPolicy.daily_requests) {
        return { ok: false, reason: "user_daily_requests_exceeded" };
    }
    if (userPolicy.monthly_requests && monthUsageUser.requests >= userPolicy.monthly_requests) {
        return { ok: false, reason: "user_monthly_requests_exceeded" };
    }
    if (userPolicy.daily_tokens && dayUsageUser.tokens >= userPolicy.daily_tokens) {
        return { ok: false, reason: "user_daily_tokens_exceeded" };
    }
    if (userPolicy.monthly_tokens && monthUsageUser.tokens >= userPolicy.monthly_tokens) {
        return { ok: false, reason: "user_monthly_tokens_exceeded" };
    }
    if (accountQuota.daily?.requests && dayUsageAccount.requests >= accountQuota.daily.requests) {
        return { ok: false, reason: "account_daily_requests_exceeded" };
    }
    if (accountQuota.monthly?.requests && monthUsageAccount.requests >= accountQuota.monthly.requests) {
        return { ok: false, reason: "account_monthly_requests_exceeded" };
    }
    if (accountQuota.daily?.tokens && dayUsageAccount.tokens >= accountQuota.daily.tokens) {
        return { ok: false, reason: "account_daily_tokens_exceeded" };
    }
    if (accountQuota.monthly?.tokens && monthUsageAccount.tokens >= accountQuota.monthly.tokens) {
        return { ok: false, reason: "account_monthly_tokens_exceeded" };
    }
    return { ok: true };
};

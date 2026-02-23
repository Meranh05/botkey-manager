import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { checkQuota } from "../utils/quota.js";
import { bumpAggregate, mapResultToFlags } from "../utils/usage.js";
import { decryptToken } from "../security/encryption.js";
import { buildProviderRequest, extractUsage } from "../providers/adapter.js";
import { env } from "../config/env.js";
import dayjs from "dayjs";
const router = Router();
const proxySchema = z.object({
    model: z.string().min(1),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
    dry_run: z.boolean().optional()
});
const ensureAlert = async (params) => {
    const existing = await prisma.alert.findFirst({
        where: { accountId: params.accountId, type: params.type, isResolved: false }
    });
    if (!existing) {
        await prisma.alert.create({
            data: {
                accountId: params.accountId,
                type: params.type,
                severity: params.severity,
                message: params.message
            }
        });
    }
};
const isAccountCooling = async (accountId) => {
    if (env.accountCooldownSeconds <= 0)
        return false;
    const since = dayjs().subtract(env.accountCooldownSeconds, "second").toDate();
    const recent = await prisma.usageEvent.findFirst({
        where: {
            accountId,
            timestamp: { gte: since },
            result: { in: ["rate_limited", "fail"] }
        },
        orderBy: { timestamp: "desc" }
    });
    return Boolean(recent);
};
const isUserRateLimited = async (userId) => {
    if (env.userRateLimitPerMinute <= 0)
        return false;
    const since = dayjs().subtract(1, "minute").toDate();
    const count = await prisma.usageEvent.count({
        where: { userId, timestamp: { gte: since } }
    });
    return count >= env.userRateLimitPerMinute;
};
router.post("/chat", async (req, res) => {
    const user = req.auth;
    if (!user) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const payload = proxySchema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    if (await isUserRateLimited(user.id)) {
        res.status(429).json({ error: "user_rate_limited" });
        return;
    }
    const accesses = (await prisma.accountAccess.findMany({
        where: { userId: user.id, active: true },
        include: { account: { include: { provider: true } } }
    }));
    const eligibleAccounts = accesses
        .filter((a) => ["active", "expiring"].includes(a.account.status))
        .filter((a) => a.account.provider.status === "active")
        .filter((a) => a.account.provider.authMode === "api_key")
        .map((a) => a.account);
    const today = dayjs().startOf("day").toDate();
    const aggregates = await prisma.usageAggregate.findMany({
        where: { accountId: { in: eligibleAccounts.map((a) => a.id) }, date: today }
    });
    const aggregateMap = new Map(aggregates.map((agg) => [
        agg.accountId,
        Number(agg.tokens ?? 0)
    ]));
    const sortedAccounts = [...eligibleAccounts].sort((a, b) => {
        const aTokens = aggregateMap.get(a.id) ?? 0;
        const bTokens = aggregateMap.get(b.id) ?? 0;
        return aTokens - bTokens;
    });
    for (const account of sortedAccounts) {
        if (await isAccountCooling(account.id)) {
            continue;
        }
        const access = accesses.find((a) => a.accountId === account.id);
        const quotaCheck = await checkQuota({
            accountId: account.id,
            userId: user.id,
            accountQuota: (account.quotaLimit ?? {}),
            userPolicy: (access?.limitPolicy ?? {})
        });
        if (!quotaCheck.ok) {
            if (quotaCheck.reason?.startsWith("account_")) {
                await ensureAlert({
                    accountId: account.id,
                    type: "quota_exceeded",
                    severity: "medium",
                    message: `Account quota exceeded: ${quotaCheck.reason}`
                });
            }
            continue;
        }
        if (payload.data.dry_run) {
            return res.json({
                result: "dry_run",
                accountId: account.id,
                providerId: account.providerId
            });
        }
        try {
            const token = decryptToken(account.tokenEncrypted);
            const request = buildProviderRequest({
                provider: {
                    key: account.provider.key,
                    apiBaseUrl: account.provider.apiBaseUrl,
                    chatPath: account.provider.chatPath,
                    extraHeaders: account.provider.extraHeaders
                },
                apiKey: token,
                model: payload.data.model,
                messages: payload.data.messages
            });
            const response = await fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: JSON.stringify(request.body)
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok) {
                const result = response.status === 429 ? "rate_limited" : "fail";
                const flags = mapResultToFlags(result);
                await prisma.usageEvent.create({
                    data: {
                        accountId: account.id,
                        userId: user.id,
                        action: "chat",
                        result,
                        meta: {
                            status: response.status,
                            error: json?.error?.message ?? "provider_error"
                        }
                    }
                });
                await bumpAggregate({
                    accountId: account.id,
                    date: new Date(),
                    tokens: 0,
                    isFailure: flags.isFailure,
                    isRateLimited: flags.isRateLimited
                });
                if (response.status === 401 || response.status === 403) {
                    await prisma.account.update({
                        where: { id: account.id },
                        data: { status: "suspended" }
                    });
                    await ensureAlert({
                        accountId: account.id,
                        type: "key_invalid",
                        severity: "high",
                        message: "Provider rejected API key"
                    });
                }
                if (response.status === 429) {
                    await ensureAlert({
                        accountId: account.id,
                        type: "quota_exceeded",
                        severity: "medium",
                        message: "Provider rate limited"
                    });
                }
                continue;
            }
            const usage = extractUsage({
                providerKey: account.provider.key,
                response: json
            });
            const requestTokens = usage.promptTokens;
            const responseTokens = usage.completionTokens;
            const totalTokens = usage.totalTokens;
            const usageEvent = await prisma.usageEvent.create({
                data: {
                    accountId: account.id,
                    userId: user.id,
                    action: "chat",
                    requestTokens,
                    responseTokens,
                    totalTokens,
                    result: "success",
                    meta: {
                        model: payload.data.model,
                        provider: account.provider.name
                    }
                }
            });
            await bumpAggregate({
                accountId: account.id,
                date: usageEvent.timestamp,
                tokens: usageEvent.totalTokens ?? 0,
                isFailure: false,
                isRateLimited: false
            });
            res.json({
                result: "success",
                accountId: account.id,
                providerId: account.providerId,
                response: json
            });
            return;
        }
        catch {
            continue;
        }
    }
    res.status(429).json({ error: "no_available_account" });
});
router.post("/usage/simulate", async (req, res) => {
    const user = req.auth;
    if (!user) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }
    const schema = z.object({
        accountId: z.string().uuid(),
        tokens: z.number().int().min(0).default(0),
        result: z.enum(["success", "fail", "rate_limited"]).optional()
    });
    const payload = schema.safeParse(req.body);
    if (!payload.success) {
        res.status(400).json({ error: "invalid_payload" });
        return;
    }
    const usage = await prisma.usageEvent.create({
        data: {
            accountId: payload.data.accountId,
            userId: user.id,
            action: "chat",
            requestTokens: payload.data.tokens,
            responseTokens: 0,
            totalTokens: payload.data.tokens,
            result: payload.data.result ?? "success"
        }
    });
    const flags = mapResultToFlags(usage.result);
    await bumpAggregate({
        accountId: usage.accountId,
        date: usage.timestamp,
        tokens: usage.totalTokens ?? 0,
        isFailure: flags.isFailure,
        isRateLimited: flags.isRateLimited
    });
    res.json({ id: usage.id });
});
export default router;

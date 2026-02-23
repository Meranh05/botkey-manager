import dayjs from "dayjs";
import { prisma } from "../db/prisma.js";
import { decryptToken } from "../security/encryption.js";
import { buildProviderRequest, extractUsage } from "../providers/adapter.js";
import { bumpAggregate, mapResultToFlags } from "../utils/usage.js";
import { checkQuota } from "../utils/quota.js";
import { env } from "../config/env.js";

type ProxyPayload = {
  model: string;
  messages: { role: string; content: string }[];
  dry_run?: boolean;
};

type AccessWithAccount = {
  accountId: string;
  limitPolicy?: Record<string, unknown> | null;
  account: {
    id: string;
    status: string;
    providerId: string;
    slaPriority: number;
    quotaLimit?: Record<string, unknown> | null;
    provider: {
      name: string;
      status: string;
      authMode: string;
      key: string;
      apiBaseUrl?: string | null;
      chatPath?: string | null;
      extraHeaders?: Record<string, string> | null;
    };
    currentKeyId?: string | null;
    keys: {
      id: string;
      status: string;
      tokenEncrypted: Buffer;
      tokenLast4: string;
    }[];
  };
};

const ensureAlert = async (params: {
  accountId: string;
  type: "expiry_soon" | "quota_exceeded" | "key_invalid";
  severity: "low" | "medium" | "high";
  message: string;
}): Promise<void> => {
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

const isAccountCooling = async (accountId: string): Promise<boolean> => {
  if (env.accountCooldownSeconds <= 0) return false;
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

const pickActiveKey = (access: AccessWithAccount["account"]): AccessWithAccount["account"]["keys"][0] | null => {
  const current = access.keys.find((k) => k.id === access.currentKeyId && k.status === "active");
  if (current) return current;
  return access.keys.find((k) => k.status === "active") ?? null;
};

const markKeyInvalid = async (keyId: string): Promise<void> => {
  await prisma.accountKey.update({
    where: { id: keyId },
    data: { status: "invalid", isPrimary: false }
  });
};

const rotateToNextKey = async (accountId: string): Promise<string | null> => {
  const next = await prisma.accountKey.findFirst({
    where: { accountId, status: "active" },
    orderBy: { createdAt: "desc" }
  });
  if (!next) return null;
  await prisma.account.update({
    where: { id: accountId },
    data: { currentKeyId: next.id }
  });
  return next.id;
};

const backoff = async (attempt: number): Promise<void> => {
  const delay = env.proxyBackoffMs * Math.pow(2, attempt);
  await new Promise((resolve) => setTimeout(resolve, delay));
};

export const runProxy = async (params: {
  userId: string;
  payload: ProxyPayload;
}): Promise<
  | { result: "dry_run"; accountId: string; providerId: string }
  | { result: "success"; accountId: string; providerId: string; response: unknown }
  | { result: "error"; reason: string }
> => {
  const accesses = (await prisma.accountAccess.findMany({
    where: { userId: params.userId, active: true },
    include: { account: { include: { provider: true, keys: true } } }
  })) as AccessWithAccount[];

  const eligibleAccounts = accesses
    .filter((a) => ["active", "expiring"].includes(a.account.status))
    .filter((a) => a.account.provider.status === "active")
    .filter((a) => a.account.provider.authMode === "api_key")
    .filter((a) => a.account.keys.some((k) => k.status === "active"))
    .map((a) => a.account);

  if (eligibleAccounts.length === 0) {
    return { result: "error", reason: "no_available_account" };
  }

  const today = dayjs().startOf("day").toDate();
  const aggregates = await prisma.usageAggregate.findMany({
    where: { accountId: { in: eligibleAccounts.map((a) => a.id) }, date: today }
  });
  const aggregateMap = new Map<string, number>(
    aggregates.map((agg: { accountId: string; tokens: number }) => [
      agg.accountId,
      Number(agg.tokens ?? 0)
    ])
  );

  const sortedAccounts = [...eligibleAccounts].sort((a, b) => {
    const priority = a.slaPriority - b.slaPriority;
    if (priority !== 0) return priority;
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
      userId: params.userId,
      accountQuota: (account.quotaLimit ?? {}) as any,
      userPolicy: (access?.limitPolicy ?? {}) as any
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

    if (params.payload.dry_run) {
      return { result: "dry_run", accountId: account.id, providerId: account.providerId };
    }

    for (let attempt = 0; attempt <= env.proxyMaxRetries; attempt += 1) {
      const key = pickActiveKey(account);
      if (!key) break;
      const token = decryptToken(key.tokenEncrypted);
      const request = buildProviderRequest({
        provider: {
          key: account.provider.key,
          apiBaseUrl: account.provider.apiBaseUrl,
          chatPath: account.provider.chatPath,
          extraHeaders: account.provider.extraHeaders as Record<string, string> | null
        },
        apiKey: token,
        model: params.payload.model,
        messages: params.payload.messages
      });

      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(request.body)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          const result = response.status === 429 ? "rate_limited" : "fail";
          const flags = mapResultToFlags(result as any);
          await prisma.usageEvent.create({
            data: {
              accountId: account.id,
              userId: params.userId,
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
            await markKeyInvalid(key.id);
            await ensureAlert({
              accountId: account.id,
              type: "key_invalid",
              severity: "high",
              message: "Provider rejected API key"
            });
            await rotateToNextKey(account.id);
            break;
          }

          if (response.status === 429) {
            await ensureAlert({
              accountId: account.id,
              type: "quota_exceeded",
              severity: "medium",
              message: "Provider rate limited"
            });
          }

          if (response.status >= 500 || response.status === 429) {
            if (attempt < env.proxyMaxRetries) {
              await backoff(attempt);
              continue;
            }
          }

          break;
        }

        const usage = extractUsage({
          providerKey: account.provider.key,
          response: json
        });
        const usageEvent = await prisma.usageEvent.create({
          data: {
            accountId: account.id,
            userId: params.userId,
            action: "chat",
            requestTokens: usage.promptTokens,
            responseTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            result: "success",
            meta: {
              model: params.payload.model,
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

        return {
          result: "success",
          accountId: account.id,
          providerId: account.providerId,
          response: json
        };
      } catch {
        if (attempt < env.proxyMaxRetries) {
          await backoff(attempt);
          continue;
        }
      }
    }
  }

  return { result: "error", reason: "no_available_account" };
};

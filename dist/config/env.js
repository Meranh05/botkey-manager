import dotenv from "dotenv";
dotenv.config();
const requireEnv = (key) => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing env: ${key}`);
    }
    return value;
};
export const env = {
    port: Number(process.env.PORT ?? "4000"),
    databaseUrl: requireEnv("DATABASE_URL"),
    jwtSecret: requireEnv("JWT_SECRET"),
    encryptionKeyB64: requireEnv("ENCRYPTION_KEY_B64"),
    logRetentionDays: Number(process.env.LOG_RETENTION_DAYS ?? "90"),
    expirySoonDays: Number(process.env.EXPIRY_SOON_DAYS ?? "7"),
    userRateLimitPerMinute: Number(process.env.USER_RATE_LIMIT_PER_MINUTE ?? "60"),
    accountCooldownSeconds: Number(process.env.ACCOUNT_COOLDOWN_SECONDS ?? "30")
};

import crypto from "crypto";
import { env } from "../config/env.js";
const key = Buffer.from(env.encryptionKeyB64, "base64");
if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY_B64 must be 32 bytes base64");
}
export const encryptToken = (token) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
};
export const decryptToken = (payload) => {
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
};

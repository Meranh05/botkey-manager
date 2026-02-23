# Botkey Manager (Backend API)

Triển khai nhanh một backend API bảo mật cao để quản lý account premium/API key đa nhà cung cấp.

## Cài đặt nhanh

1) Cài dependencies
```
npm install
```

2) Tạo biến môi trường
- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY_B64` (base64 của 32 bytes)
- `REDIS_URL`
- `PORT` (tuỳ chọn)
- `USER_RATE_LIMIT_PER_MINUTE` (tuỳ chọn, default 60)
- `ACCOUNT_COOLDOWN_SECONDS` (tuỳ chọn, default 30)
- `PROXY_MAX_RETRIES` (tuỳ chọn, default 2)
- `PROXY_BACKOFF_MS` (tuỳ chọn, default 500)

3) Migrate DB + generate Prisma client
```
npm run prisma:generate
npm run prisma:migrate
```

4) Chạy dev
```
npm run dev
```

5) Chạy worker (queue)
```
npm run worker
```

## Bootstrap admin
```
POST /auth/bootstrap
{
  "email": "admin@example.com",
  "password": "strong_password"
}
```

## Proxy mode (thực tế)
- Provider cần `authMode=api_key`
- Nếu không set, mặc định `apiBaseUrl=https://api.openai.com` và `chatPath=/v1/chat/completions`
- Hệ thống chọn account theo **least-used trong ngày**, có **cooldown** sau lỗi/rate limit

Ví dụ tạo provider OpenAI compatible:
```
POST /providers
{
  "key": "openai_compatible",
  "name": "OpenAI",
  "type": "api_key",
  "authMode": "api_key",
  "apiBaseUrl": "https://api.openai.com",
  "chatPath": "/v1/chat/completions"
}
```

Ví dụ tạo provider Anthropic/Claude:
```
POST /providers
{
  "key": "anthropic",
  "name": "Anthropic",
  "type": "api_key",
  "authMode": "api_key",
  "apiBaseUrl": "https://api.anthropic.com",
  "chatPath": "/v1/messages",
  "extraHeaders": {
    "anthropic-version": "2023-06-01"
  }
}
```

Ví dụ tạo provider Google/Gemini:
```
POST /providers
{
  "key": "google",
  "name": "Gemini",
  "type": "api_key",
  "authMode": "api_key",
  "apiBaseUrl": "https://generativelanguage.googleapis.com"
}
```

Ví dụ tạo provider Perplexity:
```
POST /providers
{
  "key": "perplexity",
  "name": "Perplexity",
  "type": "api_key",
  "authMode": "api_key",
  "apiBaseUrl": "https://api.perplexity.ai",
  "chatPath": "/chat/completions"
}
```

Gọi proxy:
```
POST /proxy/chat
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

Gọi proxy async (queue):
```
POST /proxy/chat
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Hello" }],
  "async": true
}
```

Check job:
```
GET /proxy/jobs/:id
```

## Ghi chú bảo mật
- Token được mã hoá AES-256-GCM và chỉ hiển thị `last4`.
- Xem full token cần header `X-MFA-Verified: true` và role admin.
- Audit log ghi lại các hành động nhạy cảm.

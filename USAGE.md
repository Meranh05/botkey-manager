# Botkey Manager — Hướng dẫn sử dụng

Tài liệu này hướng dẫn vận hành nhanh hệ thống từ khởi động đến test proxy.

## 1) Chuẩn bị dịch vụ nền

### Docker 
```bash
docker run --name botkey-postgres -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=chatbot_manager -p 5432:5432 -d postgres:16
docker run --name botkey-redis -p 6379:6379 -d redis:7
```

## 2) Biến môi trường

Thiết lập trong PowerShell:
```powershell
$env:DATABASE_URL="postgresql://postgres:pass@localhost:5432/chatbot_manager?schema=public"
$env:JWT_SECRET="your_secret"
$env:ENCRYPTION_KEY_B64="f021tgubClS1wf3O1Eeo/KdzZ/3INX/ZsoMYZCADIec="
$env:REDIS_URL="redis://localhost:6379"
```

## 3) Cài đặt & migrate
```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

## 4) Chạy hệ thống

### Server
```bash
npm run dev
```

### Worker (queue)
```bash
npm run worker
```

## 5) Truy cập UI
Mở trình duyệt: `http://localhost:4000/`

## 6) Quy trình sử dụng (từng bước)

### Bước 1 — Bootstrap Admin
- Nhập **Admin Email** và **Master Password**
- Bấm **Bootstrap Account**
- Lưu ý: chỉ chạy **1 lần**.

### Bước 2 — Login
- Nhập email + password vừa tạo
- Bấm **Login**
- Token sẽ hiển thị và trạng thái chuyển sang **active**.

### Bước 3 — Tạo Provider
Ví dụ OpenAI-compatible:
```
key: openai_compatible
apiBaseUrl: https://api.openai.com
chatPath: /v1/chat/completions
authMode: api_key
```

### Bước 4 — Tạo Account
- Dán **Provider ID**
- Nhập **Label**, **Token**, **Expiry (ISO)** nếu cần
- Bấm **Create Account**

### Bước 5 — Test Proxy
Nhập **Model** + **Message** → bấm **Call /proxy/chat**
- Nếu bật **Async**, dùng `job id` để check trạng thái.

## 7) Test nhanh bằng Postman

### Login
```
POST /auth/login
{
  "email": "admin@example.com",
  "password": "strong_password"
}
```

### Providers
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

### Accounts
```
POST /accounts
{
  "providerId": "PROVIDER_ID",
  "label": "OpenAI Key #1",
  "plan": "API",
  "token": "sk-xxxx",
  "expiryDate": "2026-12-31T00:00:00.000Z"
}
```

### Proxy
```
POST /proxy/chat
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

## 8) Lỗi thường gặp

- **Cannot connect to 4000** → server chưa chạy (`npm run dev`)
- **P1001** → Postgres chưa chạy
- **ENCRYPTION_KEY_B64 must be 32 bytes** → set sai key
- **429** khi proxy → account hết quota hoặc rate-limit

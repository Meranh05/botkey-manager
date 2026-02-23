# Chatbot Premium Account Manager — Phân tích & Đặc tả hệ thống

Tài liệu này mô tả đặc tả đầy đủ cho hệ thống web quản lý account premium/API key đa nhà cung cấp (OpenAI/ChatGPT, Anthropic/Claude, Google/Gemini, Perplexity, v.v.).

## 1) Persona & quyền hạn (RBAC)

### Persona
- **Admin**: toàn quyền quản trị hệ thống, cấu hình bảo mật, xem token đầy đủ (MFA + audit).
- **Manager**: xem báo cáo, duyệt cấp quyền, xem usage, không xem token đầy đủ.
- **User/Operator**: sử dụng account được cấp, xem quota cá nhân, không xem token.
- **Auditor (tùy chọn)**: chỉ đọc báo cáo + audit log, không can thiệp.

### Bảng quyền (RBAC)

| Chức năng | Admin | Manager | User | Auditor |
|---|---|---|---|---|
| CRUD Providers | ✅ | ❌ | ❌ | ❌ |
| CRUD Accounts | ✅ | ⚠️ (view/edit hạn chế) | ❌ | ❌ |
| Xem token đầy đủ | ✅ (MFA + audit) | ❌ | ❌ | ❌ |
| Gán quyền account | ✅ | ✅ (duyệt) | ❌ | ❌ |
| Xem usage/report | ✅ | ✅ | ✅ (cá nhân) | ✅ |
| Import usage | ✅ | ✅ | ❌ | ❌ |
| Resolve alerts | ✅ | ✅ | ❌ | ❌ |
| Security settings | ✅ | ❌ | ❌ | ❌ |
| Audit logs | ✅ | ✅ | ❌ | ✅ |

### Quy định truy cập token
- **Chỉ Admin** được xem token đầy đủ, bắt buộc MFA + ghi audit.
- UI chỉ hiển thị `last4`.
- Bất kỳ hành động xem/rotate token đều ghi audit log.

## 2) Danh sách tính năng theo module (Feature Breakdown)

### 2.1 Dashboard
- **Mục đích**: tổng quan tài khoản, usage, cảnh báo.
- **User stories**:
  - Admin xem số account active/expiring/expired.
  - Manager xem usage 7/30 ngày và top users.
- **Acceptance criteria**:
  - Hiển thị cards tổng quan + chart usage theo ngày.
  - Alert list có filter severity.
- **Edge cases**:
  - Không có dữ liệu usage → hiển thị empty state.
  - Usage import trễ → cảnh báo “data stale”.

### 2.2 Providers
- **Mục đích**: quản lý nhà cung cấp (OpenAI/Claude/Gemini…).
- **User stories**:
  - Admin tạo provider mới với auth_mode.
- **Acceptance criteria**:
  - CRUD provider, status active/disabled.
- **Edge cases**:
  - Disable provider → account liên quan chuyển `suspended`.

### 2.3 Accounts
- **Mục đích**: quản lý account/premium/key.
- **User stories**:
  - Admin thêm account + nhập token.
  - Manager xem trạng thái/usage.
- **Acceptance criteria**:
  - Token được mã hóa AES-256-GCM.
  - Status tự cập nhật expiring/expired.
- **Edge cases**:
  - Expiry missing → status = `unknown`.
  - Token invalid → alert `key_invalid`.

### 2.4 Access Management
- **Mục đích**: gán quyền account cho user/team.
- **User stories**:
  - Manager gán account cho user + hạn mức.
- **Acceptance criteria**:
  - Support limit policy per user/per account.
- **Edge cases**:
  - User bị revoke → deny proxy request.

### 2.5 Usage Tracking
- **Mục đích**: log, aggregate, import/export.
- **User stories**:
  - Admin import CSV usage.
  - User xem usage cá nhân.
- **Acceptance criteria**:
  - Lưu usage_events + aggregate daily.
- **Edge cases**:
  - Import duplicate → tránh double count.

### 2.6 Alerts & Notifications
- **Mục đích**: cảnh báo expiry/quota/key invalid.
- **User stories**:
  - Manager nhận cảnh báo trên Slack/email.
- **Acceptance criteria**:
  - Resolve/acknowledge alerts.
- **Edge cases**:
  - Alert spam → throttle theo loại.

### 2.7 Reports/Analytics
- **Mục đích**: báo cáo theo provider/account/user.
- **User stories**:
  - Manager tải báo cáo tháng.
- **Acceptance criteria**:
  - Filter theo date range, provider, account.
- **Edge cases**:
  - Timezone ảnh hưởng aggregation.

### 2.8 Settings/Security
- **Mục đích**: cấu hình key mã hóa, retention.
- **User stories**:
  - Admin đổi retention 90 ngày.
- **Acceptance criteria**:
  - Ghi audit khi đổi cấu hình.
- **Edge cases**:
  - Rotation encryption key → hỗ trợ re-encrypt.

## 3) Luồng nghiệp vụ chi tiết (Business Flows)

### 3.1 Tạo Provider
- **Trigger**: Admin tạo mới.
- **Bước xử lý**:
  1) Nhập tên + type + auth_mode.
  2) Lưu DB.
- **Dữ liệu vào/ra**: provider data → provider_id.
- **Lỗi & xử lý**: trùng tên → reject.

### 3.2 Tạo Account + nhập token + mã hóa
- **Trigger**: Admin thêm account.
- **Bước xử lý**:
  1) Nhập label/plan/expiry/quota.
  2) Nhập token → AES-256-GCM encrypt.
  3) Lưu token_last4 + encrypted blob.
- **Dữ liệu vào/ra**: token + account meta → account_id.
- **Lỗi & xử lý**: token rỗng → reject.

### 3.3 Gán quyền sử dụng account cho user/team
- **Trigger**: Admin/Manager cấp access.
- **Bước xử lý**:
  1) Chọn account + user/team.
  2) Set limit policy.
- **Dữ liệu vào/ra**: account_access record.
- **Lỗi & xử lý**: limit vượt global quota → warn.

### 3.4 Cập nhật trạng thái account
- **Trigger**: Cron hoặc API test key.
- **Bước xử lý**:
  1) Nếu expiry <= X ngày → `expiring`.
  2) Nếu quá hạn → `expired`.
  3) Nếu provider trả 401/403 → `suspended`.
- **Lỗi & xử lý**: provider timeout → status `unknown`.

### 3.5 Kiểm tra expiry/quota tự động (cron)
- **Trigger**: Scheduler 1–6 giờ/lần.
- **Bước xử lý**:
  1) Scan accounts.
  2) Tạo alert nếu gần hết hạn/quota.
- **Lỗi & xử lý**: db lock → retry.

### 3.6 Rotate token / revoke token
- **Trigger**: Admin action.
- **Bước xử lý**:
  1) Nhập token mới.
  2) Encrypt + update + audit.
- **Lỗi & xử lý**: token mới invalid → rollback.

### 3.7 Quy trình xử lý alert (acknowledge/resolve)
- **Trigger**: alert tạo.
- **Bước xử lý**:
  1) Manager/Admin acknowledge.
  2) Resolve khi xử lý xong.
- **Lỗi & xử lý**: resolve sai → reopen.

### 3.8 Luồng usage

**A. Manual mode**
- **Trigger**: Admin nhập hoặc import CSV.
- **Bước xử lý**:
  1) Validate file.
  2) Insert usage_events.
  3) Update aggregates.
- **Lỗi & xử lý**: CSV sai format → reject.

**B. Proxy mode**
- **Trigger**: User gọi `/proxy/chat`.
- **Bước xử lý**:
  1) Auth user.
  2) Chọn account phù hợp (active + còn quota).
  3) Gọi provider.
  4) Log usage.
  5) Nếu lỗi → fallback account.
- **Lỗi & xử lý**: rate limit → 429 + alert.

## 4) Data model (Postgres)

### Bảng `providers`
- Fields: `id (uuid)`, `name (text, unique)`, `type (enum)`, `auth_mode (enum)`, `status (enum)`, `created_at`, `updated_at`
- Index gợi ý: `(name)`

### Bảng `accounts`
- Fields: `id (uuid)`, `provider_id (uuid FK)`, `label`, `plan`, `token_encrypted (bytea)`, `token_last4`, `renewal_type`, `start_date`, `expiry_date`, `quota_type`, `quota_limit (jsonb)`, `status`, `notes`, `created_at`, `updated_at`
- Index gợi ý: `(provider_id)`, `(status)`, `(expiry_date)`

### Bảng `users`
- Fields: `id (uuid)`, `email`, `name`, `status`, `created_at`

### Bảng `roles`
- Fields: `id`, `name`
- Many-to-many: `user_roles(user_id, role_id)`

### Bảng `account_access`
- Fields: `id`, `account_id`, `user_id`, `role`, `limit_policy (jsonb)`, `active`
- Index gợi ý: `(user_id)`, `(account_id)`

### Bảng `usage_events`
- Fields: `id`, `timestamp`, `account_id`, `user_id`, `action`, `request_tokens`, `response_tokens`, `total_tokens`, `cost_estimate`, `result`, `meta (jsonb)`
- Index gợi ý: `(timestamp)`, `(account_id)`, `(user_id)`

### Bảng `usage_aggregates`
- Fields: `id`, `date`, `account_id`, `requests`, `tokens`, `failures`, `rate_limited`
- Index gợi ý: `(date, account_id)`

### Bảng `alerts`
- Fields: `id`, `type`, `severity`, `account_id`, `message`, `is_resolved`, `created_at`
- Index gợi ý: `(is_resolved)`, `(severity)`

### Bảng `audit_logs`
- Fields: `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `meta (jsonb)`, `created_at`
- Index gợi ý: `(actor_user_id)`, `(created_at)`

**Quota dữ liệu**
- `quota_limit` dạng json:
  - `{ "daily": { "requests": 1000, "tokens": 200000 }, "monthly": { "requests": 20000 } }`
- `limit_policy` per-user:
  - `{ "daily_tokens": 5000, "monthly_requests": 10000 }`

## 5) API specification (REST)

### Endpoint chính
- `POST /providers`, `GET /providers`, `PUT /providers/:id`, `DELETE /providers/:id`
- `POST /accounts`, `GET /accounts`, `PUT /accounts/:id`, `DELETE /accounts/:id`
- `POST /account-access`, `GET /account-access?user_id=`
- `POST /usage/manual`, `GET /usage`
- `POST /proxy/chat` (proxy mode)
- `GET /alerts`, `POST /alerts/:id/resolve`
- Auth: JWT (Bearer) hoặc session OAuth

### 5 endpoint quan trọng (mẫu JSON)

**1) POST /accounts**
```json
{
  "provider_id": "uuid",
  "label": "ChatGPT Team #1",
  "plan": "Team",
  "token": "sk-***",
  "expiry_date": "2026-12-31",
  "quota_limit": { "monthly": { "requests": 100000 } }
}
```
Response:
```json
{ "id": "uuid", "status": "active" }
```

**2) POST /account-access**
```json
{
  "account_id": "uuid",
  "user_id": "uuid",
  "role": "consumer",
  "limit_policy": { "daily_requests": 1000 }
}
```

**3) POST /usage/manual**
```json
{
  "account_id": "uuid",
  "user_id": "uuid",
  "date": "2026-02-20",
  "requests": 120,
  "tokens": 45000
}
```

**4) GET /usage?from=2026-02-01&to=2026-02-20&provider_id=...**
```json
{
  "items": [
    { "date": "2026-02-20", "requests": 120, "tokens": 45000 }
  ]
}
```

**5) POST /proxy/chat**
```json
{
  "model": "gpt-4.1-mini",
  "messages": [{ "role": "user", "content": "Hello" }]
}
```
Response:
```json
{
  "result": "success",
  "provider": "OpenAI",
  "usage": { "prompt_tokens": 10, "completion_tokens": 25 }
}
```

## 6) UI/UX wireframe description

- **Dashboard**: 4 cards (Active/Expiring/Expired/Alerts), chart usage theo ngày, list alerts.
- **Accounts list**: table + filter provider/status/quota, status màu (green/amber/red/gray), action menu.
- **Account detail**: tabs `Overview | Usage | Access | Logs | Settings`.
- **Alerts page**: filter by severity/type, bulk resolve.
- **Users & Roles**: list users, role badges, matrix account access.

## 7) Rules & Business logic (ràng buộc)

- **Expiring**: expiry_date ≤ X ngày (config, default 7).
- **Quota exceeded**:
  - Daily > limit hoặc Monthly > limit (per user & per account).
- **Ratelimit policy (proxy mode)**:
  - Per-user + per-account, cooldown 1–5 phút.
- **Token security**:
  - UI chỉ show last4, full token cần MFA + audit.
- **Data retention**:
  - usage_events giữ N ngày (default 90), aggregates giữ 12–24 tháng.

## 8) Security & Compliance checklist

- AES-256-GCM encryption at rest.
- Secret management (ENV/Vault).
- Audit bắt buộc: view token, rotate, grant access, disable account.
- Principle of least privilege.
- IP allowlist admin, 2FA (optional).
- Logging không được ghi token.

## 9) Non-functional requirements (NFR)

- **Performance**: 500–2000 accounts, 50–200 users, 1–5 req/s proxy.
- **Scalability**: worker + queue (Redis/BullMQ).
- **Reliability**: retry provider lỗi (exponential backoff).
- **Monitoring**: metrics latency, error rate, quota breach.
- **Backup & restore**: daily snapshot + restore test hàng tuần.

## 10) MVP plan

### MVP 1 (2 tuần)
- CRUD providers/accounts
- Token encryption
- Expiry tracking + basic alerts
- Manual usage + report basic

### MVP 2
- Proxy mode
- Rate limit per user/account
- Access matrix + audit log

### MVP 3
- Multi-provider integration
- Auto-check key health
- SSO + advanced reports

## Ràng buộc thực tế

- Tránh vi phạm điều khoản nhà cung cấp: không chia sẻ trái phép tài khoản/cookie; ưu tiên quản lý API key hợp lệ.
- Không lưu hoặc hiển thị thông tin nhạy cảm cho người không có quyền.
- Thiết kế dễ triển khai cho team nhỏ (1–2 dev).

const tokenLabel = document.getElementById("tokenLabel");
const authBadge = document.getElementById("authBadge");
const tokenStatus = document.getElementById("tokenStatus");
const avatar = document.getElementById("avatar");
const statProviders = document.getElementById("statProviders");
const statAccounts = document.getElementById("statAccounts");
const statAlerts = document.getElementById("statAlerts");
const healthBtn2 = document.getElementById("healthBtn2");
const providersSection = document.getElementById("providersSection");
const accountsSection = document.getElementById("accountsSection");
const proxySection = document.getElementById("proxySection");
const providerFields = [
  "providerKey",
  "providerName",
  "providerType",
  "providerAuth",
  "providerBaseUrl",
  "providerChatPath"
];
const accountFields = [
  "accountProviderId",
  "accountLabel",
  "accountPlan",
  "accountExpiry"
];

const getToken = () => localStorage.getItem("token");
const setToken = (token) => {
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
  tokenLabel.textContent = token ? token.slice(0, 16) + "..." : "none";
  const authed = Boolean(token);
  providersSection.classList.toggle("hidden", !authed);
  accountsSection.classList.toggle("hidden", !authed);
  proxySection.classList.toggle("hidden", !authed);
  authBadge.textContent = authed ? "Authenticated" : "Guest User";
  tokenStatus.textContent = authed ? "Token: active" : "Token: none";
};

const setUserInfo = (email) => {
  if (!email) {
    avatar.textContent = "GU";
    return;
  }
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  avatar.textContent = name.slice(0, 2).toUpperCase() || "AU";
};

const request = async (method, path, body, auth = true) => {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data, status: res.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {
        error: "network_error",
        message: "Server unreachable. Please start API server."
      }
    };
  }
};

const inflight = new Map();
const cached = {
  providers: null,
  accounts: null,
  alerts: null
};

const requestOnce = async (key, fn) => {
  if (inflight.has(key)) return inflight.get(key);
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
};

const setLoading = (btn, isLoading) => {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.dataset.text ??= btn.textContent;
  btn.textContent = isLoading ? "Loading..." : btn.dataset.text;
};

const setValue = (id, value) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value ?? "";
};

const saveForm = (key, fields) => {
  const payload = {};
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) payload[id] = el.value;
  });
  localStorage.setItem(key, JSON.stringify(payload));
};

const loadForm = (key, fields) => {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    fields.forEach((id) => {
      if (data[id] !== undefined) setValue(id, data[id]);
    });
  } catch {
    return;
  }
};

const applyProvider = (provider) => {
  if (!provider) return;
  setValue("providerKey", provider.key);
  setValue("providerName", provider.name);
  setValue("providerType", provider.type);
  setValue("providerAuth", provider.authMode);
  setValue("providerBaseUrl", provider.apiBaseUrl ?? "");
  setValue("providerChatPath", provider.chatPath ?? "");
  setValue("accountProviderId", provider.id);
  saveForm("providerForm", providerFields);
};

const applyAccount = (account) => {
  if (!account) return;
  setValue("accountProviderId", account.providerId ?? "");
  setValue("accountLabel", account.label ?? "");
  setValue("accountPlan", account.plan ?? "");
  setValue("accountExpiry", account.expiryDate ?? "");
  saveForm("accountForm", accountFields);
};

const fetchProvidersAndApply = async () => {
  const res = await requestOnce("providers", () => request("GET", "/providers", null, true));
  if (res.ok && res.data?.length) {
    cached.providers = res.data;
    applyProvider(res.data[0]);
    renderProvidersTable(res.data);
  }
  return res;
};

const fetchAccountsAndApply = async () => {
  const res = await requestOnce("accounts", () => request("GET", "/accounts", null, true));
  if (res.ok && res.data?.length) {
    cached.accounts = res.data;
    applyAccount(res.data[0]);
    renderAccountsTable(res.data);
  }
  return res;
};

const updateStats = async () => {
  const [providers, accounts, alerts] = await Promise.all([
    requestOnce("providers", () => request("GET", "/providers", null, true)),
    requestOnce("accounts", () => request("GET", "/accounts", null, true)),
    requestOnce("alerts", () => request("GET", "/alerts", null, true))
  ]);
  if (providers.ok) {
    cached.providers = providers.data;
    statProviders.textContent = providers.data.length ?? "-";
    renderProvidersTable(providers.data);
  }
  if (accounts.ok) {
    cached.accounts = accounts.data;
    statAccounts.textContent = accounts.data.length ?? "-";
    renderAccountsTable(accounts.data);
  }
  if (alerts.ok) {
    cached.alerts = alerts.data;
    statAlerts.textContent = alerts.data.length ?? "-";
  }
};

const show = (el, data) => {
  el.textContent = JSON.stringify(data, null, 2);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
};

const statusClass = (status) => {
  const map = {
    active: "status-active",
    expiring: "status-expiring",
    expired: "status-expired",
    suspended: "status-suspended",
    unknown: "status-unknown"
  };
  return map[status] ?? "status-unknown";
};

const renderProvidersTable = (items) => {
  const tbody = document.querySelector("#providersTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  (items || []).forEach((item, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.name ?? "-"}</td>
      <td>${item.key ?? "-"}</td>
      <td>${item.type ?? "-"}</td>
      <td><span class="status-badge ${statusClass(item.status)}">${item.status ?? "unknown"}</span></td>
      <td>${formatDate(item.createdAt)}</td>
    `;
    tbody.appendChild(tr);
  });
};

const renderAccountsTable = (items) => {
  const tbody = document.querySelector("#accountsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  (items || []).forEach((item, index) => {
    const last4 = item.tokenLast4 ? `****${item.tokenLast4}` : "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${item.label ?? "-"}</td>
      <td>${last4}</td>
      <td><span class="status-badge ${statusClass(item.status)}">${item.status ?? "unknown"}</span></td>
      <td>${formatDate(item.expiryDate)}</td>
    `;
    tbody.appendChild(tr);
  });
};

setToken(getToken());
loadForm("providerForm", providerFields);
loadForm("accountForm", accountFields);
loadForm("bootEmail", ["bootEmail"]);
loadForm("loginEmail", ["loginEmail"]);

const handleHealth = async () => {
  const out = document.getElementById("healthOut");
  setLoading(document.getElementById("healthBtn"), true);
  setLoading(healthBtn2, true);
  const res = await request("GET", "/health", null, false);
  show(out, res);
  setLoading(document.getElementById("healthBtn"), false);
  setLoading(healthBtn2, false);
};

document.getElementById("healthBtn").onclick = handleHealth;
if (healthBtn2) {
  healthBtn2.onclick = handleHealth;
}

document.getElementById("bootstrapBtn").onclick = async () => {
  const out = document.getElementById("authOut");
  const body = {
    email: document.getElementById("bootEmail").value,
    password: document.getElementById("bootPass").value
  };
  const res = await request("POST", "/auth/bootstrap", body, false);
  saveForm("bootEmail", ["bootEmail"]);
  show(out, res);
};

document.getElementById("loginBtn").onclick = async () => {
  const out = document.getElementById("authOut");
  const body = {
    email: document.getElementById("loginEmail").value,
    password: document.getElementById("loginPass").value
  };
  setLoading(document.getElementById("loginBtn"), true);
  const res = await request("POST", "/auth/login", body, false);
  if (res.ok && res.data.token) setToken(res.data.token);
  if (res.ok && res.data.user?.email) setUserInfo(res.data.user.email);
  if (res.ok) {
    updateStats();
    await fetchProvidersAndApply();
    await fetchAccountsAndApply();
  }
  saveForm("loginEmail", ["loginEmail"]);
  show(out, res);
  setLoading(document.getElementById("loginBtn"), false);
};

document.getElementById("logoutBtn").onclick = () => {
  setToken(null);
  setUserInfo(null);
};

document.getElementById("createProviderBtn").onclick = async () => {
  const out = document.getElementById("providersOut");
  const body = {
    key: document.getElementById("providerKey").value,
    name: document.getElementById("providerName").value,
    type: document.getElementById("providerType").value,
    authMode: document.getElementById("providerAuth").value,
    apiBaseUrl: document.getElementById("providerBaseUrl").value || undefined,
    chatPath: document.getElementById("providerChatPath").value || undefined
  };
  setLoading(document.getElementById("createProviderBtn"), true);
  const res = await request("POST", "/providers", body, true);
  show(out, res);
  saveForm("providerForm", providerFields);
  if (res.ok) await fetchProvidersAndApply();
  setLoading(document.getElementById("createProviderBtn"), false);
};

document.getElementById("listProvidersBtn").onclick = async () => {
  const out = document.getElementById("providersOut");
  setLoading(document.getElementById("listProvidersBtn"), true);
  if (cached.providers) {
    show(out, { ok: true, data: cached.providers });
    statProviders.textContent = cached.providers.length ?? "-";
    setLoading(document.getElementById("listProvidersBtn"), false);
    return;
  }
  const res = await fetchProvidersAndApply();
  show(out, res);
  if (res.ok) statProviders.textContent = res.data.length ?? "-";
  setLoading(document.getElementById("listProvidersBtn"), false);
};

document.getElementById("createAccountBtn").onclick = async () => {
  const out = document.getElementById("accountsOut");
  const body = {
    providerId: document.getElementById("accountProviderId").value,
    label: document.getElementById("accountLabel").value,
    plan: document.getElementById("accountPlan").value,
    token: document.getElementById("accountToken").value,
    expiryDate: document.getElementById("accountExpiry").value || undefined
  };
  if (!body.providerId || !body.label || !body.token) {
    show(out, {
      ok: false,
      data: { error: "missing_fields", message: "ProviderId, Label, Token required." }
    });
    return;
  }
  setLoading(document.getElementById("createAccountBtn"), true);
  const res = await request("POST", "/accounts", body, true);
  show(out, res);
  saveForm("accountForm", accountFields);
  if (res.ok) await fetchAccountsAndApply();
  setLoading(document.getElementById("createAccountBtn"), false);
};

document.getElementById("listAccountsBtn").onclick = async () => {
  const out = document.getElementById("accountsOut");
  setLoading(document.getElementById("listAccountsBtn"), true);
  if (cached.accounts) {
    show(out, { ok: true, data: cached.accounts });
    statAccounts.textContent = cached.accounts.length ?? "-";
    setLoading(document.getElementById("listAccountsBtn"), false);
    return;
  }
  const res = await fetchAccountsAndApply();
  show(out, res);
  if (res.ok) statAccounts.textContent = res.data.length ?? "-";
  setLoading(document.getElementById("listAccountsBtn"), false);
};

document.getElementById("proxyBtn").onclick = async () => {
  const out = document.getElementById("proxyOut");
  const body = {
    model: document.getElementById("proxyModel").value,
    messages: [{ role: "user", content: document.getElementById("proxyMessage").value }],
    async: document.getElementById("proxyAsync").checked
  };
  if (!body.model || !body.messages[0].content) {
    show(out, {
      ok: false,
      data: { error: "missing_fields", message: "Model and Message required." }
    });
    return;
  }
  setLoading(document.getElementById("proxyBtn"), true);
  const res = await request("POST", "/proxy/chat", body, true);
  show(out, res);
  setLoading(document.getElementById("proxyBtn"), false);
};

document.getElementById("jobBtn").onclick = async () => {
  const out = document.getElementById("jobOut");
  const id = document.getElementById("jobId").value;
  if (!id) {
    show(out, { ok: false, data: { error: "missing_job_id" } });
    return;
  }
  setLoading(document.getElementById("jobBtn"), true);
  const res = await request("GET", `/proxy/jobs/${id}`, null, true);
  show(out, res);
  setLoading(document.getElementById("jobBtn"), false);
};

if (getToken()) {
  updateStats();
  fetchProvidersAndApply();
  fetchAccountsAndApply();
}

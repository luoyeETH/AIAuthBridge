/**
 * Grok CPA (CLI Proxy API) → sub2api converter
 * Ported from grok_cpa2sub.py
 */

import type { ConvertResult, SkippedItem } from "./types";
import { firstNonEmpty, isPlainObject, parseJwtPayload } from "./convert";

export const SUB2API_DATA_TYPE = "sub2api-data";
export const SUB2API_DATA_VERSION = 1;
export const DEFAULT_PLATFORM = "grok";
export const DEFAULT_ACCOUNT_TYPE = "oauth";
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_PRIORITY = 50;
export const DEFAULT_RATE_MULTIPLIER = 1.0;
export const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const DEFAULT_SCOPE = "openid profile email offline_access grok-cli:access api:access";
export const DEFAULT_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;

const CPA_CREDENTIAL_KEYS: Record<string, string> = {
  access_token: "access_token",
  accessToken: "access_token",
  refresh_token: "refresh_token",
  refreshToken: "refresh_token",
  rt: "refresh_token",
  id_token: "id_token",
  idToken: "id_token",
  token_type: "token_type",
  email: "email",
  client_id: "client_id",
  scope: "scope",
  base_url: "base_url",
  subscription_tier: "subscription_tier",
  entitlement_status: "entitlement_status",
};

const CPA_KNOWN_TOP_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "token_type",
  "expires_in",
  "expired",
  "expires_at",
  "email",
  "sub",
  "subject",
  "client_id",
  "scope",
  "base_url",
  "redirect_uri",
  "token_endpoint",
  "auth_kind",
  "type",
  "name",
  "platform",
  "concurrency",
  "priority",
  "rate_multiplier",
  "notes",
  "credentials",
  "extra",
  "proxy_key",
  "auto_pause_on_expired",
  "exported_at",
  "proxies",
  "accounts",
  "version",
  "accessToken",
  "refreshToken",
  "idToken",
  "rt",
]);

export type GrokInputKind = "multi_accounts" | "flat_cpa" | "account_list" | "unknown";

export interface GrokCredentialHealth {
  usable: boolean;
  reason: string;
  has_access_token: boolean;
  has_refresh_token: boolean;
  expires_at?: string;
  seconds_left?: number | null;
  expired: boolean;
}

export interface GrokAccount {
  name: string;
  platform: string;
  type: string;
  credentials: Record<string, unknown>;
  concurrency: number;
  priority: number;
  rate_multiplier: number;
  auto_pause_on_expired: boolean;
  extra?: Record<string, unknown>;
  notes?: unknown;
  proxy_key?: unknown;
  expires_at?: number;
  _health?: GrokCredentialHealth;
  email?: string;
  sourceName?: string;
}

export interface GrokSub2apiDocument {
  type: typeof SUB2API_DATA_TYPE;
  version: typeof SUB2API_DATA_VERSION;
  exported_at: string;
  proxies: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
}

export function utcNowIso(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, (match) => match); // keep ms
}

export function parseTimeToRfc3339(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) {
      return undefined;
    }
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  if (typeof value === "string") {
    const s = value.trim();
    if (!s) {
      return undefined;
    }
    if (/^\d+(\.\d+)?$/.test(s)) {
      return parseTimeToRfc3339(Number(s));
    }
    const date = new Date(s);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  return undefined;
}

export function detectInputKind(data: unknown): GrokInputKind {
  if (Array.isArray(data)) {
    if (data.length && data.every((item) => isPlainObject(item))) {
      return "account_list";
    }
    return "unknown";
  }

  if (!isPlainObject(data)) {
    return "unknown";
  }

  if (Array.isArray(data.accounts)) {
    return "multi_accounts";
  }

  if (isPlainObject(data.credentials) && data.platform) {
    return "account_list";
  }

  if (data.access_token || data.refresh_token || data.accessToken || data.refreshToken) {
    return "flat_cpa";
  }

  const type = String(data.type ?? "").toLowerCase();
  if (type === "xai" || type === "grok") {
    return "flat_cpa";
  }

  return "unknown";
}

function deepFindToken(obj: unknown, keys: Set<string>, depth = 0): string | undefined {
  if (depth > 4 || obj === null || obj === undefined) {
    return undefined;
  }
  if (isPlainObject(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      if (keys.has(key) && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    for (const value of Object.values(obj)) {
      const found = deepFindToken(value, keys, depth + 1);
      if (found) {
        return found;
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindToken(item, keys, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

export function buildCredentialsFromFlat(cpa: Record<string, unknown>): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  for (const [src, dst] of Object.entries(CPA_CREDENTIAL_KEYS)) {
    const val = cpa[src];
    if (val !== undefined && val !== null && val !== "") {
      credentials[dst] = val;
    }
  }

  const expires = parseTimeToRfc3339(firstNonEmpty(cpa.expired, cpa.expires_at));
  if (expires) {
    credentials.expires_at = expires;
  }

  return credentials;
}

export function buildExtraFromFlat(cpa: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cpa)) {
    if (CPA_KNOWN_TOP_FIELDS.has(key)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    extra[key] = value;
  }

  for (const key of ["last_refresh", "redirect_uri", "token_endpoint", "sub", "subject", "expires_in"] as const) {
    const value = cpa[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (key === "subject") {
      if (extra.sub === undefined) {
        extra.sub = value;
      }
    } else if (extra[key] === undefined) {
      extra[key] = value;
    }
  }

  const cpaType = String(cpa.type ?? "").toLowerCase();
  if (cpaType && !["oauth", "api_key", "setup_token", "upstream"].includes(cpaType)) {
    if (extra.cpa_type === undefined) {
      extra.cpa_type = cpaType;
    }
  }

  return extra;
}

export function enrichGrokCredentials(
  credentials: Record<string, unknown>,
  raw: Record<string, unknown> = {},
): Record<string, unknown> {
  const creds = { ...credentials };

  if (!creds.refresh_token) {
    const rt = firstNonEmpty(
      raw.refresh_token,
      raw.refreshToken,
      raw.rt,
      deepFindToken(raw, new Set(["refresh_token", "refreshToken", "rt"])),
    );
    if (rt) {
      creds.refresh_token = rt;
    }
  }

  if (!creds.access_token) {
    const at = firstNonEmpty(
      raw.access_token,
      raw.accessToken,
      deepFindToken(raw, new Set(["access_token", "accessToken"])),
    );
    if (at) {
      creds.access_token = at;
    }
  }

  const accessToken = String(creds.access_token || "");
  const claims = parseJwtPayload(accessToken) || {};

  if (!creds.expires_at) {
    const expires = parseTimeToRfc3339(claims.exp);
    if (expires) {
      creds.expires_at = expires;
    }
  }

  if (!creds.client_id) {
    let clientId: unknown = firstNonEmpty(claims.client_id, claims.aud, DEFAULT_CLIENT_ID);
    if (Array.isArray(clientId) && clientId.length) {
      clientId = clientId[0];
    }
    if (clientId) {
      creds.client_id = String(clientId);
    }
  }

  if (!creds.scope) {
    const scope = firstNonEmpty(claims.scope, DEFAULT_SCOPE);
    if (scope) {
      creds.scope = String(scope);
    }
  }

  if (!creds.token_type) {
    creds.token_type = "Bearer";
  }

  if (!creds.base_url) {
    creds.base_url = DEFAULT_CLI_BASE_URL;
  }

  if (!creds.email && claims.email) {
    creds.email = claims.email;
  }

  return creds;
}

export function credentialHealth(credentials: Record<string, unknown>, now = new Date()): GrokCredentialHealth {
  const accessToken = String(credentials.access_token || "").trim();
  const refreshToken = String(credentials.refresh_token || "").trim();
  let expiresRfc = parseTimeToRfc3339(credentials.expires_at);

  if (!expiresRfc && accessToken) {
    const claims = parseJwtPayload(accessToken) || {};
    expiresRfc = parseTimeToRfc3339(claims.exp);
  }

  let expiresDt: Date | undefined;
  if (expiresRfc) {
    const parsed = new Date(expiresRfc);
    if (!Number.isNaN(parsed.getTime())) {
      expiresDt = parsed;
    }
  }

  const secondsLeft = expiresDt ? Math.trunc((expiresDt.getTime() - now.getTime()) / 1000) : null;
  const expired = expiresDt !== undefined && secondsLeft !== null && secondsLeft <= 0;
  const nearExpiry =
    expiresDt !== undefined &&
    secondsLeft !== null &&
    secondsLeft > 0 &&
    secondsLeft <= TOKEN_REFRESH_SKEW_SECONDS;
  const missingExpiry = expiresDt === undefined;

  let usable = true;
  let reason = "ok";
  if (!accessToken && !refreshToken) {
    usable = false;
    reason = "missing_access_and_refresh_token";
  } else if (!refreshToken && (expired || missingExpiry)) {
    usable = false;
    reason = "access_token_expired_or_unknown_and_refresh_token_missing";
  } else if (!refreshToken && nearExpiry) {
    usable = false;
    reason = "access_token_near_expiry_and_refresh_token_missing";
  } else if (!refreshToken) {
    reason = "no_refresh_token_but_access_token_still_valid";
  } else if (expired) {
    reason = "access_token_expired_but_has_refresh_token";
  }

  return {
    usable,
    reason,
    has_access_token: Boolean(accessToken),
    has_refresh_token: Boolean(refreshToken),
    expires_at: expiresRfc,
    seconds_left: secondsLeft,
    expired,
  };
}

export function extractName(
  data: Record<string, unknown>,
  options: { sourceName?: string; index?: number; nameSource?: "email" | "filename" | "name" | "index" } = {},
): string {
  const { sourceName, index = 1, nameSource = "email" } = options;
  const credentials = isPlainObject(data.credentials) ? data.credentials : {};
  const extra = isPlainObject(data.extra) ? data.extra : {};

  const email = firstNonEmpty(data.email, credentials.email, extra.email);
  const explicitName = firstNonEmpty(data.name, extra.name);

  if (nameSource === "filename" && sourceName) {
    return sourceName.replace(/\.[^.]+$/, "");
  }
  if (nameSource === "index") {
    return `grok-account-${index}`;
  }
  if (nameSource === "name" && explicitName) {
    return String(explicitName);
  }
  if (email) {
    return String(email);
  }
  if (explicitName) {
    return String(explicitName);
  }
  if (sourceName) {
    return sourceName.replace(/\.[^.]+$/, "");
  }
  return `grok-account-${index}`;
}

export function normalizeGrokAccount(
  raw: Record<string, unknown>,
  options: {
    sourceName?: string;
    index?: number;
    platform?: string;
    accountType?: string;
    concurrency?: number;
    priority?: number;
    nameSource?: "email" | "filename" | "name" | "index";
    forcePlatform?: boolean;
    requireUsable?: boolean;
    now?: Date;
  } = {},
): GrokAccount {
  const {
    sourceName,
    index = 1,
    platform = DEFAULT_PLATFORM,
    accountType = DEFAULT_ACCOUNT_TYPE,
    concurrency = DEFAULT_CONCURRENCY,
    priority = DEFAULT_PRIORITY,
    nameSource = "email",
    forcePlatform = false,
    requireUsable = true,
    now = new Date(),
  } = options;

  let credentials: Record<string, unknown>;
  let extra: Record<string, unknown>;

  if (isPlainObject(raw.credentials)) {
    credentials = { ...raw.credentials };
    extra = isPlainObject(raw.extra) ? { ...raw.extra } : {};
    const aliasMap: Record<string, string> = {
      refreshToken: "refresh_token",
      rt: "refresh_token",
      accessToken: "access_token",
      idToken: "id_token",
    };
    for (const key of ["access_token", "refresh_token", "refreshToken", "rt", "id_token", "email", "accessToken"]) {
      if (raw[key] === undefined || raw[key] === null || raw[key] === "") {
        continue;
      }
      const target = aliasMap[key] || key;
      if (!credentials[target]) {
        credentials[target] = raw[key];
      }
    }
  } else {
    credentials = buildCredentialsFromFlat(raw);
    extra = buildExtraFromFlat(raw);
  }

  credentials = enrichGrokCredentials(credentials, raw);
  const health = credentialHealth(credentials, now);

  const rawPlatform = String(raw.platform || "")
    .trim()
    .toLowerCase();
  const rawTypeHint = String(raw.type || "")
    .trim()
    .toLowerCase();
  let outPlatform: string;
  if (forcePlatform) {
    outPlatform = platform;
  } else if (rawPlatform === "grok" || rawPlatform === "xai") {
    outPlatform = "grok";
  } else if (rawTypeHint === "xai") {
    outPlatform = "grok";
  } else if (rawPlatform) {
    outPlatform = rawPlatform;
  } else {
    outPlatform = platform;
  }

  const rawAccType = String(raw.type || "")
    .trim()
    .toLowerCase();
  let outType: string;
  if (["oauth", "api_key", "setup_token", "upstream"].includes(rawAccType)) {
    outType = rawAccType;
  } else if (String(raw.auth_kind || "").trim().toLowerCase() === "oauth") {
    outType = "oauth";
  } else {
    outType = accountType;
  }

  const name = extractName(raw, { sourceName, index, nameSource });

  const concurrencyNum = Number(raw.concurrency ?? concurrency);
  const outConcurrency = Number.isFinite(concurrencyNum) ? concurrencyNum : concurrency;
  const priorityNum = Number(raw.priority ?? priority);
  const outPriority = Number.isFinite(priorityNum) ? priorityNum : priority;
  const rateNum = Number(raw.rate_multiplier ?? DEFAULT_RATE_MULTIPLIER);
  const rateMultiplier = Number.isFinite(rateNum) ? rateNum : DEFAULT_RATE_MULTIPLIER;
  const autoPause = typeof raw.auto_pause_on_expired === "boolean" ? raw.auto_pause_on_expired : true;

  const account: GrokAccount = {
    name,
    platform: outPlatform,
    type: outType,
    credentials,
    concurrency: outConcurrency,
    priority: outPriority,
    rate_multiplier: rateMultiplier,
    auto_pause_on_expired: autoPause,
    email: typeof credentials.email === "string" ? credentials.email : undefined,
    sourceName: sourceName || "pasted-json",
  };

  if (Object.keys(extra).length) {
    account.extra = extra;
  }
  if (raw.notes) {
    account.notes = raw.notes;
  }
  if (raw.proxy_key) {
    account.proxy_key = raw.proxy_key;
  }

  const expiresAt = raw.expires_at;
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    account.expires_at = Math.trunc(expiresAt);
  } else {
    const rfc = parseTimeToRfc3339(expiresAt);
    if (rfc) {
      const dt = new Date(rfc);
      if (!Number.isNaN(dt.getTime())) {
        account.expires_at = Math.trunc(dt.getTime() / 1000);
      }
    }
  }

  if (!credentials.access_token && !credentials.refresh_token) {
    throw new Error(`账户缺少 access_token/refresh_token: ${name}`);
  }

  if (requireUsable && !health.usable) {
    const exp = health.expires_at || "unknown";
    throw new Error(
      `账户无法被 sub2api 使用（${health.reason}）: ${name}; expires_at=${exp}; has_refresh_token=${health.has_refresh_token}`,
    );
  }

  account._health = health;
  return account;
}

export function collectGrokAccounts(
  data: unknown,
  options: {
    sourceName?: string;
    requireUsable?: boolean;
    startIndex?: number;
    now?: Date;
  } = {},
): { accounts: GrokAccount[]; proxies: Record<string, unknown>[]; skipped: SkippedItem[] } {
  const { sourceName = "pasted-json", requireUsable = true, startIndex = 1, now } = options;
  const accounts: GrokAccount[] = [];
  const proxies: Record<string, unknown>[] = [];
  const skipped: SkippedItem[] = [];
  const kind = detectInputKind(data);

  const tryNormalize = (item: Record<string, unknown>, index: number, label: string) => {
    try {
      accounts.push(
        normalizeGrokAccount(item, {
          sourceName,
          index,
          requireUsable,
          now,
        }),
      );
    } catch (error) {
      skipped.push({
        sourceName,
        path: label,
        reason: error instanceof Error ? error.message : "无法转换",
      });
    }
  };

  if (kind === "multi_accounts" && isPlainObject(data)) {
    const rawProxies = data.proxies;
    if (Array.isArray(rawProxies)) {
      for (const proxy of rawProxies) {
        if (isPlainObject(proxy)) {
          proxies.push(proxy);
        }
      }
    }
    const items = Array.isArray(data.accounts) ? data.accounts : [];
    items.forEach((item, i) => {
      if (!isPlainObject(item)) {
        skipped.push({ sourceName, path: `accounts[${i}]`, reason: "不是对象，已跳过" });
        return;
      }
      tryNormalize(item, startIndex + i, `accounts[${i}]`);
    });
    return { accounts, proxies, skipped };
  }

  if (kind === "account_list") {
    const items = Array.isArray(data) ? data : [data];
    items.forEach((item, i) => {
      if (!isPlainObject(item)) {
        skipped.push({ sourceName, path: `[${i}]`, reason: "不是对象，已跳过" });
        return;
      }
      tryNormalize(item, startIndex + i, `[${i}]`);
    });
    return { accounts, proxies, skipped };
  }

  if (kind === "flat_cpa" && isPlainObject(data)) {
    tryNormalize(data, startIndex, "$");
    return { accounts, proxies, skipped };
  }

  skipped.push({
    sourceName,
    path: "$",
    reason: "无法识别的 Grok JSON 结构（需要 CPA 扁平凭证、accounts 数组或账户列表）",
  });
  return { accounts, proxies, skipped };
}

export function buildGrokSub2apiDocument(
  accounts: GrokAccount[],
  proxies: Record<string, unknown>[] = [],
  now = new Date(),
): GrokSub2apiDocument {
  return {
    type: SUB2API_DATA_TYPE,
    version: SUB2API_DATA_VERSION,
    exported_at: now.toISOString(),
    proxies,
    accounts: accounts.map((account) => {
      const { _health: _h, email: _e, sourceName: _s, ...rest } = account;
      return rest as Record<string, unknown>;
    }),
  };
}

/**
 * Reverse: normalized Grok account → CPA flat credential (CLIProxyAPI xai-*.json style)
 */
export function accountToFlatCpa(account: GrokAccount): Record<string, unknown> {
  const creds = account.credentials || {};
  const extra = account.extra || {};

  const cpaType =
    typeof extra.cpa_type === "string" && extra.cpa_type
      ? String(extra.cpa_type)
      : account.platform === "xai"
        ? "xai"
        : "xai";

  const flat: Record<string, unknown> = {
    type: cpaType,
  };

  const name = account.name;
  if (name) {
    flat.name = name;
  }

  const email =
    (typeof creds.email === "string" && creds.email) ||
    account.email ||
    (typeof extra.email === "string" ? extra.email : undefined);
  if (email) {
    flat.email = email;
  }

  // credentials → top-level CPA fields
  const credentialMap: Array<[string, string]> = [
    ["access_token", "access_token"],
    ["refresh_token", "refresh_token"],
    ["id_token", "id_token"],
    ["token_type", "token_type"],
    ["client_id", "client_id"],
    ["scope", "scope"],
    ["base_url", "base_url"],
    ["subscription_tier", "subscription_tier"],
    ["entitlement_status", "entitlement_status"],
  ];

  for (const [src, dst] of credentialMap) {
    const value = creds[src];
    if (value !== undefined && value !== null && value !== "") {
      flat[dst] = value;
    }
  }

  // CPA commonly uses `expired` for RFC3339 expiry
  const expiresAt = creds.expires_at;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
    flat.expired = expiresAt;
    flat.expires_at = expiresAt;
  }

  if (!flat.token_type) {
    flat.token_type = "Bearer";
  }

  // useful extras that CPA files often carry at top level
  for (const key of ["last_refresh", "redirect_uri", "token_endpoint", "sub", "expires_in"] as const) {
    const fromExtra = extra[key];
    const fromCreds = creds[key];
    const value = fromExtra ?? fromCreds;
    if (value !== undefined && value !== null && value !== "") {
      flat[key] = value;
    }
  }

  // remaining extra (except already mapped)
  const skipExtra = new Set([
    "cpa_type",
    "email",
    "name",
    "last_refresh",
    "redirect_uri",
    "token_endpoint",
    "sub",
    "expires_in",
  ]);
  for (const [key, value] of Object.entries(extra)) {
    if (skipExtra.has(key)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (flat[key] === undefined) {
      flat[key] = value;
    }
  }

  if (account.notes !== undefined) {
    flat.notes = account.notes;
  }
  if (account.proxy_key !== undefined) {
    flat.proxy_key = account.proxy_key;
  }
  if (typeof account.concurrency === "number") {
    flat.concurrency = account.concurrency;
  }
  if (typeof account.priority === "number") {
    flat.priority = account.priority;
  }
  if (typeof account.rate_multiplier === "number") {
    flat.rate_multiplier = account.rate_multiplier;
  }

  return flat;
}

/** One account → object; multiple → array (CLIProxyAPI style batch) */
export function buildGrokCpaDocument(accounts: GrokAccount[]): Record<string, unknown> | Record<string, unknown>[] {
  const flats = accounts.map(accountToFlatCpa);
  return flats.length === 1 ? flats[0] : flats;
}

export function buildGrokOutputDocument(
  format: "sub2api" | "cpa",
  accounts: GrokAccount[],
  proxies: Record<string, unknown>[] = [],
  now = new Date(),
): unknown {
  if (format === "cpa") {
    return buildGrokCpaDocument(accounts);
  }
  return buildGrokSub2apiDocument(accounts, proxies, now);
}

export function convertGrokFromText(
  text: string,
  options: { requireUsable?: boolean; now?: Date } = {},
): ConvertResult & { proxies: Record<string, unknown>[]; grokAccounts: GrokAccount[] } {
  if (typeof text !== "string" || text.trim() === "") {
    return {
      converted: [],
      skipped: [],
      sources: [],
      proxies: [],
      grokAccounts: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`JSON 解析失败：${message}`);
  }

  const { accounts, proxies, skipped } = collectGrokAccounts(parsed, {
    sourceName: "pasted-json",
    requireUsable: options.requireUsable ?? true,
    now: options.now,
  });

  // Map to ConvertedAccount-like shape for shared UI table
  const converted = accounts.map((account) => ({
    sourceName: account.sourceName || "pasted-json",
    email: account.email || (typeof account.credentials.email === "string" ? account.credentials.email : undefined),
    name: account.name,
    expiresAt:
      typeof account.credentials.expires_at === "string"
        ? account.credentials.expires_at
        : account._health?.expires_at,
    // placeholders so shared type still works if referenced
    accessTokenExpiresAt: undefined,
    cpa: {},
    cockpit: {},
    nineRouter: {},
    codexAuthJson: {},
    axonHub: {},
    codexManager: {},
    sub2apiAccount: account as unknown as Record<string, unknown>,
  }));

  return {
    converted,
    skipped,
    sources: accounts.map((account, index) => ({
      value: account as unknown as Record<string, unknown>,
      sourceName: account.sourceName || "pasted-json",
      path: `$[${index}]`,
    })),
    proxies,
    grokAccounts: accounts,
  };
}

export async function convertGrokFromFiles(
  files: FileList | File[],
  options: { requireUsable?: boolean; now?: Date } = {},
): Promise<
  ConvertResult & {
    proxies: Record<string, unknown>[];
    grokAccounts: GrokAccount[];
    inputText: string;
  }
> {
  const list = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".json"));
  if (!list.length) {
    return {
      converted: [],
      skipped: [{ sourceName: "files", path: "$", reason: "没有选择 JSON 文件" }],
      sources: [],
      proxies: [],
      grokAccounts: [],
      inputText: "",
    };
  }

  const allAccounts: GrokAccount[] = [];
  const allProxies: Record<string, unknown>[] = [];
  const allSkipped: SkippedItem[] = [];
  const rawValues: Record<string, unknown>[] = [];
  let index = 1;

  for (const file of list) {
    const sourceName = file.webkitRelativePath || file.name;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      if (isPlainObject(parsed)) {
        rawValues.push(parsed);
      } else if (Array.isArray(parsed)) {
        rawValues.push(...parsed.filter(isPlainObject));
      }

      const { accounts, proxies, skipped } = collectGrokAccounts(parsed, {
        sourceName,
        requireUsable: options.requireUsable ?? true,
        startIndex: index,
        now: options.now,
      });
      allAccounts.push(...accounts);
      allProxies.push(...proxies);
      allSkipped.push(...skipped);
      index += Math.max(accounts.length, 1);
    } catch (error) {
      allSkipped.push({
        sourceName,
        path: "$",
        reason: error instanceof Error ? error.message : "无法读取文件",
      });
    }
  }

  const converted = allAccounts.map((account) => ({
    sourceName: account.sourceName || "pasted-json",
    email: account.email || (typeof account.credentials.email === "string" ? account.credentials.email : undefined),
    name: account.name,
    expiresAt:
      typeof account.credentials.expires_at === "string"
        ? account.credentials.expires_at
        : account._health?.expires_at,
    accessTokenExpiresAt: undefined,
    cpa: {},
    cockpit: {},
    nineRouter: {},
    codexAuthJson: {},
    axonHub: {},
    codexManager: {},
    sub2apiAccount: account as unknown as Record<string, unknown>,
  }));

  const inputText =
    rawValues.length === 1
      ? JSON.stringify(rawValues[0], null, 2)
      : JSON.stringify(rawValues, null, 2);

  return {
    converted,
    skipped: allSkipped,
    sources: allAccounts.map((account, i) => ({
      value: account as unknown as Record<string, unknown>,
      sourceName: account.sourceName || "pasted-json",
      path: `$[${i}]`,
    })),
    proxies: allProxies,
    grokAccounts: allAccounts,
    inputText,
  };
}

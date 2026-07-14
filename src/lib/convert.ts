import type {
  ConvertedAccount,
  ConvertResult,
  JsonValue,
  OutputFormat,
  SessionSource,
  SkippedItem,
} from "./types";

export const AXONHUB_PLACEHOLDER_REFRESH_TOKEN = "__missing_refresh_token__";

export const exampleSession = {
  user: {
    id: "user-example",
    email: "mark@example.com",
  },
  expires: "2026-08-06T14:29:36.155Z",
  account: {
    id: "00000000-0000-4000-9000-000000000000",
    planType: "plus",
  },
  accessToken: "paste-real-access-token-here",
  sessionToken: "paste-real-session-token-here",
  authProvider: "openai",
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeBase64UrlJson(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export function parseJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (typeof token !== "string" || token.trim() === "") {
    return undefined;
  }

  const segments = token.split(".");
  if (segments.length < 2) {
    return undefined;
  }

  try {
    return JSON.parse(decodeBase64Url(segments[1])) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function getOpenAIAuthSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isPlainObject(payload)) {
    return {};
  }

  const auth = payload["https://api.openai.com/auth"];
  return isPlainObject(auth) ? auth : {};
}

function getOpenAIProfileSection(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isPlainObject(payload)) {
    return {};
  }

  const profile = payload["https://api.openai.com/profile"];
  return isPlainObject(profile) ? profile : {};
}

export function normalizeTimestamp(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timestampFromUnixSeconds(value: unknown): string | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function unixSecondsFromJwtExp(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return Math.trunc(numeric);
}

function epochSecondsFromValue(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
}

export function buildSyntheticCodexIdToken(
  email: string | undefined,
  accountId: string | undefined,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined,
): string | undefined {
  if (!accountId) {
    return undefined;
  }

  const now = Math.trunc(Date.now() / 1000);
  const authInfo: Record<string, string> = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || now + 90 * 24 * 60 * 60;

  if (planType) {
    authInfo.chatgpt_plan_type = planType;
  }

  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }

  const payload: Record<string, unknown> = {
    iat: now,
    exp: expires,
    "https://api.openai.com/auth": authInfo,
  };

  if (email) {
    payload.email = email;
  }

  return `${encodeBase64UrlJson({ alg: "none", typ: "JWT", cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
}

function getExpiresIn(expiresAt: string | undefined, now = new Date()): number | undefined {
  if (!expiresAt) {
    return undefined;
  }

  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) {
    return undefined;
  }

  return Math.max(0, Math.floor((expiresMs - now.getTime()) / 1000));
}

function getAxonHubLastRefresh(expiresAt: string | undefined, now = new Date()): string | undefined {
  const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
  if (Number.isNaN(expiresMs)) {
    return normalizeTimestamp(now);
  }

  return new Date(expiresMs - 60 * 60 * 1000).toISOString();
}

function stripUnavailable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnavailable).filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, stripUnavailable(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value;
}

function toEmailKey(email: string | undefined): string | undefined {
  if (typeof email !== "string") {
    return undefined;
  }

  return email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sanitizeFileToken(value: string | undefined, fallback = "chatgpt-session"): string {
  const base = firstNonEmpty(value, fallback) || fallback;
  return (
    base
      .replace(/\.[^.]+$/u, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80) || fallback
  );
}

export function getTimestampToken(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
    "_" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("-")
  );
}

export function formatDisplayDate(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function nestedString(record: Record<string, unknown>, ...path: string[]): string | undefined {
  let current: unknown = record;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

export function collectSessionLikeObjects(
  value: unknown,
  sourceName = "pasted-json",
): SessionSource[] {
  const found: SessionSource[] = [];
  const visited = new WeakSet<object>();

  function visit(item: unknown, path: string) {
    if (!isPlainObject(item) && !Array.isArray(item)) {
      return;
    }

    if (isPlainObject(item)) {
      if (visited.has(item)) {
        return;
      }
      visited.add(item);

      const token = firstNonEmpty(
        item.accessToken,
        item.access_token,
        nestedString(item, "tokens", "accessToken"),
        nestedString(item, "tokens", "access_token"),
        nestedString(item, "token", "accessToken"),
        nestedString(item, "token", "access_token"),
        nestedString(item, "credentials", "accessToken"),
        nestedString(item, "credentials", "access_token"),
      );
      const hasIdentity =
        isPlainObject(item.user) ||
        firstNonEmpty(
          item.email,
          item.name,
          item.label,
          nestedString(item, "meta", "label"),
          nestedString(item, "tokens", "accountId"),
          nestedString(item, "tokens", "account_id"),
          nestedString(item, "tokens", "chatgptAccountId"),
          nestedString(item, "tokens", "chatgpt_account_id"),
          nestedString(item, "providerSpecificData", "chatgptAccountId"),
          nestedString(item, "providerSpecificData", "chatgpt_account_id"),
          item.id,
        );
      if (token && hasIdentity) {
        found.push({ value: item, sourceName, path });
        return;
      }

      for (const [key, child] of Object.entries(item)) {
        if (key === "accessToken" || key === "access_token" || key === "sessionToken") {
          continue;
        }
        visit(child, `${path}.${key}`);
      }
      return;
    }

    item.forEach((child, index) => visit(child, `${path}[${index}]`));
  }

  visit(value, "$");
  return found;
}

export function parseInputDocuments(text: string): SessionSource[] {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`JSON 解析失败：${message}`);
  }

  return collectSessionLikeObjects(parsed);
}

export function convertSession(
  record: Record<string, unknown>,
  options: { now?: Date; sourceName?: string; sourcePath?: string } = {},
): ConvertedAccount {
  if (!isPlainObject(record)) {
    throw new Error("session 不是 JSON 对象");
  }

  const accessToken = firstNonEmpty(
    record.accessToken,
    record.access_token,
    nestedString(record, "tokens", "accessToken"),
    nestedString(record, "tokens", "access_token"),
    nestedString(record, "token", "accessToken"),
    nestedString(record, "token", "access_token"),
    nestedString(record, "credentials", "accessToken"),
    nestedString(record, "credentials", "access_token"),
  );
  if (!accessToken) {
    throw new Error("缺少 accessToken");
  }

  const sessionToken = firstNonEmpty(
    record.sessionToken,
    record.session_token,
    nestedString(record, "tokens", "sessionToken"),
    nestedString(record, "tokens", "session_token"),
    nestedString(record, "token", "sessionToken"),
    nestedString(record, "token", "session_token"),
    nestedString(record, "credentials", "session_token"),
  );
  const refreshToken = firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    nestedString(record, "tokens", "refreshToken"),
    nestedString(record, "tokens", "refresh_token"),
    nestedString(record, "token", "refreshToken"),
    nestedString(record, "token", "refresh_token"),
    nestedString(record, "credentials", "refresh_token"),
  );
  const inputIdToken = firstNonEmpty(
    record.idToken,
    record.id_token,
    nestedString(record, "tokens", "idToken"),
    nestedString(record, "tokens", "id_token"),
    nestedString(record, "token", "idToken"),
    nestedString(record, "token", "id_token"),
    nestedString(record, "credentials", "id_token"),
  );

  const payload = parseJwtPayload(accessToken);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const hasRefreshToken = Boolean(refreshToken);
  const accessTokenExpiresAt = hasRefreshToken ? undefined : unixSecondsFromJwtExp(payload?.exp);
  const expiresAt = hasRefreshToken
    ? undefined
    : firstNonEmpty(
        payload ? timestampFromUnixSeconds(payload.exp) : undefined,
        normalizeTimestamp(record.expires),
        normalizeTimestamp(record.expiresAt),
        normalizeTimestamp(record.expired),
        normalizeTimestamp(record.expires_at),
      );

  const email = firstNonEmpty(
    nestedString(record, "user", "email"),
    record.email,
    nestedString(record, "meta", "label"),
    record.label,
    nestedString(record, "credentials", "email"),
    nestedString(record, "providerSpecificData", "email"),
    profile.email,
    idPayload?.email,
    payload?.email,
  );
  const accountId = firstNonEmpty(
    nestedString(record, "account", "id"),
    record.account_id,
    nestedString(record, "tokens", "accountId"),
    nestedString(record, "tokens", "account_id"),
    record.chatgptAccountId,
    record.chatgpt_account_id,
    nestedString(record, "meta", "chatgptAccountId"),
    nestedString(record, "meta", "chatgpt_account_id"),
    nestedString(record, "tokens", "chatgptAccountId"),
    nestedString(record, "tokens", "chatgpt_account_id"),
    nestedString(record, "providerSpecificData", "chatgptAccountId"),
    nestedString(record, "providerSpecificData", "chatgpt_account_id"),
    nestedString(record, "credentials", "chatgpt_account_id"),
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === "codex" ? record.id : undefined,
  );
  const chatgptAccountId = firstNonEmpty(
    record.chatgptAccountId,
    record.chatgpt_account_id,
    nestedString(record, "meta", "chatgptAccountId"),
    nestedString(record, "meta", "chatgpt_account_id"),
    nestedString(record, "tokens", "chatgptAccountId"),
    nestedString(record, "tokens", "chatgpt_account_id"),
    nestedString(record, "providerSpecificData", "chatgptAccountId"),
    nestedString(record, "providerSpecificData", "chatgpt_account_id"),
    nestedString(record, "credentials", "chatgpt_account_id"),
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
  );
  const workspaceId = firstNonEmpty(
    nestedString(record, "account", "workspaceId"),
    nestedString(record, "account", "workspace_id"),
    record.workspaceId,
    record.workspace_id,
    nestedString(record, "meta", "workspaceId"),
    nestedString(record, "meta", "workspace_id"),
    nestedString(record, "providerSpecificData", "workspaceId"),
    nestedString(record, "providerSpecificData", "workspace_id"),
    nestedString(record, "credentials", "workspace_id"),
    payload?.workspace_id,
    idPayload?.workspace_id,
  );
  const userId = firstNonEmpty(
    nestedString(record, "user", "id"),
    record.user_id,
    record.chatgptUserId,
    nestedString(record, "providerSpecificData", "chatgptUserId"),
    nestedString(record, "providerSpecificData", "chatgpt_user_id"),
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id,
  );
  const planType = firstNonEmpty(
    nestedString(record, "account", "planType"),
    nestedString(record, "account", "plan_type"),
    record.planType,
    record.plan_type,
    nestedString(record, "providerSpecificData", "chatgptPlanType"),
    nestedString(record, "providerSpecificData", "chatgpt_plan_type"),
    nestedString(record, "credentials", "plan_type"),
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type,
  );

  const exportedAt = normalizeTimestamp(options.now || new Date());
  const expiresIn = getExpiresIn(expiresAt, options.now || new Date());
  const sourceName = firstNonEmpty(options.sourceName, "pasted-json") || "pasted-json";
  const sourceType =
    record.provider === "codex" && record.authType === "oauth" ? "9router" : "chatgpt_web_session";
  const name = firstNonEmpty(email, sourceName, "ChatGPT Account") || "ChatGPT Account";
  const syntheticIdToken = !inputIdToken
    ? buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt)
    : undefined;
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);

  const cpa = Object.fromEntries(
    Object.entries({
      type: "codex",
      account_id: accountId,
      chatgpt_account_id: accountId,
      email,
      name,
      plan_type: planType,
      chatgpt_plan_type: planType,
      id_token: idToken,
      id_token_synthetic: Boolean(syntheticIdToken) || undefined,
      access_token: accessToken,
      refresh_token: refreshToken || "",
      session_token: sessionToken,
      last_refresh: exportedAt,
      expired: expiresAt,
      disabled: Boolean(record.disabled) || undefined,
    }).filter(([, value]) => value !== undefined && value !== null),
  );

  const cockpit = {
    type: "codex",
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken || "",
    account_id: accountId,
    last_refresh: exportedAt,
    email,
    expired: expiresAt,
    account_note: firstNonEmpty(
      record.account_note,
      record.accountInfo,
      record.account_info,
      record.note,
      record.notes,
      record.remark,
    ),
  };

  const sub2apiAccount = stripUnavailable({
    name: firstNonEmpty(name, email, sourceName, "ChatGPT Account"),
    platform: "openai",
    type: "oauth",
    expires_at: accessTokenExpiresAt,
    auto_pause_on_expired: accessTokenExpiresAt ? true : undefined,
    concurrency: 10,
    priority: 1,
    credentials: {
      access_token: accessToken,
      chatgpt_account_id: accountId,
      chatgpt_user_id: userId,
      email,
      expires_at: expiresAt,
      expires_in: expiresIn,
      plan_type: planType,
    },
    extra: {
      email,
      email_key: toEmailKey(email),
      name,
      auth_provider: firstNonEmpty(record.authProvider, record.auth_provider),
      source: sourceType,
      last_refresh: exportedAt,
    },
  }) as Record<string, unknown>;

  const priority = Number.isFinite(Number(record.priority)) ? Number(record.priority) : 9;
  const isActive = typeof record.isActive === "boolean" ? record.isActive : !Boolean(record.disabled);
  const createdAt = normalizeTimestamp(record.createdAt) || exportedAt;
  const updatedAt = normalizeTimestamp(record.updatedAt) || exportedAt;

  const nineRouter = stripUnavailable({
    accessToken,
    refreshToken,
    expiresAt,
    testStatus: firstNonEmpty(record.testStatus, record.test_status, "active"),
    expiresIn,
    providerSpecificData: {
      chatgptAccountId: accountId,
      chatgptPlanType: planType,
    },
    id: accountId,
    provider: "codex",
    authType: "oauth",
    name,
    email,
    priority,
    isActive,
    createdAt,
    updatedAt,
  }) as Record<string, unknown>;

  const axonHubRefreshToken = refreshToken || AXONHUB_PLACEHOLDER_REFRESH_TOKEN;
  const codexAuthJson = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken || "",
      account_id: accountId,
    },
    last_refresh: exportedAt,
  };

  const axonHub = stripUnavailable({
    auth_mode: "chatgpt",
    last_refresh: getAxonHubLastRefresh(expiresAt, options.now || new Date()),
    tokens: {
      access_token: accessToken,
      refresh_token: axonHubRefreshToken,
      id_token: idToken,
    },
    axonhub_refresh_token_placeholder: refreshToken ? undefined : true,
    axonhub_note: refreshToken
      ? undefined
      : "refresh_token is a placeholder; access_token works only until it expires.",
  }) as Record<string, unknown>;

  const codexManagerTokenHints = Object.fromEntries(
    Object.entries({
      account_id: accountId,
      chatgpt_account_id: chatgptAccountId,
    }).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

  const codexManagerMeta = Object.fromEntries(
    Object.entries({
      label: firstNonEmpty(name, email, sourceName, "ChatGPT Account"),
      workspace_id: workspaceId,
      chatgpt_account_id: chatgptAccountId,
      note: "Imported from ChatGPT session",
    }).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );

  const codexManager = {
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken || "",
      id_token: inputIdToken || "",
      ...codexManagerTokenHints,
    },
    meta: codexManagerMeta,
  };

  return {
    sourceName,
    sourcePath: options.sourcePath,
    email,
    name,
    expiresAt,
    accessTokenExpiresAt,
    cpa,
    cockpit,
    nineRouter,
    codexAuthJson,
    axonHub,
    codexManager,
    sub2apiAccount,
  };
}

export function buildSub2apiDocument(converted: ConvertedAccount[], now = new Date()) {
  return {
    exported_at: normalizeTimestamp(now),
    proxies: [] as unknown[],
    accounts: converted.map((item) => item.sub2apiAccount),
  };
}

export function buildOutputDocument(format: OutputFormat, converted: ConvertedAccount[], now = new Date()) {
  if (format === "sub2api") {
    return buildSub2apiDocument(converted, now);
  }

  if (format === "cpa") {
    return converted.length === 1 ? converted[0].cpa : converted.map((item) => item.cpa);
  }

  if (format === "cockpit") {
    return converted.length === 1 ? converted[0].cockpit : converted.map((item) => item.cockpit);
  }

  if (format === "9router") {
    return converted.length === 1 ? converted[0].nineRouter : converted.map((item) => item.nineRouter);
  }

  if (format === "codex") {
    return converted.length === 1
      ? converted[0].codexAuthJson
      : converted.map((item) => item.codexAuthJson);
  }

  if (format === "axonhub") {
    return converted.length === 1 ? converted[0].axonHub : converted.map((item) => item.axonHub);
  }

  if (format === "codexmanager") {
    return converted.length === 1
      ? converted[0].codexManager
      : converted.map((item) => item.codexManager);
  }

  return buildSub2apiDocument(converted, now);
}

export function convertFromText(text: string, now = new Date()): ConvertResult {
  const sources = parseInputDocuments(text);
  const converted: ConvertedAccount[] = [];
  const skipped: SkippedItem[] = [];

  sources.forEach((item, index) => {
    try {
      converted.push(
        convertSession(item.value, {
          now,
          sourceName: item.sourceName,
          sourcePath: item.path || `$[${index}]`,
        }),
      );
    } catch (error) {
      skipped.push({
        sourceName: item.sourceName,
        path: item.path,
        reason: error instanceof Error ? error.message : "无法转换",
      });
    }
  });

  if (!sources.length) {
    skipped.push({
      sourceName: "pasted-json",
      path: "$",
      reason: "未找到包含 accessToken 和 user/email 的 session 对象",
    });
  }

  return { converted, skipped, sources };
}

export async function convertFromFiles(files: FileList | File[]): Promise<ConvertResult & { inputText: string }> {
  const list = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".json"));
  if (!list.length) {
    return {
      converted: [],
      skipped: [{ sourceName: "files", path: "$", reason: "没有选择 JSON 文件" }],
      sources: [],
      inputText: "",
    };
  }

  const documents: SessionSource[] = [];
  const skipped: SkippedItem[] = [];

  for (const file of list) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const found = collectSessionLikeObjects(parsed, file.webkitRelativePath || file.name);
      if (!found.length) {
        skipped.push({
          sourceName: file.webkitRelativePath || file.name,
          path: "$",
          reason: "未找到包含 accessToken 和 user/email 的 session 对象",
        });
      }
      documents.push(...found);
    } catch (error) {
      skipped.push({
        sourceName: file.webkitRelativePath || file.name,
        path: "$",
        reason: error instanceof Error ? error.message : "无法读取文件",
      });
    }
  }

  const now = new Date();
  const converted: ConvertedAccount[] = [];
  const convertSkipped = [...skipped];

  documents.forEach((item) => {
    try {
      converted.push(
        convertSession(item.value, {
          now,
          sourceName: item.sourceName,
          sourcePath: item.path,
        }),
      );
    } catch (error) {
      convertSkipped.push({
        sourceName: item.sourceName,
        path: item.path,
        reason: error instanceof Error ? error.message : "无法转换",
      });
    }
  });

  const inputText =
    documents.length === 1
      ? JSON.stringify(documents[0].value, null, 2)
      : JSON.stringify(
          documents.map((item) => item.value),
          null,
          2,
        );

  return {
    converted,
    skipped: convertSkipped,
    sources: documents,
    inputText,
  };
}

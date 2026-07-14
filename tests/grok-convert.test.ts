import { describe, expect, it } from "vitest";
import {
  accountToFlatCpa,
  buildGrokCpaDocument,
  buildGrokOutputDocument,
  buildGrokSub2apiDocument,
  convertGrokFromText,
  detectInputKind,
  enrichGrokCredentials,
  normalizeGrokAccount,
  parseTimeToRfc3339,
} from "../src/lib/grokConvert";

function jwtWithPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

describe("grok convert helpers", () => {
  it("detects flat cpa, multi accounts and account list", () => {
    expect(detectInputKind({ type: "xai", access_token: "a", refresh_token: "r" })).toBe("flat_cpa");
    expect(detectInputKind({ accounts: [{ access_token: "a" }] })).toBe("multi_accounts");
    expect(detectInputKind([{ platform: "grok", credentials: { access_token: "a" } }])).toBe("account_list");
  });

  it("parses unix and iso times", () => {
    expect(parseTimeToRfc3339(1700000000)).toBe("2023-11-14T22:13:20Z");
    expect(parseTimeToRfc3339("2027-01-15T00:00:00Z")).toBe("2027-01-15T00:00:00Z");
  });

  it("enriches missing client_id scope and base_url from jwt", () => {
    const access = jwtWithPayload({
      email: "a@x.com",
      exp: 1800000000,
      client_id: "cid-from-jwt",
      scope: "openid",
    });
    const creds = enrichGrokCredentials({ access_token: access, refresh_token: "rt" });
    expect(creds.client_id).toBe("cid-from-jwt");
    expect(creds.scope).toBe("openid");
    expect(creds.base_url).toBe("https://cli-chat-proxy.grok.com/v1");
    expect(creds.token_type).toBe("Bearer");
    expect(creds.email).toBe("a@x.com");
    expect(creds.expires_at).toBe("2027-01-15T08:00:00Z");
  });
});

describe("grok normalize + document", () => {
  it("converts flat cpa to sub2api-data document", () => {
    const access = jwtWithPayload({
      email: "grok@example.com",
      exp: 1800000000,
    });
    const { grokAccounts, skipped } = convertGrokFromText(
      JSON.stringify({
        type: "xai",
        email: "grok@example.com",
        access_token: access,
        refresh_token: "real-refresh",
      }),
      { requireUsable: true },
    );

    expect(skipped).toHaveLength(0);
    expect(grokAccounts).toHaveLength(1);
    expect(grokAccounts[0].platform).toBe("grok");
    expect(grokAccounts[0].type).toBe("oauth");
    expect(grokAccounts[0].credentials.refresh_token).toBe("real-refresh");

    const doc = buildGrokSub2apiDocument(grokAccounts);
    expect(doc.type).toBe("sub2api-data");
    expect(doc.version).toBe(1);
    expect(doc.accounts).toHaveLength(1);
    expect((doc.accounts[0] as { platform: string }).platform).toBe("grok");
    expect(doc.accounts[0]).not.toHaveProperty("_health");
  });

  it("skips expired access token without refresh_token when requireUsable", () => {
    const access = jwtWithPayload({
      email: "old@example.com",
      exp: 1000000000,
    });
    const { grokAccounts, skipped } = convertGrokFromText(
      JSON.stringify({
        type: "xai",
        access_token: access,
      }),
      { requireUsable: true },
    );

    expect(grokAccounts).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0].reason).toMatch(/refresh_token/);
  });

  it("normalizes nested credentials account", () => {
    const account = normalizeGrokAccount(
      {
        name: "nested",
        platform: "xai",
        credentials: {
          access_token: jwtWithPayload({ exp: 1800000000, email: "n@x.com" }),
          refresh_token: "rt",
        },
      },
      { requireUsable: true },
    );
    expect(account.platform).toBe("grok");
    expect(account.credentials.email).toBe("n@x.com");
  });

  it("reverses sub2api account back to flat CPA", () => {
    const access = jwtWithPayload({
      email: "round@example.com",
      exp: 1800000000,
    });
    const { grokAccounts } = convertGrokFromText(
      JSON.stringify({
        type: "sub2api-data",
        version: 1,
        accounts: [
          {
            name: "round@example.com",
            platform: "grok",
            type: "oauth",
            credentials: {
              access_token: access,
              refresh_token: "rt-1",
              email: "round@example.com",
              expires_at: "2027-01-15T08:00:00Z",
              client_id: "cid",
              scope: "openid",
              base_url: "https://cli-chat-proxy.grok.com/v1",
            },
          },
        ],
      }),
      { requireUsable: true },
    );

    expect(grokAccounts).toHaveLength(1);
    const flat = accountToFlatCpa(grokAccounts[0]);
    expect(flat.type).toBe("xai");
    expect(flat.access_token).toBe(access);
    expect(flat.refresh_token).toBe("rt-1");
    expect(flat.email).toBe("round@example.com");
    expect(flat.expired).toBe("2027-01-15T08:00:00Z");
    expect(flat.client_id).toBe("cid");

    const cpaDoc = buildGrokCpaDocument(grokAccounts);
    expect(cpaDoc).toEqual(flat);

    // round-trip: CPA → sub2api → CPA still has tokens
    const again = convertGrokFromText(JSON.stringify(flat), { requireUsable: true });
    expect(again.grokAccounts[0].credentials.refresh_token).toBe("rt-1");
    expect(buildGrokOutputDocument("cpa", again.grokAccounts)).toMatchObject({
      type: "xai",
      refresh_token: "rt-1",
    });
  });
});

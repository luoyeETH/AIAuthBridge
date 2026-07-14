import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  AXONHUB_PLACEHOLDER_REFRESH_TOKEN,
  buildOutputDocument,
  convertFromText,
  convertSession,
} from "../src/lib/convert";

function jwtWithPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig",
  ].join(".");
}

describe("sub2api conversion", () => {
  it("uses access token exp as account expires_at", () => {
    const { converted } = convertFromText(
      JSON.stringify({
        user: { email: "mark@example.com" },
        accessToken: jwtWithPayload({
          exp: 1780473960,
          "https://api.openai.com/auth": {
            chatgpt_account_id: "chatgpt-account-1",
          },
        }),
      }),
    );

    const document = buildOutputDocument("sub2api", converted) as {
      expires_at?: unknown;
      auto_pause_on_expired?: unknown;
      accounts: Array<Record<string, unknown>>;
    };
    const account = document.accounts[0];

    expect(document.expires_at).toBeUndefined();
    expect(document.auto_pause_on_expired).toBeUndefined();
    expect(document.accounts).toHaveLength(1);
    expect(account.expires_at).toBe(1780473960);
    expect(account.auto_pause_on_expired).toBe(true);
  });

  it("keeps per-account access token expiry", () => {
    const { converted } = convertFromText(
      JSON.stringify([
        {
          email: "late@example.com",
          accessToken: jwtWithPayload({
            exp: 1780473960,
            "https://api.openai.com/auth": {
              chatgpt_account_id: "chatgpt-account-late",
            },
          }),
        },
        {
          email: "early@example.com",
          accessToken: jwtWithPayload({
            exp: 1780000000,
            "https://api.openai.com/auth": {
              chatgpt_account_id: "chatgpt-account-early",
            },
          }),
        },
      ]),
    );

    const document = buildOutputDocument("sub2api", converted) as {
      accounts: Array<Record<string, unknown>>;
    };

    expect(document.accounts).toHaveLength(2);
    expect(document.accounts[0].expires_at).toBe(1780473960);
    expect(document.accounts[0].auto_pause_on_expired).toBe(true);
    expect(document.accounts[1].expires_at).toBe(1780000000);
    expect(document.accounts[1].auto_pause_on_expired).toBe(true);
  });

  it("omits access token expiry when refresh token exists", () => {
    const { converted } = convertFromText(
      JSON.stringify({
        user: { email: "refreshable@example.com" },
        accessToken: jwtWithPayload({
          exp: 1780473960,
          "https://api.openai.com/auth": {
            chatgpt_account_id: "chatgpt-account-refreshable",
          },
        }),
        refreshToken: "real-refresh-token",
        expiresAt: "2026-06-01T00:00:00.000Z",
      }),
    );

    const account = converted[0].sub2apiAccount as {
      expires_at?: unknown;
      auto_pause_on_expired?: unknown;
      credentials?: { expires_at?: unknown; expires_in?: unknown };
    };

    expect(account.expires_at).toBeUndefined();
    expect(account.auto_pause_on_expired).toBeUndefined();
    expect(account.credentials?.expires_at).toBeUndefined();
    expect(account.credentials?.expires_in).toBeUndefined();
  });
});

describe("codex-related formats", () => {
  it("builds synthetic id_token in JWT format for CPA", () => {
    const account = convertSession({
      user: {
        id: "user-test",
        email: "mark@example.com",
      },
      expires: "2026-08-06T14:29:36.155Z",
      account: {
        id: "00000000-0000-4000-9000-000000000000",
        planType: "plus",
      },
      accessToken: "access-token",
      sessionToken: "session-token",
    });

    const cpa = account.cpa as { id_token: string; id_token_synthetic?: boolean };
    const parts = cpa.id_token.split(".");

    expect(cpa.id_token_synthetic).toBe(true);
    expect(parts).toHaveLength(3);
    expect(parts.every((part) => part.length > 0)).toBe(true);

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      email?: string;
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    expect(payload.email).toBe("mark@example.com");
    expect(payload["https://api.openai.com/auth"]?.chatgpt_account_id).toBe(
      "00000000-0000-4000-9000-000000000000",
    );
  });

  it("uses placeholder refresh token for AxonHub when missing", () => {
    const account = convertSession(
      {
        user: {
          id: "user-test",
          email: "mark@example.com",
        },
        expires: "2026-08-06T14:29:36.155Z",
        account: {
          id: "00000000-0000-4000-9000-000000000000",
          planType: "plus",
        },
        accessToken: "access-token",
        sessionToken: "session-token",
      },
      { now: new Date("2026-01-01T00:00:00.000Z") },
    );

    const authJson = account.axonHub as {
      auth_mode: string;
      tokens: { access_token: string; refresh_token: string; id_token: string };
      last_refresh: string;
      axonhub_refresh_token_placeholder?: boolean;
      axonhub_note?: string;
    };

    expect(authJson.auth_mode).toBe("chatgpt");
    expect(authJson.tokens.access_token).toBe("access-token");
    expect(authJson.tokens.refresh_token).toBe(AXONHUB_PLACEHOLDER_REFRESH_TOKEN);
    expect(authJson.tokens.id_token.split(".")).toHaveLength(3);
    expect(authJson.last_refresh).toBe("2026-08-06T13:29:36.155Z");
    expect(authJson.axonhub_refresh_token_placeholder).toBe(true);
    expect(authJson.axonhub_note).toBe(
      "refresh_token is a placeholder; access_token works only until it expires.",
    );
  });

  it("preserves real refresh token for AxonHub", () => {
    const account = convertSession({
      user: { email: "mark@example.com" },
      expires: "2026-08-06T14:29:36.155Z",
      account: {
        id: "00000000-0000-4000-9000-000000000000",
        planType: "plus",
      },
      accessToken: "access-token",
      refreshToken: "real-refresh-token",
      idToken: "real.header.signature",
    });

    const authJson = account.axonHub as {
      tokens: { refresh_token: string; id_token: string };
      axonhub_refresh_token_placeholder?: boolean;
      axonhub_note?: string;
    };

    expect(authJson.tokens.refresh_token).toBe("real-refresh-token");
    expect(authJson.tokens.id_token).toBe("real.header.signature");
    expect(authJson.axonhub_refresh_token_placeholder).toBeUndefined();
    expect(authJson.axonhub_note).toBeUndefined();
  });

  it("matches native Codex auth.json shape when refresh token is missing", () => {
    const account = convertSession({
      user: {
        id: "user-test",
        email: "mark@example.com",
      },
      expires: "2026-08-06T14:29:36.155Z",
      account: {
        id: "00000000-0000-4000-9000-000000000000",
        planType: "plus",
      },
      accessToken: "access-token",
      sessionToken: "session-token",
    });

    const authJson = account.codexAuthJson as {
      auth_mode: string;
      OPENAI_API_KEY: null;
      tokens: {
        access_token: string;
        refresh_token: string;
        id_token: string;
        account_id: string;
      };
      last_refresh: string;
    };

    expect(authJson.auth_mode).toBe("chatgpt");
    expect(authJson.OPENAI_API_KEY).toBeNull();
    expect(authJson.tokens.access_token).toBe("access-token");
    expect(authJson.tokens.refresh_token).toBe("");
    expect(authJson.tokens.id_token.split(".")).toHaveLength(3);
    expect(authJson.tokens.account_id).toBe("00000000-0000-4000-9000-000000000000");
    expect(authJson.last_refresh).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves real refresh and id tokens for Codex", () => {
    const account = convertSession({
      user: { email: "mark@example.com" },
      accessToken: "access-token",
      refreshToken: "real-refresh-token",
      idToken: "real.header.signature",
      tokens: {
        account_id: "chatgpt-account-1",
      },
    });

    const authJson = account.codexAuthJson as {
      tokens: {
        access_token: string;
        refresh_token: string;
        id_token: string;
        account_id: string;
      };
    };

    expect(authJson.tokens.access_token).toBe("access-token");
    expect(authJson.tokens.refresh_token).toBe("real-refresh-token");
    expect(authJson.tokens.id_token).toBe("real.header.signature");
    expect(authJson.tokens.account_id).toBe("chatgpt-account-1");
  });

  it("uses empty refresh token for Codex-Manager when missing", () => {
    const account = convertSession({
      user: {
        id: "user-test",
        email: "mark@example.com",
      },
      expires: "2026-08-06T14:29:36.155Z",
      account: {
        id: "00000000-0000-4000-9000-000000000000",
        planType: "plus",
      },
      accessToken: "access-token",
      sessionToken: "session-token",
    });

    const authJson = account.codexManager as {
      tokens: {
        access_token: string;
        refresh_token: string;
        id_token: string;
        account_id?: string;
      };
      meta: { label?: string; note?: string };
    };

    expect(authJson.tokens.access_token).toBe("access-token");
    expect(authJson.tokens.refresh_token).toBe("");
    expect(authJson.tokens.id_token).toBe("");
    expect(authJson.tokens.account_id).toBe("00000000-0000-4000-9000-000000000000");
    expect(authJson.meta.label).toBe("mark@example.com");
    expect(authJson.meta.note).toBe("Imported from ChatGPT session");
  });

  it("preserves real refresh token and metadata for Codex-Manager", () => {
    const account = convertSession({
      user: { email: "mark@example.com" },
      accessToken: "access-token",
      refreshToken: "real-refresh-token",
      idToken: "real.header.signature",
      workspaceId: "workspace-1",
      chatgptAccountId: "chatgpt-account-1",
    });

    const authJson = account.codexManager as {
      tokens: {
        refresh_token: string;
        id_token: string;
        chatgpt_account_id?: string;
      };
      meta: {
        workspace_id?: string;
        chatgpt_account_id?: string;
      };
    };

    expect(authJson.tokens.refresh_token).toBe("real-refresh-token");
    expect(authJson.tokens.id_token).toBe("real.header.signature");
    expect(authJson.tokens.chatgpt_account_id).toBe("chatgpt-account-1");
    expect(authJson.meta.workspace_id).toBe("workspace-1");
    expect(authJson.meta.chatgpt_account_id).toBe("chatgpt-account-1");
  });
});

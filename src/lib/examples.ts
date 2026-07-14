import { exampleSession } from "./convert";

/** Codex category sample (ChatGPT web session shape) */
export const codexExample = exampleSession;

/** Grok CPA flat credential sample (CLIProxyAPI xai-*.json style) */
export const grokExample = {
  type: "xai",
  email: "grok-user@example.com",
  name: "grok-user@example.com",
  access_token:
    "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Imdyb2stdXNlckBleGFtcGxlLmNvbSIsImV4cCI6MTgwMDAwMDAwMCwiY2xpZW50X2lkIjoiYjFhMDA0OTItMDczYS00N2VhLTgxNmYtNGMzMjkyNjRhODI4Iiwic2NvcGUiOiJvcGVuaWQgcHJvZmlsZSBlbWFpbCBvZmZsaW5lX2FjY2VzcyBncm9rLWNsaTphY2Nlc3MgYXBpOmFjY2VzcyJ9.sig",
  refresh_token: "paste-real-refresh-token-here",
  token_type: "Bearer",
  expired: "2027-01-15T00:00:00Z",
  client_id: "b1a00492-073a-47ea-816f-4c329264a828",
  scope: "openid profile email offline_access grok-cli:access api:access",
};

export type ProviderCategory = "codex" | "grok";

export const PROVIDER_CATEGORIES: ProviderCategory[] = ["codex", "grok"];

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  codex: "Codex",
  grok: "Grok",
};

export type OutputFormat =
  | "sub2api"
  | "cpa"
  | "cockpit"
  | "9router"
  | "codex"
  | "axonhub"
  | "codexmanager";

export const OUTPUT_FORMATS: OutputFormat[] = [
  "sub2api",
  "cpa",
  "cockpit",
  "9router",
  "codex",
  "axonhub",
  "codexmanager",
];

/** Formats available under each top-level provider category */
export const CATEGORY_FORMATS: Record<ProviderCategory, OutputFormat[]> = {
  codex: OUTPUT_FORMATS,
  /** sub2api 导入格式 ↔ CPA 扁平 xai 凭证，可互转 */
  grok: ["sub2api", "cpa"],
};

export const OUTPUT_LABELS: Record<OutputFormat, string> = {
  sub2api: "sub2api",
  cpa: "CPA",
  cockpit: "Cockpit",
  "9router": "9router",
  codex: "Codex",
  axonhub: "AxonHub",
  codexmanager: "Codex-Manager",
};

export const FORMATS_WITH_NOTICE: OutputFormat[] = [
  "cpa",
  "cockpit",
  "codex",
  "axonhub",
  "codexmanager",
];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SessionSource {
  value: Record<string, unknown>;
  sourceName: string;
  path: string;
}

export interface ConvertedAccount {
  sourceName: string;
  sourcePath?: string;
  email?: string;
  name: string;
  expiresAt?: string;
  accessTokenExpiresAt?: number;
  cpa: Record<string, unknown>;
  cockpit: Record<string, unknown>;
  nineRouter: Record<string, unknown>;
  codexAuthJson: Record<string, unknown>;
  axonHub: Record<string, unknown>;
  codexManager: Record<string, unknown>;
  sub2apiAccount: Record<string, unknown>;
}

export interface SkippedItem {
  sourceName: string;
  path?: string;
  reason: string;
}

export interface ConvertResult {
  converted: ConvertedAccount[];
  skipped: SkippedItem[];
  sources: SessionSource[];
}

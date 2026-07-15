import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildOutputDocument,
  convertFromFiles,
  convertFromText,
  formatDisplayDate,
  getTimestampToken,
  sanitizeFileToken,
} from "./lib/convert";
import { codexExample, grokExample } from "./lib/examples";
import {
  buildGrokOutputDocument,
  convertGrokFromFiles,
  convertGrokFromText,
  type GrokAccount,
} from "./lib/grokConvert";
import {
  CATEGORY_FORMATS,
  FORMATS_WITH_NOTICE,
  OUTPUT_LABELS,
  PROVIDER_CATEGORIES,
  PROVIDER_CATEGORY_LABELS,
  type ConvertedAccount,
  type OutputFormat,
  type ProviderCategory,
  type SkippedItem,
} from "./lib/types";
import { THEME_MODE_LABELS, THEME_MODES, useTheme } from "./hooks/useTheme";

type StatusTone = "" | "ok" | "error";

interface StatusState {
  text: string;
  tone: StatusTone;
}

const GITHUB_URL = "https://github.com/luoyeETH/AIAuthBridge";
const SESSION_URL = "https://chatgpt.com/api/auth/session";

export function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [category, setCategory] = useState<ProviderCategory>("codex");
  const [format, setFormat] = useState<OutputFormat>("sub2api");
  const [inputText, setInputText] = useState("");
  const [converted, setConverted] = useState<ConvertedAccount[]>([]);
  const [grokAccounts, setGrokAccounts] = useState<GrokAccount[]>([]);
  const [proxies, setProxies] = useState<Record<string, unknown>[]>([]);
  const [skipped, setSkipped] = useState<SkippedItem[]>([]);
  const [inputStatus, setInputStatus] = useState<StatusState>({ text: "等待输入", tone: "" });
  const [outputStatus, setOutputStatus] = useState<StatusState>({ text: "暂无输出", tone: "" });
  const [dragOver, setDragOver] = useState(false);

  const categoryFormats = CATEGORY_FORMATS[category];

  const outputText = useMemo(() => {
    if (category === "grok") {
      if (!grokAccounts.length) {
        return "";
      }
      const grokFormat = format === "cpa" ? "cpa" : "sub2api";
      return JSON.stringify(buildGrokOutputDocument(grokFormat, grokAccounts, proxies), null, 2);
    }

    if (!converted.length) {
      return "";
    }
    return JSON.stringify(buildOutputDocument(format, converted), null, 2);
  }, [category, converted, format, grokAccounts, proxies]);

  const previewRows = useMemo(() => {
    if (category === "grok") {
      return grokAccounts.map((account) => ({
        name: account.name,
        email: account.email || (typeof account.credentials.email === "string" ? account.credentials.email : undefined),
        expiresAt:
          typeof account.credentials.expires_at === "string"
            ? account.credentials.expires_at
            : account._health?.expires_at,
        sourceName: account.sourceName || "pasted-json",
      }));
    }
    return converted.map((item) => ({
      name: item.name,
      email: item.email,
      expiresAt: item.expiresAt,
      sourceName: item.sourceName,
    }));
  }, [category, converted, grokAccounts]);

  const applyCodexResult = useCallback(
    (next: { converted: ConvertedAccount[]; skipped: SkippedItem[] }, source: "text" | "files" | "clear") => {
      setConverted(next.converted);
      setGrokAccounts([]);
      setProxies([]);
      setSkipped(next.skipped);

      if (source === "clear") {
        setInputStatus({ text: "等待输入", tone: "" });
        setOutputStatus({ text: "暂无输出", tone: "" });
        return;
      }

      if (next.converted.length) {
        const skipPart = next.skipped.length ? ` · 跳过 ${next.skipped.length}` : "";
        setInputStatus({
          text:
            source === "files"
              ? `读取完成 · ${next.converted.length} 账号${skipPart}`
              : `解析完成 · ${next.converted.length} 账号${skipPart}`,
          tone: "ok",
        });
        setOutputStatus({ text: `已生成 ${next.converted.length} 个账号`, tone: "ok" });
      } else {
        setInputStatus({ text: "没有可转换账号", tone: "error" });
        setOutputStatus({ text: "暂无输出", tone: next.skipped.length ? "error" : "" });
      }
    },
    [],
  );

  const applyGrokResult = useCallback(
    (
      next: {
        converted: ConvertedAccount[];
        skipped: SkippedItem[];
        grokAccounts: GrokAccount[];
        proxies: Record<string, unknown>[];
      },
      source: "text" | "files" | "clear",
    ) => {
      setConverted(next.converted);
      setGrokAccounts(next.grokAccounts);
      setProxies(next.proxies);
      setSkipped(next.skipped);

      if (source === "clear") {
        setInputStatus({ text: "等待输入", tone: "" });
        setOutputStatus({ text: "暂无输出", tone: "" });
        return;
      }

      if (next.grokAccounts.length) {
        const skipPart = next.skipped.length ? ` · 跳过 ${next.skipped.length}` : "";
        setInputStatus({
          text:
            source === "files"
              ? `读取完成 · ${next.grokAccounts.length} 账号${skipPart}`
              : `解析完成 · ${next.grokAccounts.length} 账号${skipPart}`,
          tone: "ok",
        });
        setOutputStatus({ text: `已生成 ${next.grokAccounts.length} 个 Grok 账号`, tone: "ok" });
      } else {
        setInputStatus({ text: "没有可转换的 Grok 账号", tone: "error" });
        setOutputStatus({ text: "暂无输出", tone: next.skipped.length ? "error" : "" });
      }
    },
    [],
  );

  const runConvert = useCallback(
    (value: string, activeCategory: ProviderCategory) => {
      if (!value.trim()) {
        applyCodexResult({ converted: [], skipped: [] }, "clear");
        return;
      }

      try {
        if (activeCategory === "grok") {
          const result = convertGrokFromText(value, { requireUsable: true });
          applyGrokResult(result, "text");
        } else {
          const result = convertFromText(value);
          applyCodexResult(result, "text");
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "JSON 解析失败";
        setConverted([]);
        setGrokAccounts([]);
        setProxies([]);
        setSkipped([{ sourceName: "pasted-json", path: "$", reason }]);
        setInputStatus({ text: reason, tone: "error" });
        setOutputStatus({ text: "暂无输出", tone: "error" });
      }
    },
    [applyCodexResult, applyGrokResult],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInputText(value);
      runConvert(value, category);
    },
    [category, runConvert],
  );

  const handleCategoryChange = useCallback(
    (next: ProviderCategory) => {
      setCategory(next);
      const formats = CATEGORY_FORMATS[next];
      if (formats.length) {
        setFormat((current) => (formats.includes(current) ? current : formats[0]));
      }
    },
    [],
  );

  // Re-run conversion when switching category with existing input
  useEffect(() => {
    if (!inputText.trim()) {
      return;
    }
    runConvert(inputText, category);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-convert on category switch
  }, [category]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (category === "grok") {
        const result = await convertGrokFromFiles(files, { requireUsable: true });
        if (result.inputText) {
          setInputText(result.inputText);
        }
        applyGrokResult(result, "files");
        if (!result.grokAccounts.length && result.skipped[0]?.reason === "没有选择 JSON 文件") {
          setInputStatus({ text: "没有选择 JSON 文件", tone: "error" });
        }
        return;
      }

      const result = await convertFromFiles(files);
      if (result.inputText) {
        setInputText(result.inputText);
      }
      applyCodexResult(result, "files");
      if (!result.converted.length && result.skipped[0]?.reason === "没有选择 JSON 文件") {
        setInputStatus({ text: "没有选择 JSON 文件", tone: "error" });
      }
    },
    [applyCodexResult, applyGrokResult, category],
  );

  const handleCopy = useCallback(async () => {
    if (!outputText) {
      return;
    }
    try {
      await navigator.clipboard.writeText(outputText);
      setOutputStatus({ text: "已复制", tone: "ok" });
    } catch {
      setOutputStatus({ text: "复制失败", tone: "error" });
    }
  }, [outputText]);

  const handleDownload = useCallback(() => {
    if (!outputText) {
      return;
    }
    const stamp = getTimestampToken();
    // 类型：codex / sub2api / grok-cpa 等（Grok 的 CPA 加 grok- 前缀以区分）
    const typeToken = category === "grok" && format === "cpa" ? "grok-cpa" : format;
    // 单账号：账号前缀 + 类型 + 时间；多账号：时间 + 类型
    const fileName =
      previewRows.length === 1
        ? `${sanitizeFileToken(previewRows[0]?.email || previewRows[0]?.name || typeToken)}.${typeToken}.${stamp}.json`
        : `${stamp}.${typeToken}.json`;
    const blob = new Blob([outputText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [category, format, outputText, previewRows]);

  const loadExample = useCallback(() => {
    const sample = category === "grok" ? grokExample : codexExample;
    handleInputChange(JSON.stringify(sample, null, 2));
  }, [category, handleInputChange]);

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <h1>AI Auth Bridge</h1>
          <nav className="category-inline" aria-label="服务分类">
            {PROVIDER_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className="category-tab"
                aria-pressed={category === item}
                onClick={() => handleCategoryChange(item)}
              >
                {PROVIDER_CATEGORY_LABELS[item]}
              </button>
            ))}
          </nav>
        </div>
        <div className="meta-row" aria-label="处理方式">
          <div className="theme-switch" role="group" aria-label="主题">
            {THEME_MODES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={themeMode === item}
                onClick={() => setThemeMode(item)}
              >
                {THEME_MODE_LABELS[item]}
              </button>
            ))}
          </div>
          <span className="dot" aria-hidden="true" />
          <span>本地处理</span>
          <span className="dot" aria-hidden="true" />
          <a className="github-link" href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="源码">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.24c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23A11.5 11.5 0 0 1 12 5.78c1.02 0 2.05.14 3.01.41 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.49 5.93.43.37.82 1.1.82 2.22v3.3c0 .32.22.7.83.58A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
            <span>源码</span>
          </a>
        </div>
      </header>

      <section className="workspace">
        <section
          className={`pane${dragOver ? " is-dragover" : ""}`}
          aria-labelledby="input-title"
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDragOver(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files?.length) {
              void handleFiles(event.dataTransfer.files);
            }
          }}
        >
          <div className="pane-head">
            <div className="pane-title">
              <h2 id="input-title">Input</h2>
              <p>粘贴或拖入 JSON 文件</p>
            </div>
            <div className="pane-tools">
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                accept=".json,application/json"
                multiple
                onChange={(event) => {
                  if (event.target.files) {
                    void handleFiles(event.target.files);
                  }
                  event.target.value = "";
                }}
              />
              <button className="btn btn-line btn-sm" type="button" onClick={() => fileInputRef.current?.click()}>
                文件
              </button>
              <button className="btn btn-line btn-sm" type="button" onClick={loadExample}>
                示例
              </button>
              <button className="btn btn-line btn-sm" type="button" onClick={() => handleInputChange("")}>
                清空
              </button>
            </div>
          </div>

          <div className="pane-body">
            {category === "grok" ? (
              <div className="hint-block">
                <p className="hint">
                  Grok / xAI 凭证<strong>双向</strong>互转：CPA 扁平（
                  <span className="hint-code">xai-*.json</span>）↔ sub2api（
                  <span className="hint-code">type=sub2api-data</span>），并补全 JWT 字段。
                </p>
                <p className="hint-formats" aria-label="支持的输入格式">
                  <span>CPA 扁平 xai-*.json</span>
                  <span>sub2api-data 导出</span>
                  <span>多账号 accounts</span>
                  <span>账户对象数组</span>
                </p>
                <p className="hint hint-secondary">
                  推荐使用含 <span className="hint-code">refresh_token</span> 的 OAuth 凭证；仅短期 access_token
                  且已过期时无法导入。
                  <span className="hint-warn"> · 仅本地转换，凭证勿外传</span>
                </p>
              </div>
            ) : (
              <div className="hint-block">
                <p className="hint">
                  支持多种 auth / session JSON，自动识别含 <span className="hint-code">accessToken</span>{" "}
                  的对象，不必是 ChatGPT Session。
                </p>
                <p className="hint-formats" aria-label="支持的输入格式">
                  <span>ChatGPT Session</span>
                  <span>9router</span>
                  <span>Codex</span>
                  <span>AxonHub</span>
                  <span>Codex-Manager</span>
                  <span>同类 OAuth JSON</span>
                </p>
                <p className="hint hint-secondary">
                  ChatGPT 可选来源{" "}
                  <a href={SESSION_URL} target="_blank" rel="noreferrer">
                    chatgpt.com/api/auth/session
                  </a>
                  <span className="hint-warn"> · 仅本地转换，凭证勿外传</span>
                </p>
              </div>
            )}
            <div className="editor">
              <textarea
                className="field"
                spellCheck={false}
                value={inputText}
                onChange={(event) => handleInputChange(event.target.value)}
                placeholder={
                  category === "grok"
                    ? '支持粘贴例如：\n• CPA 扁平凭证（type=xai / access_token + refresh_token）\n• { "accounts": [ ... ] } 多账号导出\n• 账户对象数组'
                    : "支持粘贴例如：\n• ChatGPT Web session\n• 9router / Codex / AxonHub / Codex-Manager 导出\n• 其它含 accessToken + 邮箱/账号 的 JSON"
                }
              />
            </div>
          </div>

          <div className="pane-foot">
            <div className={`status${inputStatus.tone ? ` is-${inputStatus.tone}` : ""}`}>{inputStatus.text}</div>
          </div>
        </section>

        <div className="divider" aria-hidden="true" />

        <section className="pane" aria-labelledby="output-title">
          <div className="pane-head output-head">
            <div className="pane-title">
              <h2 id="output-title">Output</h2>
            </div>
            <div className="output-controls" aria-label="输出控制">
              <div className="segmented" role="group" aria-label="输出格式">
                {categoryFormats.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-format={item}
                    aria-pressed={format === item}
                    onClick={() => setFormat(item)}
                  >
                    {OUTPUT_LABELS[item]}
                  </button>
                ))}
              </div>
              <div className="actions">
                <button className="btn btn-line btn-sm" type="button" disabled={!outputText} onClick={handleCopy}>
                  复制
                </button>
                <button className="btn btn-primary btn-sm" type="button" disabled={!outputText} onClick={handleDownload}>
                  下载
                </button>
              </div>
            </div>
          </div>

          <div className="pane-body">
            {category === "codex" && FORMATS_WITH_NOTICE.includes(format) ? (
              <p className="notice">
                仅格式转换。Web session 通常无 refresh_token；缺 id_token 时会构造占位 JWT。
              </p>
            ) : null}
            {category === "grok" ? (
              <p className="notice">
                {format === "cpa"
                  ? "输出为 CPA 扁平凭证（type=xai，CLIProxyAPI xai-*.json 风格）；多账号时为数组。可与 sub2api 互转。"
                  : "输出为 sub2api 数据备份（type=sub2api-data, version=1, platform=grok）。可与 CPA 扁平凭证互转。"}{" "}
                过期且无 refresh_token 的账户会被跳过。
              </p>
            ) : null}

            <div className="summary" aria-label="转换统计">
              <div className="stat">
                <span className="stat-value">{previewRows.length}</span>
                <span className="stat-label">账号</span>
              </div>
              <div className="stat">
                <span className="stat-value">{OUTPUT_LABELS[format]}</span>
                <span className="stat-label">格式</span>
              </div>
              <div className="stat">
                <span className="stat-value">{skipped.length}</span>
                <span className="stat-label">跳过</span>
              </div>
            </div>

            <div className="accounts" aria-label="账号预览">
              <table>
                <colgroup>
                  <col className="col-name" />
                  <col className="col-email" />
                  <col className="col-expiry" />
                  <col className="col-source" />
                </colgroup>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>邮箱</th>
                    <th>过期</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        —
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((item, index) => (
                      <tr key={`${item.sourceName}-${item.email ?? index}`}>
                        <td>
                          <div className="cell-clip" title={item.name}>
                            {item.name || "-"}
                          </div>
                        </td>
                        <td>
                          <div className="cell-clip" title={item.email}>
                            {item.email || "-"}
                          </div>
                        </td>
                        <td>
                          <div className="cell-clip" title={item.expiresAt}>
                            {formatDisplayDate(item.expiresAt) || "-"}
                          </div>
                        </td>
                        <td>
                          <div className="cell-clip" title={item.sourceName}>
                            {item.sourceName || "pasted-json"}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {skipped.length > 0 ? (
              <div className="issues">
                {skipped.map((item, index) => (
                  <div key={`${item.sourceName}-${item.path ?? index}`}>
                    {item.sourceName || "input"} {item.path || ""}: {item.reason}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="editor">
              <textarea
                className="field"
                readOnly
                spellCheck={false}
                value={outputText}
                placeholder="转换结果"
              />
            </div>
          </div>

          <div className="pane-foot">
            <div className={`status${outputStatus.tone ? ` is-${outputStatus.tone}` : ""}`}>{outputStatus.text}</div>
          </div>
        </section>
      </section>
    </main>
  );
}

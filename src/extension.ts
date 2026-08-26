import * as vscode from "vscode";
import * as https from "https";

const STATUS_API_URL = "https://www.githubstatus.com/api/v2/status.json";
const STATUS_PAGE_URL = "https://www.githubstatus.com";

type Indicator = "none" | "minor" | "major" | "critical";

interface GitHubStatus {
  page: {
    updated_at: string;
  };
  status: {
    indicator: Indicator;
    description: string;
  };
}

function isGitHubStatus(value: unknown): value is GitHubStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  const page = (value as { page?: unknown }).page;

  return (
    typeof page === "object" &&
    page !== null &&
    typeof (page as { updated_at?: unknown }).updated_at === "string" &&
    typeof status === "object" &&
    status !== null &&
    typeof (status as { indicator?: unknown }).indicator === "string" &&
    typeof (status as { description?: unknown }).description === "string"
  );
}

function fetchStatus(): Promise<GitHubStatus> {
  return new Promise((resolve, reject) => {
    https
      .get(STATUS_API_URL, (res) => {
        let data = "";

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub Status API responded with ${res.statusCode ?? "an unexpected status"}`));
          return;
        }

        const contentType = res.headers["content-type"];
        if (contentType && !contentType.includes("application/json")) {
          res.resume();
          reject(new Error(`GitHub Status API returned unexpected content type: ${contentType}`));
          return;
        }

        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data) as unknown;
            if (!isGitHubStatus(parsed)) {
              reject(new Error("GitHub Status API returned an unexpected response shape"));
              return;
            }
            resolve(parsed);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function indicatorToIcon(indicator: Indicator): string {
  switch (indicator) {
    case "none":
      return "$(pass)";
    case "minor":
      return "$(warning)";
    case "major":
      return "$(error)";
    case "critical":
      return "$(stop-circle)";
  }
}

function indicatorToBackground(indicator: Indicator): vscode.ThemeColor | undefined {
  switch (indicator) {
    case "minor":
      return new vscode.ThemeColor("statusBarItem.warningBackground");
    case "major":
    case "critical":
      return new vscode.ThemeColor("statusBarItem.errorBackground");
    default:
      return undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(
    "githubStatus",
    vscode.StatusBarAlignment.Left,
    0
  );
  statusBarItem.name = "GitHub Status";
  statusBarItem.command = "githubStatus.openStatusPage";
  statusBarItem.text = "$(sync~spin) GitHub";
  statusBarItem.show();

  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function applyStatus(indicator: Indicator, description: string, updatedAt: string): void {
    const icon = indicatorToIcon(indicator);
    statusBarItem.text = `${icon} GitHub: ${description}`;
    statusBarItem.backgroundColor = indicatorToBackground(indicator);
    statusBarItem.tooltip = new vscode.MarkdownString(
      `**GitHub Status**\n\n${description}\n\n_Updated: ${new Date(updatedAt).toLocaleString()}_\n\nClick to open GitHub Status page`
    );
  }

  async function refresh(): Promise<void> {
    statusBarItem.text = "$(sync~spin) GitHub";
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = "Fetching GitHub status…";

    try {
      const data = await fetchStatus();
      applyStatus(data.status.indicator, data.status.description, data.page.updated_at);
    } catch {
      statusBarItem.text = "$(alert) GitHub: Unknown";
      statusBarItem.backgroundColor = undefined;
      statusBarItem.tooltip = "Failed to fetch GitHub status. Click to open GitHub Status page.";
    }
  }

  function startPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    const config = vscode.workspace.getConfiguration("githubStatus");
    const intervalMinutes = config.get<number>("pollIntervalMinutes", 5);
    pollTimer = setInterval(() => void refresh(), intervalMinutes * 60 * 1000);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("githubStatus.refresh", () => {
      void refresh();
    }),
    vscode.commands.registerCommand("githubStatus.openStatusPage", () => {
      void vscode.env.openExternal(vscode.Uri.parse(STATUS_PAGE_URL));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("githubStatus.pollIntervalMinutes")) {
        startPolling();
      }
    }),
    statusBarItem,
    { dispose: stopPolling }
  );

  void refresh();
  startPolling();
}

export function deactivate(): void {}

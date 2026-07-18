// Narrow local Vite helper that stamps a verifiable build identity onto the
// production bundle. It emits `dist/version.json` and a single
// `<meta name="htp-build-sha">` tag so release evidence can be verified from
// the served static assets without executing app code.
//
// Node standard library only. No dependencies. No secrets exposed.

import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

export const HTP_SHA_REGEX = /^[0-9a-f]{40}$/i;
export const HTP_APP_NAME = "haultrackerpro";
export const HTP_META_NAME = "htp-build-sha";
export const HTP_VERSION_FILE = "version.json";

export const HTP_SHA_ENV_PRECEDENCE = [
  "HTP_BUILD_SHA",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

export type ShaEnv = Partial<Record<string, string | undefined>>;
export type GitReader = () => string | null;

function normalizeCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!HTP_SHA_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function defaultGitReader(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function resolveBuildSha(
  env: ShaEnv = process.env as ShaEnv,
  gitReader: GitReader = defaultGitReader,
): string {
  for (const key of HTP_SHA_ENV_PRECEDENCE) {
    const candidate = normalizeCandidate(env[key]);
    if (candidate) return candidate;
  }
  const gitCandidate = normalizeCandidate(gitReader());
  if (gitCandidate) return gitCandidate;
  return "unknown";
}

export interface VersionArtifact {
  json: string;
  metaHtml: string;
  payload: { app: string; sha: string; builtAt: string };
}

export function createVersionArtifact(sha: string, builtAt: string): VersionArtifact {
  const normalizedSha = normalizeCandidate(sha) ?? "unknown";
  const payload = { app: HTP_APP_NAME, sha: normalizedSha, builtAt };
  const json = JSON.stringify(payload, null, 2);
  const metaHtml = `<meta name="${HTP_META_NAME}" content="${normalizedSha}">`;
  return { json, metaHtml, payload };
}

export function injectBuildShaMeta(html: string, metaHtml: string): string {
  const existing = new RegExp(
    `<meta\\s+[^>]*name=["']${HTP_META_NAME}["'][^>]*>\\s*`,
    "gi",
  );
  const cleaned = html.replace(existing, "");
  return cleaned.includes("</head>")
    ? cleaned.replace("</head>", `  ${metaHtml}\n</head>`)
    : `${metaHtml}\n${cleaned}`;
}

export function htpBuildShaPlugin(): Plugin {
  let active = false;
  let sha = "unknown";
  let builtAt = "";

  return {
    name: "htp-build-sha",
    apply: "build",
    configResolved(config) {
      active = config.command === "build" && config.mode === "production";
    },
    buildStart() {
      if (!active) return;
      sha = resolveBuildSha();
      builtAt = new Date().toISOString();
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!active) return html;
        const { metaHtml } = createVersionArtifact(sha, builtAt);
        return injectBuildShaMeta(html, metaHtml);
      },
    },
    generateBundle() {
      if (!active) return;
      const { json } = createVersionArtifact(sha, builtAt);
      this.emitFile({
        type: "asset",
        fileName: HTP_VERSION_FILE,
        source: json,
      });
    },
  };
}

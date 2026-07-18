import type { Plugin } from "vite";

export const HTP_APP_NAME = "haultrackerpro" as const;
export const HTP_BUILD_META_NAME = "htp-build-sha" as const;

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const BUILD_SHA_ENV_KEYS = [
  "HTP_BUILD_SHA",
  "GITHUB_SHA",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

export type BuildShaEnvironment = Partial<Record<(typeof BUILD_SHA_ENV_KEYS)[number], string>>;

export interface HtpBuildVersion {
  app: typeof HTP_APP_NAME;
  sha: string;
  builtAt: string;
}

export interface HtpBuildVersionPluginOptions {
  env?: BuildShaEnvironment;
  readGitSha?: () => string | undefined;
  now?: () => Date;
}

export function normalizeFullGitSha(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && FULL_GIT_SHA.test(normalized)
    ? normalized.toLowerCase()
    : undefined;
}

export function resolveHtpBuildSha(
  env: BuildShaEnvironment = {},
  readGitSha: () => string | undefined = () => undefined,
): string {
  for (const key of BUILD_SHA_ENV_KEYS) {
    const candidate = normalizeFullGitSha(env[key]);
    if (candidate) return candidate;
  }

  return normalizeFullGitSha(readGitSha()) ?? "unknown";
}

export function createHtpBuildVersion(
  sha: string,
  now: () => Date = () => new Date(),
): HtpBuildVersion {
  return {
    app: HTP_APP_NAME,
    sha: normalizeFullGitSha(sha) ?? "unknown",
    builtAt: now().toISOString(),
  };
}

export function injectHtpBuildShaMeta(html: string, sha: string): string {
  const safeSha = normalizeFullGitSha(sha) ?? "unknown";
  const existingMeta = new RegExp(
    `<meta\\s+[^>]*name=["']${HTP_BUILD_META_NAME}["'][^>]*>\\s*`,
    "gi",
  );
  const withoutExisting = html.replace(existingMeta, "");
  const tag = `<meta name="${HTP_BUILD_META_NAME}" content="${safeSha}">`;

  return withoutExisting.includes("</head>")
    ? withoutExisting.replace("</head>", `  ${tag}\n</head>`)
    : `${tag}\n${withoutExisting}`;
}

export function createHtpBuildVersionPlugin(
  options: HtpBuildVersionPluginOptions = {},
): Plugin {
  const sha = resolveHtpBuildSha(options.env, options.readGitSha);
  const version = createHtpBuildVersion(sha, options.now);

  return {
    name: "haultrackerpro-build-version",
    apply: "build",
    transformIndexHtml(html) {
      return injectHtpBuildShaMeta(html, version.sha);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(version, null, 2)}\n`,
      });
    },
  };
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  HTP_APP_NAME,
  HTP_META_NAME,
  HTP_SHA_REGEX,
  createVersionArtifact,
  resolveBuildSha,
} from "../../vite/htpBuildShaPlugin";

const PANEL_SRC = readFileSync(
  path.resolve(process.cwd(), "src/components/opportunities/RecruiterBillingPanel.tsx"),
  "utf8",
);


const TEST_SHA = "0123456789abcdef0123456789abcdef01234567";
const TEST_SHA_UPPER = TEST_SHA.toUpperCase();
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const THIRD_SHA = "aaaabbbbccccddddeeeeffff0000111122223333";
const GIT_SHA = "9999888877776666555544443333222211110000";

describe("Phase 1G-R1A4 · RecruiterBillingPanel copy", () => {
  it("contains the three authoritative concepts", () => {
    expect(PANEL_SRC).toContain("complete");
    expect(PANEL_SRC).toContain("non-suspended");
    expect(PANEL_SRC).toMatch(/post standard opportunities/i);
    expect(PANEL_SRC).toMatch(/Verified Recruiter badge/);
    expect(PANEL_SRC).toMatch(/premium recruiting tools/i);
  });

  it.each([
    "Unlimited for verified recruiters",
    "Verified recruiters can post",
    "recruiter profile is approved",
    "Admin-reviewed",
    "based on recruiter approval",
    "Verified recruiter profile",
    "Verified Recruiter Access",
    "unlock premium recruiting tools",
    "Based on paid plan",
    "Listing review",
  ])("does not contain misleading phrase %j", (needle) => {
    expect(PANEL_SRC).not.toContain(needle);
  });
});

describe("Phase 1G-R1A4 · resolveBuildSha precedence", () => {
  const noGit = () => null;

  it("prefers HTP_BUILD_SHA over all others", () => {
    const sha = resolveBuildSha(
      {
        HTP_BUILD_SHA: TEST_SHA,
        GITHUB_SHA: OTHER_SHA,
        VERCEL_GIT_COMMIT_SHA: THIRD_SHA,
      },
      () => GIT_SHA,
    );
    expect(sha).toBe(TEST_SHA);
  });

  it("falls back to GITHUB_SHA when HTP_BUILD_SHA missing", () => {
    const sha = resolveBuildSha(
      { GITHUB_SHA: OTHER_SHA, VERCEL_GIT_COMMIT_SHA: THIRD_SHA },
      () => GIT_SHA,
    );
    expect(sha).toBe(OTHER_SHA);
  });

  it("falls back to VERCEL_GIT_COMMIT_SHA when the first two missing", () => {
    const sha = resolveBuildSha({ VERCEL_GIT_COMMIT_SHA: THIRD_SHA }, () => GIT_SHA);
    expect(sha).toBe(THIRD_SHA);
  });

  it("falls back to git rev-parse HEAD when no env source is valid", () => {
    const sha = resolveBuildSha({}, () => GIT_SHA);
    expect(sha).toBe(GIT_SHA);
  });

  it("returns 'unknown' only when every source is unavailable", () => {
    expect(resolveBuildSha({}, noGit)).toBe("unknown");
  });

  it("lowercases uppercase valid SHAs", () => {
    expect(resolveBuildSha({ HTP_BUILD_SHA: TEST_SHA_UPPER }, noGit)).toBe(TEST_SHA);
  });

  it.each([
    "",
    "  ",
    "not-a-sha",
    "1234",
    "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    `${TEST_SHA}extra`,
    `${TEST_SHA.slice(0, 39)}`,
  ])("ignores invalid env value %j and falls through", (bad) => {
    const sha = resolveBuildSha(
      { HTP_BUILD_SHA: bad, GITHUB_SHA: OTHER_SHA },
      () => GIT_SHA,
    );
    expect(sha).toBe(OTHER_SHA);
  });

  it("ignores an invalid git result and returns 'unknown'", () => {
    expect(resolveBuildSha({}, () => "not-a-sha")).toBe("unknown");
  });

  it("regex accepts 40-char hex only", () => {
    expect(HTP_SHA_REGEX.test(TEST_SHA)).toBe(true);
    expect(HTP_SHA_REGEX.test(TEST_SHA_UPPER)).toBe(true);
    expect(HTP_SHA_REGEX.test(TEST_SHA + "a")).toBe(false);
    expect(HTP_SHA_REGEX.test("zzz")).toBe(false);
  });
});

describe("Phase 1G-R1A4 · createVersionArtifact", () => {
  const builtAt = "2026-07-18T12:34:56.000Z";
  const { json, metaHtml, payload } = createVersionArtifact(TEST_SHA, builtAt);

  it("emits JSON with exactly {app, sha, builtAt} and correct values", () => {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["app", "builtAt", "sha"]);
    expect(parsed.app).toBe(HTP_APP_NAME);
    expect(parsed.sha).toBe(TEST_SHA);
    expect(parsed.builtAt).toBe(builtAt);
  });

  it("builtAt parses as an ISO-8601 timestamp", () => {
    const parsed = JSON.parse(json) as { builtAt: string };
    const d = new Date(parsed.builtAt);
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.toISOString()).toBe(builtAt);
  });

  it("emits exactly one matching meta tag", () => {
    const matches = metaHtml.match(
      new RegExp(`<meta name="${HTP_META_NAME}" content="[^"]+">`, "g"),
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
    expect(metaHtml).toBe(`<meta name="${HTP_META_NAME}" content="${TEST_SHA}">`);
  });

  it("JSON SHA and meta SHA match the explicit test build SHA", () => {
    const parsed = JSON.parse(json) as { sha: string };
    const metaContent = metaHtml.match(/content="([^"]+)"/)?.[1];
    expect(parsed.sha).toBe(TEST_SHA);
    expect(metaContent).toBe(TEST_SHA);
    expect(parsed.sha).toBe(metaContent);
    expect(payload.sha).toBe(TEST_SHA);
  });

  it("artifacts contain no dummy secret markers or unrelated env values", () => {
    const forbidden = [
      "sk_test_",
      "sk_live_",
      "pk_test_",
      "pk_live_",
      "SUPABASE_SERVICE_ROLE",
      "SERVICE_ROLE_KEY",
      "eyJhbGciOi",
      "postgres://",
      "postgresql://",
      "HTP_BUILD_SHA",
      "GITHUB_SHA",
      "VERCEL_GIT_COMMIT_SHA",
      "process.env",
    ];
    const blob = `${json}\n${metaHtml}`;
    for (const needle of forbidden) {
      expect(blob).not.toContain(needle);
    }
  });

  it("also emits a valid 'unknown' artifact when SHA is unknown", () => {
    const { json: uj, metaHtml: um } = createVersionArtifact("unknown", builtAt);
    const parsed = JSON.parse(uj) as { sha: string; app: string };
    expect(parsed.sha).toBe("unknown");
    expect(parsed.app).toBe(HTP_APP_NAME);
    expect(um).toBe(`<meta name="${HTP_META_NAME}" content="unknown">`);
  });
});

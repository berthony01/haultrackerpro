/**
 * Phase TG-2F-C1 — recruiter Dispatch Telegram Group UI contract.
 *
 * Static source assertions plus focused behavioural tests. No network, no
 * database, no secret access.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildDispatchBindCommand,
  isValidDispatchBindToken,
  remainingSeconds,
  formatRemaining,
  DISPATCH_BIND_TOKEN_TTL_MS,
  TELEGRAM_DISPATCH_BOT_USERNAME,
} from "@/hooks/useTelegramDispatchBind";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const HOOK_PATH = "src/hooks/useTelegramDispatchBind.ts";
const SECTION_PATH = "src/components/opportunities/recruiter/DispatchTelegramGroupSection.tsx";
const SETTINGS_PATH = "src/components/opportunities/recruiter/RecruiterSettingsView.tsx";
const LINK_HOOK_PATH = "src/hooks/useTelegramLink.ts";
const LINK_SECTION_PATH = "src/components/TelegramConnectionSection.tsx";

const HOOK_SOURCE = read(HOOK_PATH);
const SECTION_SOURCE = read(SECTION_PATH);
const SETTINGS_SOURCE = read(SETTINGS_PATH);

const HEX64 = "c".repeat(64);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("TG-2F-C UI A — pure token helpers", () => {
  it("accepts only 64 lowercase hex characters", () => {
    expect(isValidDispatchBindToken(HEX64)).toBe(true);
    expect(isValidDispatchBindToken("C".repeat(64))).toBe(false);
    expect(isValidDispatchBindToken("c".repeat(63))).toBe(false);
    expect(isValidDispatchBindToken("c".repeat(65))).toBe(false);
    expect(isValidDispatchBindToken(null)).toBe(false);
    expect(isValidDispatchBindToken(12345)).toBe(false);
    expect(isValidDispatchBindToken({ token: HEX64 })).toBe(false);
  });

  it("builds the exact bind command the poller recognises", () => {
    expect(buildDispatchBindCommand(HEX64)).toBe(`/bind ${HEX64}`);
    expect(buildDispatchBindCommand(HEX64)).toMatch(/^\/bind [0-9a-f]{64}$/);
  });

  it("never builds a Telegram URL around the token", () => {
    expect(buildDispatchBindCommand(HEX64)).not.toContain("t.me");
    expect(buildDispatchBindCommand(HEX64)).not.toContain("http");
  });

  it("uses the live 15-minute TTL", () => {
    expect(DISPATCH_BIND_TOKEN_TTL_MS).toBe(15 * 60 * 1000);
  });

  it("counts down and floors at zero", () => {
    expect(remainingSeconds(10_000, 0)).toBe(10);
    expect(remainingSeconds(10_000, 9_400)).toBe(0);
    expect(remainingSeconds(10_000, 99_999)).toBe(0);
    expect(remainingSeconds(null, 0)).toBe(0);
  });

  it("formats the countdown", () => {
    expect(formatRemaining(900)).toBe("15:00");
    expect(formatRemaining(65)).toBe("1:05");
    expect(formatRemaining(0)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// Source contract
// ---------------------------------------------------------------------------

describe("TG-2F-C UI B — hook calls only the live TG-2F-B issuer", () => {
  it("references exactly one RPC name", () => {
    const rpcs = [...HOOK_SOURCE.matchAll(/'(issue_[a-z_]+|consume_[a-z_]+|telegram_[a-z_]+)'/g)]
      .map((m) => m[1])
      .filter((n) => !n.startsWith("telegram_not_") && !n.startsWith("telegram_dispatch_bind_inv"));
    expect(HOOK_SOURCE).toContain("'issue_telegram_dispatch_bind_token'");
    expect(rpcs).toContain("issue_telegram_dispatch_bind_token");
  });

  it("never calls the consume or bind functions from the browser", () => {
    expect(HOOK_SOURCE).not.toContain("consume_telegram_dispatch_bind_token");
    expect(HOOK_SOURCE).not.toContain("telegram_bind_dispatch_chat");
    expect(HOOK_SOURCE).not.toContain("telegram_process_bind_update");
    expect(SECTION_SOURCE).not.toContain("consume_telegram_dispatch_bind_token");
  });

  it("passes the recruiter id as the only RPC argument", () => {
    expect(HOOK_SOURCE).toMatch(/_recruiter_id:\s*recruiterId/);
  });
});

describe("TG-2F-C UI C — the raw token is never persisted", () => {
  // Comments are stripped so the assertions pin executable code, not prose.
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const sources: Array<[string, string]> = [
    ["hook", stripComments(HOOK_SOURCE)],
    ["section", stripComments(SECTION_SOURCE)],
  ];

  it.each(sources)("%s uses no persistent browser storage", (_name, source) => {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "indexedDB",
      "history.pushState",
      "searchParams",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it.each(sources)("%s never logs or analyses the token or command", (_name, source) => {
    expect(source).not.toMatch(/console\.(log|info|warn|error|debug)/);
    expect(source).not.toContain("trackEvent");
    expect(source).not.toContain("gtag");
  });

  it("never writes the token to the database", () => {
    expect(HOOK_SOURCE).not.toMatch(/\.from\(/);
    expect(HOOK_SOURCE).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  it("never puts the token into a Telegram deep link", () => {
    for (const source of [SECTION_SOURCE, HOOK_SOURCE]) {
      expect(source).not.toMatch(/https?:\/\/t\.me/);
      expect(source).not.toMatch(/t\.me\//);
      expect(source).not.toContain("startgroup");
      expect(source).not.toContain("tg://");
    }
  });

  it("never renders or copies the recruiter id", () => {
    // JSX interpolation of the raw id, in any position.
    expect(SECTION_SOURCE).not.toMatch(/>\s*\{\s*recruiterId/);
    expect(SECTION_SOURCE).not.toMatch(/\{\s*recruiterId\s*\}\s*</);
    expect(SECTION_SOURCE).not.toMatch(/write(?:Text)?\(\s*recruiterId/);
  });
});


describe("TG-2F-C UI D — existing individual Telegram linking is untouched", () => {
  it("the shared link hook still exposes exactly its two TG-2E3 RPCs", () => {
    const linkHook = read(LINK_HOOK_PATH);
    const rpcNames = [...linkHook.matchAll(/'(issue_telegram_link_token|revoke_my_telegram_link|issue_telegram_dispatch_bind_token)'/g)]
      .map((m) => m[1]);
    expect([...new Set(rpcNames)].sort()).toEqual([
      "issue_telegram_link_token",
      "revoke_my_telegram_link",
    ]);
  });

  it("the shared link section contains no dispatch bind surface", () => {
    const linkSection = read(LINK_SECTION_PATH);
    expect(linkSection).not.toContain("dispatch_bind");
    expect(linkSection).not.toContain("/bind");
  });

  it("the new section consumes the link hook read-only", () => {
    expect(SECTION_SOURCE).toContain("useTelegramLink()");
    expect(SECTION_SOURCE).not.toContain("connect(");
    expect(SECTION_SOURCE).not.toContain("disconnect(");
  });
});

describe("TG-2F-C UI E — owner settings mount and permission gating", () => {
  it("mounts the section beside the individual Telegram section", () => {
    expect(SETTINGS_SOURCE).toContain("<TelegramConnectionSection />");
    expect(SETTINGS_SOURCE).toContain("<DispatchTelegramGroupSection recruiterId={profile?.id ?? null} />");
    expect(SETTINGS_SOURCE.indexOf("<TelegramConnectionSection />")).toBeLessThan(
      SETTINGS_SOURCE.indexOf("<DispatchTelegramGroupSection"),
    );
  });

  it("derives permission from the existing server-backed hook only", () => {
    expect(SECTION_SOURCE).toContain("useRecruiterStaffPermissions(recruiterId ?? null)");
    expect(SECTION_SOURCE).toContain("canDispatchLoads");
    // No client-side role inference of any kind.
    for (const forbidden of ["recruiter_owner", "recruiter_admin", "isAdmin", "user_roles"]) {
      expect(SECTION_SOURCE).not.toContain(forbidden);
    }
  });

  it("requires BOTH a linked personal account and dispatch permission", () => {
    expect(SECTION_SOURCE).toMatch(
      /canGenerate\s*=\s*!!recruiterId && personalTelegramConnected && canDispatchLoads/,
    );
    expect(SECTION_SOURCE).toContain("disabled={!canGenerate || isGenerating}");
  });

  it("does not claim the group is connected", () => {
    expect(SECTION_SOURCE).toContain("Command generated");
    expect(SECTION_SOURCE).not.toMatch(/Group connected|Connected<\/Badge>/);
  });

  it("references the bot by public username only", () => {
    expect(SECTION_SOURCE).toContain("TELEGRAM_DISPATCH_BOT_USERNAME");
    expect(TELEGRAM_DISPATCH_BOT_USERNAME).toBe("HaulTrackerProDispatchBot");
  });
});

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

const linkState = { connected: true, isLoading: false };
const permissionState = { canDispatchLoads: true, isLoading: false };
const rpc = vi.fn();

vi.mock("@/hooks/useTelegramLink", () => ({
  useTelegramLink: () => linkState,
  TELEGRAM_BOT_USERNAME: "HaulTrackerProDispatchBot",
}));

vi.mock("@/hooks/recruiter/useRecruiterStaffPermissions", () => ({
  useRecruiterStaffPermissions: () => permissionState,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const writeText = vi.fn(async () => {});

describe("TG-2F-C UI F — generate and copy behaviour", () => {
  beforeEach(() => {
    rpc.mockReset();
    writeText.mockClear();
    linkState.connected = true;
    linkState.isLoading = false;
    permissionState.canDispatchLoads = true;
    permissionState.isLoading = false;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => cleanup());

  const renderSection = async () => {
    const { DispatchTelegramGroupSection } = await import(
      "@/components/opportunities/recruiter/DispatchTelegramGroupSection"
    );
    return render(<DispatchTelegramGroupSection recruiterId="rec-1" />);
  };

  it("issues a code and renders the exact command", async () => {
    rpc.mockResolvedValue({ data: HEX64, error: null });
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: /generate connection command/i }));

    await waitFor(() =>
      expect(screen.getByTestId("dispatch-bind-command")).toHaveTextContent(`/bind ${HEX64}`),
    );
    expect(rpc).toHaveBeenCalledWith("issue_telegram_dispatch_bind_token", {
      _recruiter_id: "rec-1",
    });
  });

  it("copies the command through the clipboard seam", async () => {
    rpc.mockResolvedValue({ data: HEX64, error: null });
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: /generate connection command/i }));
    await waitFor(() => screen.getByTestId("dispatch-bind-command"));
    await userEvent.click(screen.getByRole("button", { name: /copy connection command/i }));

    expect(writeText).toHaveBeenCalledWith(`/bind ${HEX64}`);
  });

  it("renders no command when the RPC rejects", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "telegram_dispatch_not_authorized" } });
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: /generate connection command/i }));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByTestId("dispatch-bind-command")).toBeNull();
  });

  it("rejects a malformed token from the server", async () => {
    rpc.mockResolvedValue({ data: "not-a-token", error: null });
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: /generate connection command/i }));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(screen.queryByTestId("dispatch-bind-command")).toBeNull();
  });

  it("gates generation when the personal Telegram account is not linked", async () => {
    linkState.connected = false;
    await renderSection();

    expect(screen.getByRole("button", { name: /generate connection command/i })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gates generation without dispatch permission", async () => {
    permissionState.canDispatchLoads = false;
    await renderSection();

    expect(screen.getByRole("button", { name: /generate connection command/i })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("writes nothing to browser storage while a code is live", async () => {
    rpc.mockResolvedValue({ data: HEX64, error: null });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await renderSection();

    await userEvent.click(screen.getByRole("button", { name: /generate connection command/i }));
    await waitFor(() => screen.getByTestId("dispatch-bind-command"));

    const persisted = setItem.mock.calls.filter(([, value]) =>
      String(value ?? "").includes(HEX64),
    );
    expect(persisted).toHaveLength(0);
    setItem.mockRestore();
  });
});

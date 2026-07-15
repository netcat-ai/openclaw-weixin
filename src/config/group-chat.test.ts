import { describe, expect, it } from "vitest";

import { resolveWeixinGroupAccess, resolveWeixinRequireMention } from "./group-chat.js";

describe("resolveWeixinGroupAccess", () => {
  it("defaults to accepting group messages", () => {
    expect(resolveWeixinGroupAccess({})).toEqual({
      groupPolicy: "open",
      groupAllowFrom: [],
    });
  });

  it("applies account overrides without losing section fallbacks", () => {
    const cfg = {
      channels: {
        "openclaw-weixin": {
          groupPolicy: "allowlist",
          groupAllowFrom: ["wxid-owner"],
          accounts: {
            bot: { groupAllowFrom: [" wxid-admin "] },
          },
        },
      },
    } as never;
    expect(resolveWeixinGroupAccess(cfg, "bot")).toEqual({
      groupPolicy: "allowlist",
      groupAllowFrom: ["wxid-admin"],
    });
  });
});

describe("resolveWeixinRequireMention", () => {
  it("defaults to always-on and supports exact and wildcard group rules", () => {
    const cfg = {
      channels: {
        "openclaw-weixin": {
          groups: {
            "family@chatroom": { requireMention: true },
            "*": { requireMention: false },
          },
        },
      },
    } as never;
    expect(resolveWeixinRequireMention({ cfg: {}, groupId: "unknown" })).toBe(false);
    expect(resolveWeixinRequireMention({ cfg, groupId: "family@chatroom" })).toBe(true);
    expect(resolveWeixinRequireMention({ cfg, groupId: "other@chatroom" })).toBe(false);
  });

  it("prefers account rules and applies wildcard rules without a group id", () => {
    const cfg = {
      channels: {
        "openclaw-weixin": {
          groups: { "*": { requireMention: false } },
          accounts: {
            bot: {
              groups: {
                "team@chatroom": { requireMention: false },
                "*": { requireMention: true },
              },
            },
          },
        },
      },
    } as never;
    expect(resolveWeixinRequireMention({
      cfg,
      accountId: "bot",
      groupId: " team@chatroom ",
    })).toBe(false);
    expect(resolveWeixinRequireMention({ cfg, accountId: "bot" })).toBe(true);
  });
});

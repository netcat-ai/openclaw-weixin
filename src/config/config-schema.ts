import { z } from "zod";

import { CDN_BASE_URL, DEFAULT_BASE_URL } from "../auth/accounts.js";

// ---------------------------------------------------------------------------
// Zod config schema
// ---------------------------------------------------------------------------

const weixinAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  cdnBaseUrl: z.string().default(CDN_BASE_URL),
  routeTag: z.number().optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  groupAllowFrom: z.array(z.string()).optional(),
  groups: z.record(
    z.string(),
    z.object({ requireMention: z.boolean().optional() }).passthrough(),
  ).optional(),
});

/** Top-level weixin config schema (token is stored in credentials file, not config). */
export const WeixinConfigSchema = weixinAccountSchema.extend({
  accounts: z.record(z.string(), weixinAccountSchema).optional(),
  replyProgressMessages: z.boolean().default(true),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  groupAllowFrom: z.array(z.string()).default([]),
  /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
  channelConfigUpdatedAt: z.string().optional(),
});

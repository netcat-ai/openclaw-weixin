import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

export type WeixinGroupPolicy = "open" | "allowlist" | "disabled";

type WeixinGroupEntry = {
  requireMention?: boolean;
};

type WeixinGroupConfig = {
  groupPolicy?: WeixinGroupPolicy;
  groupAllowFrom?: string[];
  groups?: Record<string, WeixinGroupEntry>;
};

type WeixinSectionConfig = WeixinGroupConfig & {
  accounts?: Record<string, WeixinGroupConfig>;
};

function resolveConfigLayers(cfg: OpenClawConfig, accountId?: string | null) {
  const section = cfg.channels?.["openclaw-weixin"] as WeixinSectionConfig | undefined;
  const account = accountId ? section?.accounts?.[accountId] : undefined;
  return { section, account };
}

export function resolveWeixinGroupAccess(
  cfg: OpenClawConfig,
  accountId?: string | null,
): { groupPolicy: WeixinGroupPolicy; groupAllowFrom: string[] } {
  const { section, account } = resolveConfigLayers(cfg, accountId);
  const groupPolicy = account?.groupPolicy ?? section?.groupPolicy ?? "open";
  const configured = account?.groupAllowFrom ?? section?.groupAllowFrom ?? [];
  const groupAllowFrom = configured.map((entry) => entry.trim()).filter(Boolean);
  return { groupPolicy, groupAllowFrom };
}

export function resolveWeixinRequireMention(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  groupId?: string | null;
}): boolean {
  const { section, account } = resolveConfigLayers(params.cfg, params.accountId);
  const groups = account?.groups ?? section?.groups;
  const groupId = params.groupId?.trim();
  const configured = (groupId ? groups?.[groupId] : undefined) ?? groups?.["*"];
  // Webox exposes every group message but iLink has no structured mention list.
  // Default to always-on; users can opt into OpenClaw mention-pattern gating per group.
  return configured?.requireMention ?? false;
}

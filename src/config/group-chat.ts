import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

type WeixinGroupEntry = {
  requireMention?: boolean;
};

type WeixinGroupConfig = {
  groups?: Record<string, WeixinGroupEntry>;
};

type WeixinSectionConfig = WeixinGroupConfig & {
  accounts?: Record<string, WeixinGroupConfig>;
};

function resolveConfigLayers(cfg: OpenClawConfig, accountId?: string | null) {
  const section = cfg.channels?.["openclaw-weixin"] as
    | WeixinSectionConfig
    | undefined;
  const account = accountId ? section?.accounts?.[accountId] : undefined;
  return { section, account };
}

export function resolveWeixinRequireMention(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  groupId?: string | null;
}): boolean {
  const { section, account } = resolveConfigLayers(
    params.cfg,
    params.accountId,
  );
  const groups = account?.groups ?? section?.groups;
  const groupId = params.groupId?.trim();
  const configured = (groupId ? groups?.[groupId] : undefined) ?? groups?.["*"];
  return configured?.requireMention ?? true;
}

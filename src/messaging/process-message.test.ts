import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageItemType } from "../api/types.js";

const { mockSendMessageWeixin } = vi.hoisted(() => ({
  mockSendMessageWeixin: vi.fn(),
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mockSendMessageWeixin,
  StreamingMarkdownFilter: class {
    feed(text: string) { return text; }
    flush() { return ""; }
  },
}));

vi.mock("./outbound-hooks.js", () => ({
  applyWeixinMessageSendingHook: vi.fn(async (params: { text: string }) => ({
    cancelled: false,
    text: params.text,
  })),
  emitWeixinMessageSent: vi.fn(),
}));

vi.mock("../util/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { processOneMessage } from "./process-message.js";

function createRuntime(options: { groupAllowed?: boolean } = {}) {
  let deliver: ((payload: { text: string }) => Promise<void>) | undefined;
  const resolveAgentRoute = vi.fn(() => ({
    agentId: "main",
    accountId: "bot",
    sessionKey: "agent:main:openclaw-weixin:group:family@chatroom",
    mainSessionKey: "agent:main:main",
  }));
  const recordInboundSession = vi.fn(async () => {});
  const runtime = {
    groups: {
      resolveGroupPolicy: vi.fn(() => ({
        allowlistEnabled: false,
        allowed: options.groupAllowed !== false,
      })),
    },
    commands: {
      shouldComputeCommandAuthorized: vi.fn(() => false),
      resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
    },
    routing: { resolveAgentRoute },
    mentions: {
      buildMentionRegexes: vi.fn(() => [/@openclaw/i]),
      matchesMentionPatterns: vi.fn((text: string, patterns: RegExp[]) =>
        patterns.some((pattern) => pattern.test(text))),
    },
    media: { saveMediaBuffer: vi.fn() },
    session: {
      resolveStorePath: vi.fn(() => "/tmp/sessions.json"),
      recordInboundSession,
    },
    reply: {
      finalizeInboundContext: vi.fn((ctx: Record<string, unknown>) => ({
        ...ctx,
        CommandAuthorized: ctx.CommandAuthorized ?? false,
      })),
      resolveHumanDelayConfig: vi.fn(() => undefined),
      createReplyDispatcherWithTyping: vi.fn((params: {
        deliver: (payload: { text: string }) => Promise<void>;
      }) => {
        deliver = params.deliver;
        return { dispatcher: {}, replyOptions: {}, markDispatchIdle: vi.fn() };
      }),
      withReplyDispatcher: vi.fn(async (params: { run: () => Promise<void> }) => params.run()),
      dispatchReplyFromConfig: vi.fn(async () => {
        await deliver?.({ text: "group reply" });
      }),
    },
  };
  return { runtime, resolveAgentRoute, recordInboundSession };
}

const groupMessage = {
  from_user_id: "wxid-alice",
  session_id: "family@chatroom",
  group_id: "family@chatroom",
  context_token: "group-context",
  item_list: [{ type: MessageItemType.TEXT, text_item: { text: "hello group" } }],
};

function createDeps(
  runtime: ReturnType<typeof createRuntime>["runtime"],
  channelConfig: Record<string, unknown> = {},
) {
  return {
    accountId: "bot",
    config: {
      channels: {
        "openclaw-weixin": { replyProgressMessages: false, ...channelConfig },
      },
    },
    channelRuntime: runtime,
    baseUrl: "http://webox.test",
    cdnBaseUrl: "http://cdn.test",
    token: "token",
    log: vi.fn(),
    errLog: vi.fn(),
  } as never;
}

describe("processOneMessage group routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessageWeixin.mockResolvedValue({ messageId: "sent-1" });
  });

  it("routes, records, and replies by group while retaining the member sender", async () => {
    const { runtime, resolveAgentRoute, recordInboundSession } = createRuntime();
    await processOneMessage(groupMessage, createDeps(runtime));

    expect(resolveAgentRoute).toHaveBeenCalledWith(expect.objectContaining({
      peer: { kind: "group", id: "family@chatroom" },
    }));
    expect(recordInboundSession).toHaveBeenCalledWith(expect.objectContaining({
      ctx: expect.objectContaining({
        ChatType: "group",
        From: "family@chatroom",
        To: "family@chatroom",
        SenderId: "wxid-alice",
        GroupSubject: "family@chatroom",
      }),
    }));
    expect(recordInboundSession.mock.calls[0]?.[0]).not.toHaveProperty("updateLastRoute");
    expect(mockSendMessageWeixin).toHaveBeenCalledWith({
      to: "family@chatroom",
      text: "group reply",
      opts: expect.objectContaining({ contextToken: "group-context" }),
    });
  });

  it("drops a group rejected by group policy before routing", async () => {
    const { runtime, resolveAgentRoute } = createRuntime({ groupAllowed: false });
    await processOneMessage(groupMessage, createDeps(runtime));
    expect(resolveAgentRoute).not.toHaveBeenCalled();
    expect(mockSendMessageWeixin).not.toHaveBeenCalled();
  });

  it("drops a group member outside groupAllowFrom before routing", async () => {
    const { runtime, resolveAgentRoute } = createRuntime();
    await processOneMessage(groupMessage, createDeps(runtime, {
      groupPolicy: "allowlist",
      groupAllowFrom: ["wxid-owner"],
    }));
    expect(resolveAgentRoute).not.toHaveBeenCalled();
    expect(mockSendMessageWeixin).not.toHaveBeenCalled();
  });
});

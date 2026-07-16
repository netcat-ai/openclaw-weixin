import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageItemType } from "../api/types.js";

const { mockSendMessageWeixin } = vi.hoisted(() => ({
  mockSendMessageWeixin: vi.fn(),
}));

vi.mock("./send.js", () => ({
  sendMessageWeixin: mockSendMessageWeixin,
  StreamingMarkdownFilter: class {
    feed(text: string) {
      return text;
    }
    flush() {
      return "";
    }
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

function createRuntime(options: { delayedSessionMeta?: boolean } = {}) {
  let deliver: ((payload: { text: string }) => Promise<void>) | undefined;
  const resolveAgentRoute = vi.fn(() => ({
    agentId: "main",
    accountId: "bot",
    sessionKey: "agent:main:openclaw-weixin:group:family@chatroom",
    mainSessionKey: "agent:main:main",
  }));
  let sessionMetaReady = !options.delayedSessionMeta;
  const dispatchSessionMetaStates: boolean[] = [];
  const recordInboundSession = vi.fn(
    async (params: {
      trackSessionMetaTask?: (task: Promise<void>) => void;
    }) => {
      if (!options.delayedSessionMeta) return;
      const task = new Promise<void>((resolve) => {
        setTimeout(() => {
          sessionMetaReady = true;
          resolve();
        }, 0);
      });
      params.trackSessionMetaTask?.(task);
    },
  );
  const runtime = {
    commands: {
      shouldComputeCommandAuthorized: vi.fn(() => false),
      resolveCommandAuthorizedFromAuthorizers: vi.fn(() => false),
    },
    routing: { resolveAgentRoute },
    mentions: {
      buildMentionRegexes: vi.fn(() => [/@openclaw/i]),
      matchesMentionPatterns: vi.fn((text: string, patterns: RegExp[]) =>
        patterns.some((pattern) => pattern.test(text)),
      ),
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
      createReplyDispatcherWithTyping: vi.fn(
        (params: { deliver: (payload: { text: string }) => Promise<void> }) => {
          deliver = params.deliver;
          return {
            dispatcher: {},
            replyOptions: {},
            markDispatchIdle: vi.fn(),
          };
        },
      ),
      withReplyDispatcher: vi.fn(async (params: { run: () => Promise<void> }) =>
        params.run(),
      ),
      dispatchReplyFromConfig: vi.fn(
        async (params: { ctx: { ChatType?: string } }) => {
          dispatchSessionMetaStates.push(sessionMetaReady);
          if (!sessionMetaReady && params.ctx.ChatType !== "group") {
            throw new Error("reply session initialization conflicted");
          }
          await deliver?.({ text: "group reply" });
        },
      ),
    },
  };
  return {
    runtime,
    resolveAgentRoute,
    recordInboundSession,
    dispatchSessionMetaStates,
  };
}

const groupMessage = {
  from_user_id: "wxid-alice",
  session_id: "family@chatroom",
  group_id: "family@chatroom",
  context_token: "group-context",
  item_list: [
    { type: MessageItemType.TEXT, text_item: { text: "@openclaw hello group" } },
  ],
};

const directMessage = {
  from_user_id: "wxid-unpaired",
  session_id: "wxid-unpaired",
  context_token: "direct-context",
  item_list: [
    { type: MessageItemType.TEXT, text_item: { text: "hello direct" } },
  ],
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
    const { runtime, resolveAgentRoute, recordInboundSession, dispatchSessionMetaStates } =
      createRuntime({ delayedSessionMeta: true });
    await processOneMessage(groupMessage, createDeps(runtime));

    expect(resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: { kind: "group", id: "family@chatroom" },
      }),
    );
    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          ChatType: "group",
          From: "family@chatroom",
          To: "family@chatroom",
          SenderId: "wxid-alice",
          GroupSubject: "family@chatroom",
          WasMentioned: true,
        }),
      }),
    );
    expect(recordInboundSession.mock.calls[0]?.[0]).not.toHaveProperty(
      "updateLastRoute",
    );
    expect(mockSendMessageWeixin).toHaveBeenCalledWith({
      to: "family@chatroom",
      text: "group reply",
      opts: expect.objectContaining({ contextToken: "group-context" }),
    });
    expect(dispatchSessionMetaStates).toEqual([false]);
  });

  it("waits for inbound session metadata before starting the Agent reply", async () => {
    const { runtime } = createRuntime({ delayedSessionMeta: true });

    await processOneMessage(directMessage, createDeps(runtime));

    expect(mockSendMessageWeixin).toHaveBeenCalled();
  });

});

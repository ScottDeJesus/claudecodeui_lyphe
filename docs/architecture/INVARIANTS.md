<!-- docstore export; edit rows with docstore write, never this file -->

## INV-6303 — probe — A return to a session whose sent message is older than the loaded page never lands; the view ends at the foot

A return to a session whose sent message is older than the loaded page never lands; the view ends at the foot

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && VP=390x844 TAG=phone timeout 500 node /home/lyphe/.claude/state/pipeline-reviews/chat-follow-glide/athena-probes/long-reply-history.mjs
expect: every "samples:" line reads offsetFromTop between 0 and 24 with btn true (today: offsetFromTop 199, gap 0, btn false, and the scrollTop writes list a landAtMessageTop `align` followed by a settle `tick` writing the foot). About 4 min, 4 Haiku turns; VP=1440x900 shows the same.
```

measured 2026-10-01 by chain chain-chat-follow-glide-20261001-140108-5a55, finding H1, HIGH
probe-key: 80641bd3c7379be766dcf75be0477c3261b1865c

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/ChatInterface.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatSessionState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useFollowGlide.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useReplyAnchor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/landAtMessageTop.ts

## INV-6305 — probe — The landing is decided once, from the store at the instant of return: a store that is stale at that instant (a dead socket) never lands, and the catch-up that follows glides the reader through the whole reply

The landing is decided once, from the store at the instant of return: a store that is stale at that instant (a dead socket) never lands, and the catch-up that follows glides the reader through the whole reply

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 280 node /home/lyphe/.claude/state/pipeline-reviews/chat-follow-glide/athena-probes/ws-dead-away.mjs
expect: the "after reconnect + catch-up (+7s)" line reads found true, offsetFromTop between 0 and 24, btn true (today: found false, top 2133, gap 0, btn false, and the frames show a 2000 px glide from top 86)
```

measured 2026-10-01 by chain chain-chat-follow-glide-20261001-140108-5a55, finding M2, MEDIUM
probe-key: c81704efc5c53c1e47fcf85bdd283e617dc5ae11

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/ChatInterface.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatSessionState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useFollowGlide.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useReplyAnchor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/landAtMessageTop.ts

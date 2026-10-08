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

## INV-6304 — probe — Reopening a session from a sidebar message-search hit, with an armed anchor and rows that arrived while away, hides the whole transcript for about 8 seconds

Reopening a session from a sidebar message-search hit, with an armed anchor and rows that arrived while away, hides the whole transcript for about 8 seconds

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && MODE=armed timeout 280 node /home/lyphe/.claude/state/pipeline-reviews/chat-follow-glide/athena-probes/search-hit-collision.mjs; MODE=control timeout 280 node /home/lyphe/.claude/state/pipeline-reviews/chat-follow-glide/athena-probes/search-hit-collision.mjs
expect: the armed SUMMARY reads visible again within ~1500 ms (today: hidden from 213 ms, visible at 8340 ms), and the control reads visible from the first sample
```

measured 2026-10-01 by chain chain-chat-follow-glide-20261001-140108-5a55, finding M1, MEDIUM
probe-key: 109d3dbe79d518334e3e4375877b66370c037caf

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

## INV-6306 — probe — An input that moves nothing, mid-glide, ends the follow for the rest of the reply and flags the reader scrolled up

An input that moves nothing, mid-glide, ends the follow for the rest of the reply and flags the reader scrolled up

```probe
cd /home/lyphe/.claude/claudecodeui_lyphe && timeout 200 node /home/lyphe/.claude/state/pipeline-reviews/chat-follow-glide/athena-probes/tap-and-hwheel.mjs
expect: the "sideways wheel" block reads, after one more 400px growth, gap 0 and btn false (today: gap 885, btn true; the touch TAP block shows the same)
```

measured 2026-10-01 by chain chain-chat-follow-glide-20261001-140108-5a55, finding L1, LOW
probe-key: 2df769e2680557cd5f84472532ad91284ce352fd

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/ChatInterface.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatSessionState.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useFollowGlide.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useReplyAnchor.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/utils/landAtMessageTop.ts

## INV-7394 — probe — LOW — in the merged view the summary can sit above its divider

LOW — in the merged view the summary can sit above its divider

```probe
cd /tmp && timeout 100 node /home/lyphe/.claude/state/pipeline-reviews/custom-compaction--marker-fill/athena-probes/s16_marker_summary_order.mjs 2>&1 | tail -3 || echo "dev client :5183 not up"
expect: the second line (seed stamped in the second before the floored swap) reads `old-reply > live-compact-cmd > SUMMARY > DIVIDER > seed-reply` while the defect stands, and `… > DIVIDER > SUMMARY > …` once cured; the first line always reads DIVIDER before SUMMARY
```

measured 2026-10-08 by chain chain-custom-compaction--marker-fill-20261008-120631-e494, finding L1, LOW
probe-key: 3088e4cd962cdae7aa0d594e1d6bca49f5d7e472

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/export/buildTranscriptMarkdown.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatMessages.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/CompactionMarker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/MessageComponent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

## INV-7395 — probe — LOW — MAN-306 still lists `MessageKind` without `compaction`

LOW — MAN-306 still lists `MessageKind` without `compaction`

```probe
docstore get MAN-306 --text 2>&1 | grep -c "compaction" || true
expect: `0` while the row is stale; `1` or more once `compaction` is in the kind list and the consumption table
```

measured 2026-10-08 by chain chain-custom-compaction--marker-fill-20261008-120631-e494, finding L2, LOW
probe-key: e2a22792159c4d9eb5175382cb742307f42d992b

governs: /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/export/buildTranscriptMarkdown.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/hooks/useChatMessages.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/CompactionMarker.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/modules/chat/transcript/MessageComponent.tsx, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/types.ts

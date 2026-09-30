// The live chat's host, and every door into it is a mount or a read. The project-workspace shell wraps
// its tree in the provider, the chat tab renders its chat through the slot — the chat's home, and the
// portal it leaves through — and the workspace frame mounts the floating host beside the FAB.
//
// EXACTLY FOUR THINGS LEAVE, and each is the smallest shape a decision takes across a module
// boundary: the provider that owns the chat's one node, the slot that renders the chat into it, the
// floating host the chat is carried to, and `useChatHost`, the ANSWERS to where the chat is drawn
// (`placement`) and whether a reply waits out of sight (`unread`), and the verbs that move it (`open`,
// `collapse`) and tell it what is around it (`reportAnchor` for the FAB, `reportCovered` for an application
// over the main region). Placement and the unread rule are decided in here alone, so a caller asks where the
// chat is and never holds the node — or the websocket — to work it out.
//
// NOTHING ELSE LEAVES THIS MODULE — not the mechanics hook the slot and the hosts read the node and its
// carriage with, not `moveTo`, not the node, not the anchor store, not the mirror or the geometry utils.
// The node's move is one function announced to every window-bound line of the chat in one order; a
// second export is how a second caller starts moving the chat around it.
export { ChatHostProvider, useChatHost } from '@/modules/chat-host/context/ChatHostContext';
export { ChatHostSlot } from '@/modules/chat-host/ChatHostSlot';
export { ChatHostFloating } from '@/modules/chat-host/ChatHostFloating';

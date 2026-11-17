export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';
export { createCompleteMessage, createNormalizedMessage } from './utils.js';
export type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from './types.js';

// The dispatcher's one subprocess and the field vocabulary its JSON documents are read with — consumed by
// the dispatcher module (verb relay, `status --json` read and its readers) and by the roadmap module
// (its writes, its `roadmap show --json` read), which run the same command and read the same shapes.
export { readDispatcherJson, runDispatcherCommand } from './dispatcher-command.js';
export type { DispatcherCommandDependencies, DispatcherCommandResult } from './dispatcher-command.js';
export { each, field, isCount, isCountOrNull, isFlag, isList, isRecord, isText, isTextOrNull, need, oneOf } from './document-fields.js';

// The one forwarder to shadow-connector's internal-caller-gated surface, and the one place its secret is
// read — consumed by the affected-areas module (the Tours lane), the carrier-bulletins module (the
// bulletins lane) and the upload-runs module (the upload runs' lane), each of which owns its allowlist and
// builds its own forwarder with its own label. Its second verb, `stream`, relays an event stream as it arrives.
export { createShadowConnectorLane } from './shadow-connector-lane.js';
export type { LaneAnswer, LaneRequest, ShadowConnectorLane, ShadowConnectorLaneDependencies } from './shadow-connector-lane.js';
export type { LaneStream, LaneStreamAnswer, LaneStreamRequest } from './shadow-connector-lane-stream.js';
// The allowlist router the lanes' routes files hand their tables to, and the id checks they share.
export { LOWERCASE_UUID_RULE, LOWERCASE_UUID_SOURCE, SHA256_RULE, createLaneRouter, patternRule } from './shadow-connector-lane-router.js';
export type { LaneRoute, LaneRouterDefinition, LaneRule } from './shadow-connector-lane-router.js';

export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';
export { createCompleteMessage, createNormalizedMessage } from './utils.js';
export type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from './types.js';

// The dispatcher's one subprocess and the field vocabulary its JSON documents are read with — consumed by
// the dispatcher module (verb relay, `status --json` read and its readers) and by the roadmap module
// (its writes, its `roadmap show --json` read), which run the same command and read the same shapes.
export { readDispatcherJson, runDispatcherCommand } from './dispatcher-command.js';
export type { DispatcherCommandDependencies, DispatcherCommandResult } from './dispatcher-command.js';
export { each, field, isCount, isCountOrNull, isFlag, isList, isRecord, isText, isTextOrNull, need, oneOf } from './document-fields.js';

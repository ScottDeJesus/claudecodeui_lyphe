// createMemoryIntakeModule: used by the server entrypoint to mount the authenticated memory-intake
// lane at `/api/memory` — the proposals a session made, and the two reviews a person performs.
export { createMemoryIntakeModule } from './memory-intake.module.js';

// The lane's verbs, exported as a barrel for the callers that live outside it: a spill sweep stages
// through `validateMemoryArgs` + `stageMemoryCandidate`, and nothing outside this module reaches a
// repository or a filesystem path of its own.
export {
  MEMORY_TARGETS,
  approveMemoryCandidate,
  getMemoryCandidate,
  listMemoryCandidates,
  memoryIntakeService,
  rejectMemoryCandidate,
  stageMemoryCandidate,
  validateMemoryArgs,
} from './memory.service.js';
export type { MemoryCandidateInput, MemoryIntakeService, MemoryTarget } from './memory.service.js';
// The refusal class and the writer, re-exported from their own home in `memory-assert.ts`: a caller
// that needs to recognise a refusal catches the class this barrel hands it, never a copy.
export { MemoryRefusal, assertIntoTarget } from './memory-assert.js';

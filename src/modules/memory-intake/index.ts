// The memory-intake module's whole public surface: the provider App mounts, the reading the
// workspace tab gates and the command palette ask for, and the panel the Memory tab renders.
export { MemoryIntakeProvider } from '@/modules/memory-intake/context/MemoryIntakeContext';
export { useMemoryIntake } from '@/modules/memory-intake/context/MemoryIntakeContext';
export { MemoryIntakePanel } from '@/modules/memory-intake/MemoryIntakePanel';

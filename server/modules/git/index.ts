// createGitModule: used by the server entrypoint to assemble Git routes with provider runtimes.
export { createGitModule } from './git.module.js';
// readGitStatus, readGitFileDiff: used by the companion module's read_git tool, which reads a project's uncommitted work through the same reader the git panel uses.
export { readGitFileDiff, readGitStatus } from './git-status.service.js';
// getRepositoryRootPath: used by the companion module's read_git tool (`eyes/git-reads.ts`). `git status` paths are relative to the REPOSITORY ROOT, which is not the
// project folder when the project is a subfolder of its repository, so the tool joins them to this root to judge a changed file against the deny rule on its real path.
export { getRepositoryRootPath } from './git-repository.service.js';
// readHeadFileSize: used by the companion module's read_git tool (`eyes/git-reads.ts`) to size a DELETED file's blob in HEAD before `readGitFileDiff` reads it whole.
export { readHeadFileSize } from './git-repository.service.js';

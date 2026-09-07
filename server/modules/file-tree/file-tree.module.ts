import { randomUUID } from 'node:crypto';
import fs, { promises as fsPromises } from 'node:fs';
import os from 'node:os';

import express from 'express';
import mime from 'mime-types';
import multer from 'multer';

import { projectsDb } from '@/modules/database/index.js';
import { createFileTreeListingService } from '@/modules/file-tree/file-tree-listing.service.js';
import { createFileTreeListingRouter, createFileTreeRouter } from '@/modules/file-tree/file-tree.routes.js';
import { createFileTreeService } from '@/modules/file-tree/file-tree.service.js';
import type {
  FileTreeFileSystem,
  FileTreeLogger,
  FileTreeProjectGateway,
  FileTreeWorkspaceGateway,
} from '@/shared/types.js';
import { AppError, WORKSPACES_ROOT, validateWorkspacePath } from '@/shared/utils.js';

const MAXIMUM_UPLOAD_SIZE_MEGABYTES = 100;
const MAXIMUM_UPLOAD_SIZE_BYTES = MAXIMUM_UPLOAD_SIZE_MEGABYTES * 1024 * 1024;
const MAXIMUM_UPLOAD_FILE_COUNT = 20;

function readFileSystemConcurrency(): number {
  const configuredConcurrency = Number.parseInt(process.env.FS_CONCURRENCY ?? '', 10);
  return Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : 64;
}

/**
 * Production filesystem adapter owned by the File Tree composition root.
 * Application services receive this complete capability explicitly and never
 * import Node's mutable filesystem APIs themselves.
 */
const fileTreeFileSystem: FileTreeFileSystem = {
  access: (candidatePath) => fsPromises.access(candidatePath),
  stat: (candidatePath) => fsPromises.stat(candidatePath),
  lstat: (candidatePath) => fsPromises.lstat(candidatePath),
  // `opendir` streams entries in batches and the handle is closed by the
  // iterator protocol, including when the caller stops early at the entry cap.
  openDirectory: async function* (directoryPath) {
    yield* await fsPromises.opendir(directoryPath);
  },
  realpath: (candidatePath) => fsPromises.realpath(candidatePath),
  readTextFile: (filePath) => fsPromises.readFile(filePath, 'utf8'),
  writeTextFile: (filePath, content) => fsPromises.writeFile(filePath, content, 'utf8'),
  async makeDirectory(directoryPath, recursive) {
    await fsPromises.mkdir(directoryPath, { recursive });
  },
  rename: (oldPath, newPath) => fsPromises.rename(oldPath, newPath),
  async removeDirectory(directoryPath) {
    await fsPromises.rm(directoryPath, { recursive: true, force: true });
  },
  unlink: (filePath) => fsPromises.unlink(filePath),
  copyFile: (sourcePath, destinationPath, exclusive) => fsPromises.copyFile(
    sourcePath,
    destinationPath,
    exclusive ? fs.constants.COPYFILE_EXCL : 0,
  ),
  createReadStream: (filePath) => fs.createReadStream(filePath),
};

/**
 * Database boundary used only by File Tree production composition.
 * The Database module is consumed through its barrel; services and routes see
 * only the narrow project-path lookup contract.
 */
const fileTreeProjects: FileTreeProjectGateway = {
  getProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
};

/**
 * Workspace-policy boundary used only by File Tree production composition.
 * Keeping both the configured root and symlink-aware validator together makes
 * the path policy explicit for every service instance.
 */
const fileTreeWorkspace: FileTreeWorkspaceGateway = {
  rootPath: WORKSPACES_ROOT,
  validatePath: (candidatePath) => validateWorkspacePath(candidatePath),
};

/**
 * The MIME resolver both File Tree services receive.
 *
 * An extension the table does not know falls back to `application/octet-stream`,
 * which the preview service reads as "the name told us nothing" and settles by
 * looking at the file's own bytes.
 */
const resolveFileMimeType = (filePath: string): string => mime.lookup(filePath) || 'application/octet-stream';

const fileTreeLogger: FileTreeLogger = {
  error: (message, error) => console.error(message, error),
};

const fileTreeServices = createFileTreeService({
  fileSystem: fileTreeFileSystem,
  projects: fileTreeProjects,
  workspace: fileTreeWorkspace,
  resolveMimeType: resolveFileMimeType,
  fileSystemConcurrency: readFileSystemConcurrency(),
  logger: fileTreeLogger,
});

/**
 * Directory listing and file preview, composed beside the browsing service.
 *
 * The project-root resolver is built here rather than reused from the browsing
 * service so the two answer an unknown project id identically — a 404 — without
 * either one importing the other.
 */
const fileTreeListingServices = createFileTreeListingService({
  resolveProjectRoot: async (projectId) => {
    const projectRoot = await fileTreeProjects.getProjectPathById(projectId);
    if (!projectRoot) {
      throw new AppError('Project not found', { statusCode: 404, code: 'PROJECT_NOT_FOUND' });
    }
    return projectRoot;
  },
  resolveMimeType: resolveFileMimeType,
  fileSystem: fileTreeFileSystem,
});

const fileUploadMiddleware = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_request, _file, callback) => {
      callback(null, `cloudcli-file-upload-${randomUUID()}`);
    },
  }),
  limits: {
    // Busboy refuses AT the limit rather than past it, so a file of exactly
    // MAXIMUM_UPLOAD_SIZE_BYTES would be turned away by a message naming that very size as
    // the maximum. One byte higher makes the stated maximum genuinely allowed.
    fileSize: MAXIMUM_UPLOAD_SIZE_BYTES + 1,
    files: MAXIMUM_UPLOAD_FILE_COUNT,
  },
}).array('files', MAXIMUM_UPLOAD_FILE_COUNT);

/**
 * File Tree router used by the server entrypoint to mount the authenticated
 * browsing, editing, file-management, upload, listing, and preview API under
 * `/api/file-tree`.
 *
 * Two routers, one namespace: each is built from the service that answers it.
 */
export const fileTreeRoutes = express.Router();

fileTreeRoutes.use(createFileTreeRouter(
  fileTreeServices,
  fileUploadMiddleware,
  {
    maximumFileSizeMegabytes: MAXIMUM_UPLOAD_SIZE_MEGABYTES,
    maximumFileCount: MAXIMUM_UPLOAD_FILE_COUNT,
  },
  fileTreeLogger,
));

fileTreeRoutes.use(createFileTreeListingRouter(fileTreeListingServices, fileTreeLogger));

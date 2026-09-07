export { default as FileTree } from '@/modules/file-tree/FileTree';
// The file-manager module composes the tree beside its own panes and uploads into the directory
// it is showing, so it needs the same upload hook the tree drives itself.
export { useFileTreeUpload } from '@/modules/file-tree/hooks/useFileTreeUpload';

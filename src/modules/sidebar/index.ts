export { default as Sidebar } from '@/modules/sidebar/Sidebar';
export { SidebarSessionPicker } from '@/modules/sidebar/SidebarSessionPicker';
// The simple chat list as a board, a column per folder: project-workspace's sessions home (`WorkspaceHome`) draws it across the page.
export { SessionsBoard } from '@/modules/sidebar/board/SessionsBoard';
// The same list as a hoop round the companion's core, a slot per chat: the station's scene (`StationKaylee`) stands the core in its middle.
export { SessionsHalo } from '@/modules/sidebar/board/SessionsHalo';
export { haloHeightFor, haloMiddle } from '@/modules/sidebar/utils/haloPainter';

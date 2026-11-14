// createBootReportModule: used by the server entrypoint to mount the public `/api/boot-report` door, where the inline boot
// reporter in index.html (and the app's root error boundary) post why a page did not draw; one journal line per report.
export { createBootReportModule } from './boot-report.module.js';

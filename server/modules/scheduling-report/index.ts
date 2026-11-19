// createSchedulingReportModule: used by the server entrypoint to mount the authenticated scheduling report
// lane at `/api/scheduling-report` — the allowlisted three GET routes of the eis backend's scheduling record
// (the window's overview, one entry whole, and the feed that says the record changed), forwarded over
// loopback to :8004 with the internal secret held on this side. Every JSON body is the backend's own,
// carried whole; the feed is relayed as it arrives.
export { createSchedulingReportModule } from './scheduling-report.module.js';

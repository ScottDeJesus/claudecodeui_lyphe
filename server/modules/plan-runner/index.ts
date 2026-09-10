// createPlanRunnerModule: used by the server entrypoint to mount the authenticated plan-runner lane at
// `/api/plan-runner` — the poll behind the `runner_state` frame, and the relay for the runner's own stop/resume.
export { createPlanRunnerModule } from './plan-runner.module.js';

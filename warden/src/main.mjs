// The warden's one entry point: `node warden/src/main.mjs <verb> [flags]`, run by bare `node` (>= 22)
// with no loader and no dependency, the posture of `deploy/dev-supervisor/*.mjs`.
//
//   enroll --center <url> --name <name> --token <token>   become a node of the Cerberus at <url>
//   run                                                    the daemon: link, outbox, probes, fixes and the session host, until SIGTERM
//   status                                                 print the identity, the version and the last run
//
// A verb answers with its exit code: 0 done, 1 refused or failed (the reason printed), 2 misused.
import { runDaemon } from './daemon.mjs';
import { runEnroll } from './enroll.mjs';
import { runStatus } from './status.mjs';

const VERBS = {
  enroll: {
    flags: ['center', 'name', 'token'],
    usage: 'enroll --center <url> --name <name> --token <token>',
    run: async ({ center, name, token }) => {
      if (!/^https?:\/\/[^/\s]+/.test(center)) {
        console.log(`--center must be an http(s) address such as http://100.64.0.1:3012, not "${center}"`);
        return 2;
      }
      return runEnroll({ center: center.replace(/\/+$/, ''), name, token });
    },
  },
  run: { flags: [], usage: 'run', run: async () => runDaemon() },
  status: { flags: [], usage: 'status', run: async () => runStatus() },
};

/** `--flag value` pairs into an object, or the sentence saying what is wrong with them. */
function readFlags(argv, verb) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const name = flag.startsWith('--') ? flag.slice(2) : null;
    if (name === null || !verb.flags.includes(name)) return { problem: `Unknown argument "${flag}"` };
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) return { problem: `${flag} needs a value` };
    values[name] = argv[index + 1];
  }
  const missing = verb.flags.filter((name) => !values[name]);
  return missing.length ? { problem: `Missing ${missing.map((name) => `--${name}`).join(', ')}` } : { values };
}

const [requestedVerb, ...verbArguments] = process.argv.slice(2);

async function main() {
  const verb = Object.hasOwn(VERBS, requestedVerb ?? '') ? VERBS[requestedVerb] : null;
  if (!verb) {
    console.log(`Usage: node warden/src/main.mjs <verb>\n${Object.values(VERBS).map((each) => `  ${each.usage}`).join('\n')}`);
    return 2;
  }
  const { values, problem } = readFlags(verbArguments, verb);
  if (problem) {
    console.log(`${problem}\nUsage: node warden/src/main.mjs ${verb.usage}`);
    return 2;
  }
  return verb.run(values);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.log(`[warden] ${requestedVerb} failed: ${error.message}`);
    process.exit(1);
  }
);

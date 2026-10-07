// What a diagnosis may NOT carry back to center: the paths that hold secrets, and the credential patterns
// inside text that is otherwise fine. A diagnosis's reads go to a model and into the store, so the warden
// refuses at the source — center is never trusted to scrub.
//
//   DENYLIST  judged on the path as asked AND on its `fs.realpathSync` (a symlink named `notes.txt` that points at
//             `.env` is the `.env`, and one named `.env` that points elsewhere is still refused): a basename ending `.env`
//             (`.env`, `.eis_backend.env`) or holding `.env.` (`.env.local`), `*.pem`, `*.key`, `*.p12`, `id_*`, `.pgpass`,
//             `.netrc`, `credentials*` and `.credentials*`, `.git-credentials`, `auth.json` and `auth-profiles.json`, `.claude.json*`
//             (its copies too), a shell or client history file (`.bash_history`, `.psql_history` …); anything under `~/.ssh`, `~/.cerberus-warden/keys`, this
//             warden's own `<home>/keys`, `~/.claude/.credentials.json`, `~/.docker/config.json`, `~/.npmrc`, `/etc/shadow`,
//             `/etc/ssh`, `/root`, and the transcripts of the operator's sessions: the journals in `~/.cerberus-warden/sessions`
//             and `<home>/sessions`, `~/.claude/projects`, `~/.claude/history.jsonl`, `~/.codex/sessions`,
//             `~/.openclaw/agents/<agent>/sessions` and `~/.cloudcli` (its accounts and its database). The answer is
//             "Refused: <path> may hold a secret" and nothing of the file is read.
//   MASKING   every text a diagnosis returns goes through `maskSecrets`: `password=hunter2` becomes `password=<masked>`, and so does
//             any name that carries a credential word (`DB_PASS=`, `SECRET_ACCESS_KEY=`, a JSON `"key":`); a URL's password
//             (`scheme://user:<masked>@host`), a `Bearer` or `Basic` value, a JWT and a private-key block go too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET_BASENAMES = [
  // `.env` and every `<name>.env` (shadow-connector's `.eis_backend.env`), and `.env.local` or `app.env.production`.
  /\.env$/i,
  /\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /^id_/i,
  /^\.pgpass$/i,
  /^\.netrc$/i,
  /^\.?credentials/i,
  /^\.git-credentials$/i,
  // An agent's stored provider keys (`~/.openclaw/agents/main/agent/auth.json`, `auth-profiles.json`).
  /^auth(-profiles)?\.json$/i,
  // Claude's account and project state, and every copy of it (`.claude.json.bak-*`, `backups/.claude.json.backup.*`).
  /^\.claude\.json/i,
  // What a person typed at a prompt: `curl -H "Authorization: Bearer …"`, `psql postgres://user:pw@host`.
  /^\.[\w-]*_history$/i,
  /^\.history$/i,
];

/** `~/.openclaw/agents/<agent>/sessions` for every agent that is there: the one root a glob would name. */
function openclawSessionRoots(account) {
  const agents = path.join(account, '.openclaw', 'agents');
  try {
    return fs.readdirSync(agents).map((agent) => path.join(agents, agent, 'sessions'));
  } catch {
    return []; // no agents directory on this node: there is no transcript to refuse
  }
}

/** The directories and files whose whole subtree is refused, for the account the warden runs as. */
function secretRoots(wardenHome) {
  const account = os.homedir();
  return [
    path.join(account, '.ssh'),
    path.join(account, '.cerberus-warden', 'keys'),
    path.join(wardenHome, 'keys'),
    path.join(account, '.cerberus-warden', 'sessions'),
    path.join(wardenHome, 'sessions'),
    // The operator's other session transcripts: the same reason the warden's own journals are refused.
    path.join(account, '.claude', 'projects'),
    path.join(account, '.claude', 'history.jsonl'),
    path.join(account, '.codex', 'sessions'),
    path.join(account, '.cloudcli'),
    ...openclawSessionRoots(account),
    path.join(account, '.claude', '.credentials.json'),
    path.join(account, '.docker', 'config.json'),
    path.join(account, '.npmrc'),
    '/etc/shadow',
    '/etc/ssh',
    '/root',
  ];
}

/** The real path of `target` when it exists, else `target` itself: a root that is not there cannot hide anything. */
function realOrSelf(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

function isUnder(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** Whether any of `candidates` (absolute paths) is a secret-bearing name or lies inside a secret-bearing root. */
function holdsSecret(candidates, wardenHome) {
  const roots = secretRoots(wardenHome).flatMap((root) => [root, realOrSelf(root)]);
  return candidates.some((candidate) => {
    if (SECRET_BASENAMES.some((pattern) => pattern.test(path.basename(candidate)))) return true;
    return roots.some((root) => isUnder(candidate, root));
  });
}

/**
 * The path a read may open, or the sentence refusing it.
 * `{ requested, real }` — `requested` the absolute path as asked (a leading `~/` is the account's home), `real` its
 * `realpathSync` — or `{ refusal }`. A path that does not exist or cannot be reached is refused with the reason, never thrown.
 */
export function resolveReadable(input, wardenHome) {
  if (typeof input !== 'string' || input === '' || input.length > 4096 || input.includes('\0')) {
    return { refusal: 'path must be a non-empty text of at most 4096 characters' };
  }
  const expanded = input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input;
  if (!path.isAbsolute(expanded)) return { refusal: `path must be absolute, not "${input}"` };
  const requested = path.resolve(expanded);
  // The requested path is judged first: a name that is a secret's must not even be followed.
  if (holdsSecret([requested], wardenHome)) return { refusal: `Refused: ${requested} may hold a secret` };
  let real;
  try {
    real = fs.realpathSync(requested);
  } catch (error) {
    return { refusal: error.code === 'ENOENT' ? `No such file or directory: ${requested}` : `Cannot reach ${requested} (${error.code ?? error.name})` };
  }
  if (holdsSecret([real], wardenHome)) return { refusal: `Refused: ${requested} may hold a secret` };
  return { requested, real };
}

const MASKED = '<masked>';
/**
 * A credential word, its name's tail (up to 40 characters after a separator or after `key`/`id`/`value`/`access`: `_KEY`,
 * `_ACCESS_KEY`, `Key` in `secretKey`), `=` or `:`, and the value. The value may be a `<masked>` already: it is taken
 * as it stands, so a second pass leaves `"token":<masked>,"err":1}` whole instead of eating the rest of the line.
 * `pass` and `pwd` count only as a whole word (`DB_PASS`, `pwd=`), and `key` only as a quoted JSON or dict key; the credential
 * words take a plural `s` (`API_KEYS`, `secrets`) but `token` does not (`max_tokens`). So prose and counters (`passed`,
 * `bypass`, `max_tokens`, `key: value` in a YAML) are left alone. Every quantifier is bounded.
 */
const KEY_WORD_VALUE =
  /((?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?key|private[_-]?key)s?|token|(?<![A-Za-z])(?:pass|pwd)(?![A-Za-z])|(?<=["'])key(?=["']\s*:))((?:(?:[_.-]|key|id|value|access)[A-Za-z0-9_.-]{0,40})?["']?\s*[=:]\s*)(?:<masked>|"[^"\n]*"|'[^'\n]*'|\S+)/gi;

/**
 * `password=hunter2` → `password=<masked>`; the same for passwd, passphrase, secret, token, api / access / private key
 * (`api_key`, `access-key`), `pass` and `pwd` standing alone, and a JSON `"key"`, `:` or `=`, any case; the value is a quoted
 * text (spaces and all) or the next run of non-space characters. The key word may sit inside a longer name: a separator, or
 * a camelCase `Key`/`Id`/`Value`/`Access`, and up to 40 more characters of it (`DB_PASS`, `SECRET_KEY`, `secretKey`,
 * `AWS_SECRET_ACCESS_KEY`, `token_secret`), and the credential words take a plural (`API_KEYS`, `secrets`); `passed`,
 * `bypass` and `max_tokens` are words, not names, and stay. A closing quote of a JSON key stays. Beyond the key words, four shapes
 * that carry a credential with no key word beside them:
 *   `scheme://user:pw@host`   the password (a lone userinfo of 20 or more characters is a token and goes whole)
 *   `Bearer <t>`, `Basic <t>`  the value, from 16 characters
 *   `eyJ….….…`                 a JWT
 *   `-----BEGIN … PRIVATE KEY-----` to its END line, or to the end of the text when a cut took the END line
 * Running it twice changes nothing more, which is what lets a text be masked at its source and again as it leaves. Every
 * quantifier that can start at many places is bounded (a scheme is at most 16 characters, a JWT part at most 8 KB), so a
 * log line made of `a.a.a.a…` or `eyJeyJ…` costs a scan, never a stall of the event loop the heartbeat shares.
 */
export function maskSecrets(text) {
  return String(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASKED)
    .replace(KEY_WORD_VALUE, `$1$2${MASKED}`)
    .replace(/(\b[a-z][a-z0-9+.-]{0,15}:\/\/)([^\s/@]{1,512})@/gi, (whole, scheme, userinfo) => {
      const colon = userinfo.indexOf(':');
      if (colon >= 0) return `${scheme}${userinfo.slice(0, colon)}:${MASKED}@`;
      return userinfo.length >= 20 ? `${scheme}${MASKED}@` : whole;
    })
    .replace(/\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{16,}/gi, `$1$2${MASKED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,512}\.[A-Za-z0-9_-]{4,8192}\.[A-Za-z0-9_-]{0,512}/g, MASKED);
}

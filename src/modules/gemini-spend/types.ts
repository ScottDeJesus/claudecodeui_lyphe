/** The window both doors answer for: one of the three and nothing else. A day inside it is a UTC date. */
export type GeminiRange = 'today' | '7d' | '30d';

/** The two doors the panel reads: the connector's /api/gemini-usage (through its lane) and CloudCLI's own /api/gemini-meter. */
export type GeminiDoor = 'connector' | 'meter';

/**
 * One feature as either door lists it: the one snake_case row both doors serve, so one row component draws both.
 * cost_usd is an estimate at list prices and is null when no model of the row has a rate; unmeasured_calls counts
 * answered calls whose answer carried no usage of Google's own.
 */
export type FeatureRow = {
  feature: string;
  label: string;
  enabled: boolean;
  calls: number;
  failures: number;
  unmeasured_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  models: string[];
  last_at: string | null;
};

/** One key as either door lists it: its last four characters and the names that hold it. The key itself is nowhere. */
export type KeyRow = { key: string; held_as: string[]; calls: number; cost_usd: number | null };

/** One budget of the connector's door: a plan's, a chain's or a chat's. */
export type BudgetRow = { budget: string; calls: number; cost_usd: number | null; last_at: string | null };

/** One process of the connector's door, by the name it gave itself. */
export type ProcessRow = { process: string; calls: number; cost_usd: number | null };

/** One project of the connector's door. master is Restorly's own switch, and null for shadow-connector. */
export type ConnectorProject = {
  project: 'restorly' | 'shadowconnector';
  master: { key: string; enabled: boolean } | null;
  cost_usd: number;
  calls: number;
  features: FeatureRow[];
};

/** The body of GET /api/gemini-usage/usage, as the connector serves it: the lane never reshapes it. */
export type ConnectorUsage = {
  account_id: string;
  range: GeminiRange;
  from: string;
  to: string;
  cost_basis: string;
  total_usd: number;
  production_usd: number;
  budgets_usd: number;
  projects: ConnectorProject[];
  days: { date: string; production_usd: number; budgets_usd: number }[];
  budgets: BudgetRow[];
  keys: KeyRow[];
  processes: ProcessRow[];
  unpriced_models: string[];
  /** The callers on the operator's Claude login, counted and never priced; null when the service holds more than one account. */
  claude_login?: ClaudeLoginUsage | null;
};

/** One caller on the Claude login (the job stage reader, the bulletin page check, the demo-sheet transcriber) over the window. */
export type ClaudeLoginSite = {
  site: string;
  label: string;
  calls: number;
  failures: number;
  input_tokens: number;
  output_tokens: number;
  models: string[];
  last_at: string | null;
};

export type ClaudeLoginUsage = { sites: ClaudeLoginSite[] };

/** The body of GET /api/gemini-meter/usage: the signed-in account's rows of CloudCLI's own meter. */
export type MeterUsage = {
  range: GeminiRange;
  from: string;
  to: string;
  cost_basis: string;
  project: 'cloudcli';
  /** An estimate at list prices; null when rows exist and no model of theirs has a rate (a null adds nothing to the total). */
  cost_usd: number | null;
  calls: number;
  features: FeatureRow[];
  days: { date: string; cost_usd: number | null }[];
  keys: KeyRow[];
  unpriced_models: string[];
};

/** One door as the panel holds it: not read yet, answered, or its sentence. Never a guessed body. An answer carries readAt, the ISO moment it
 * landed, so a page left open can say how old its figures are. */
export type DoorRead<Body> = { state: 'reading' } | { state: 'answered'; body: Body; readAt: string } | { state: 'failed'; sentence: string };

/** What useGeminiUsage hands the panel: both doors, the switches that are out, and the three presses. */
export type GeminiUsageView = {
  connector: DoorRead<ConnectorUsage>;
  meter: DoorRead<MeterUsage>;
  /** The switches whose press is out, each by switchId(door, feature): held until its door reads back. */
  held: ReadonlySet<string>;
  /** The last press a door refused, in words; null once it is dismissed or the next press lands. */
  pressFailure: { label: string; sentence: string } | null;
  setSwitch: (door: GeminiDoor, feature: string, enabled: boolean) => void;
  dismissPressFailure: () => void;
  refresh: () => void;
};

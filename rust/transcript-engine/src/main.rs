//! The transcript engine: reads Claude transcripts for the server's one door to it,
//! `server/modules/transcript-engine/`. Every verb writes the header line first, then one JSON
//! record per line. Exit 0: every record was written; 2: the job could not be read; 3: the one
//! file `usage` reads could not be read. A closed stdout (EPIPE or ECONNRESET) ends the program quietly, and SIGTERM
//! keeps its default action, which ends it without a word.

mod lines;
mod search;
mod titles;
mod usage;

use std::io::{self, BufWriter, Write};
use std::process::ExitCode;

/// Changes together with `TRANSCRIPT_ENGINE_PROTOCOL` in
/// `server/modules/transcript-engine/engine-process.ts` whenever a verb's input or output changes.
const PROTOCOL: u32 = 1;
const ENGINE: &str = "transcript-engine";
const VERSION: &str = env!("CARGO_PKG_VERSION");

/// The widest pool --threads may ask for; twin of TRANSCRIPT_ENGINE_MAX_THREADS in
/// server/modules/transcript-engine/engine-process.ts. Far wider widths make rayon's pool start-up run without end.
const MAX_THREADS: usize = 256;

const EXIT_JOB_UNREADABLE: u8 = 2;
const EXIT_FILE_UNREADABLE: u8 = 3;

/// Why a verb stopped before writing every record.
pub enum VerbError {
    /// The job (its arguments or its stdin) could not be read: exit 2.
    Job(String),
    /// The one file the verb reads could not be read: exit 3.
    File(String),
    /// stdout could not be written; a broken pipe means the reader left.
    Output(io::Error),
}

impl From<io::Error> for VerbError {
    fn from(error: io::Error) -> Self {
        VerbError::Output(error)
    }
}

/// A verb: its arguments after the verb's name, and the stream its records go to.
type Verb = fn(&[String], &mut dyn Write) -> Result<(), VerbError>;

enum Command {
    Version,
    Run { threads: Option<usize>, verb: String, rest: Vec<String> },
}

fn main() -> ExitCode {
    let command = match parse_command(std::env::args().skip(1).collect()) {
        Ok(command) => command,
        Err(reason) => return fail(EXIT_JOB_UNREADABLE, &reason),
    };
    let stdout = io::stdout();
    let mut out = BufWriter::new(stdout.lock());
    let outcome = match command {
        Command::Version => writeln!(out, "{ENGINE} {VERSION} protocol {PROTOCOL}").map_err(VerbError::from),
        Command::Run { threads, verb, rest } => run(threads, &verb, &rest, &mut out),
    };
    finish(outcome.and_then(|()| out.flush().map_err(VerbError::from)))
}

fn parse_command(args: Vec<String>) -> Result<Command, String> {
    let mut threads = None;
    let mut positional = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--version" => return Ok(Command::Version),
            "--threads" => {
                let value = args.next().ok_or("--threads needs a number")?;
                let width = value
                    .parse::<usize>()
                    .ok()
                    .filter(|width| (1..=MAX_THREADS).contains(width))
                    .ok_or_else(|| format!("--threads {value:?} is not a whole number from 1 to {MAX_THREADS}"))?;
                threads = Some(width);
            }
            _ => positional.push(arg),
        }
    }
    let mut positional = positional.into_iter();
    let verb = positional.next().ok_or("no verb was given")?;
    Ok(Command::Run { threads, verb, rest: positional.collect() })
}

fn run(threads: Option<usize>, verb: &str, rest: &[String], out: &mut dyn Write) -> Result<(), VerbError> {
    // One arm per verb.
    let run_verb: Verb = match verb {
        "usage" => usage::run,
        "search" => search::run,
        "titles" => titles::run,
        other => return Err(VerbError::Job(format!("unknown verb {other:?}"))),
    };
    if let Some(width) = threads {
        rayon::ThreadPoolBuilder::new()
            .num_threads(width)
            .build_global()
            .map_err(|error| VerbError::Job(format!("{width} threads could not be started: {error}")))?;
    }
    write_header(out, verb)?;
    run_verb(rest, out)
}

fn write_header(out: &mut dyn Write, verb: &str) -> Result<(), VerbError> {
    let header = serde_json::json!({ "engine": ENGINE, "protocol": PROTOCOL, "verb": verb });
    serde_json::to_writer(&mut *out, &header).map_err(io::Error::from)?;
    out.write_all(b"\n")?;
    Ok(())
}

fn finish(outcome: Result<(), VerbError>) -> ExitCode {
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(VerbError::Output(error)) if is_reader_gone(&error) => ExitCode::SUCCESS,
        Err(VerbError::Output(error)) => fail(EXIT_JOB_UNREADABLE, &format!("stdout could not be written: {error}")),
        Err(VerbError::Job(reason)) => fail(EXIT_JOB_UNREADABLE, &reason),
        Err(VerbError::File(reason)) => fail(EXIT_FILE_UNREADABLE, &reason),
    }
}

/// The reader closed its end: EPIPE on a pipe, or ECONNRESET on the socketpair Node's `spawn` gives a
/// child as its stdio (the reset happens when the reader leaves with output still unread).
fn is_reader_gone(error: &io::Error) -> bool {
    matches!(error.kind(), io::ErrorKind::BrokenPipe | io::ErrorKind::ConnectionReset)
}

fn fail(code: u8, reason: &str) -> ExitCode {
    eprintln!("{ENGINE}: {reason}");
    ExitCode::from(code)
}

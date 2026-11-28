//! 'transcript-engine search': its job on stdin,
//! {"words":[…],"maxPerSession":n,"transparentWrappers":[…],"files":[{"path":…,"sessions":[…]}]},
//! and one record per file in input order: {"i":n} when the gate refuses the file or no row of it is
//! a hit, {"i":n,"error":…} when it cannot be read, else {"i":n,"summaries":{…},"matches":[…]}.
//! Its caller is server/modules/providers/services/session-conversations-engine.ts, through the door.
//!
//! Files are read in parallel; a record is written only after every record before it, and a file is
//! started only while fewer than HELD_AHEAD_PER_THREAD records per thread stand between it and the
//! record being waited for, so one slow early file cannot fill memory with later ones.

mod claude_row;
mod gate;
mod matcher;
mod row;
mod session_state;

use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Condvar, Mutex, PoisonError};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::lines::{lines, with_file_bytes};
use crate::VerbError;
use claude_row::RowReader;
use gate::Gate;
use matcher::Matcher;
use session_state::FileState;

const HELD_AHEAD_PER_THREAD: usize = 4;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    words: Vec<String>,
    max_per_session: usize,
    transparent_wrappers: Vec<String>,
    files: Vec<FileEntry>,
}

#[derive(Deserialize)]
struct FileEntry {
    path: String,
    /// The provider session ids whose rows this file is searched for.
    sessions: Vec<String>,
}

pub fn run(args: &[String], out: &mut dyn Write) -> Result<(), VerbError> {
    if !args.is_empty() {
        return Err(VerbError::Job("search reads its job from stdin and takes no arguments".into()));
    }
    let job = read_job()?;
    let searcher = Searcher::new(&job).map_err(VerbError::Job)?;
    write_in_order(job.files.len(), &|index| searcher.record_of(index, &job.files[index]).to_string(), out)
}

fn read_job() -> Result<Job, VerbError> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| VerbError::Job(format!("the job could not be read from stdin: {error}")))?;
    let job: Job = serde_json::from_str(&input).map_err(|error| VerbError::Job(format!("the job is not a search job: {error}")))?;
    if job.words.is_empty() || job.words.iter().any(String::is_empty) {
        return Err(VerbError::Job("the job's words are empty".into()));
    }
    Ok(job)
}

/// What every file of one job is read with.
struct Searcher {
    gate: Gate,
    matcher: Matcher,
    reader: RowReader,
    max_per_session: usize,
}

impl Searcher {
    fn new(job: &Job) -> Result<Self, String> {
        Ok(Self {
            gate: Gate::new(&job.words)?,
            matcher: Matcher::new(&job.words)?,
            reader: RowReader::new(job.transparent_wrappers.clone()),
            max_per_session: job.max_per_session,
        })
    }

    fn record_of(&self, index: usize, entry: &FileEntry) -> Value {
        let path = Path::new(&entry.path);
        if !path.is_absolute() {
            return json!({ "i": index, "error": format!("{} is not an absolute path", entry.path) });
        }
        with_file_bytes(path, |bytes| self.search_bytes(index, bytes, &entry.sessions))
            .unwrap_or_else(|error| json!({ "i": index, "error": format!("{} could not be read: {error}", path.display()) }))
    }

    fn search_bytes(&self, index: usize, bytes: &[u8], sessions: &[String]) -> Value {
        if !self.gate.admits(bytes) {
            return json!({ "i": index });
        }
        let mut state = FileState::new(sessions, self.max_per_session);
        for line in lines(bytes) {
            if let Some(row) = row::parse(&line) {
                state.read_row(&row, &self.reader, &self.matcher);
            }
        }
        state.into_record(index)
    }
}

/// The hand-off between the pool's workers and the one thread that writes.
struct Order {
    next_claim: AtomicUsize,
    written: Mutex<usize>,
    room: Condvar,
    stopped: AtomicBool,
}

fn write_in_order(count: usize, record_line: &(dyn Fn(usize) -> String + Sync), out: &mut dyn Write) -> Result<(), VerbError> {
    let width = rayon::current_num_threads().max(1);
    let window = width * HELD_AHEAD_PER_THREAD;
    let order = Order { next_claim: AtomicUsize::new(0), written: Mutex::new(0), room: Condvar::new(), stopped: AtomicBool::new(false) };
    let (sender, receiver) = mpsc::channel::<(usize, String)>();
    std::thread::scope(|scope| {
        let order = &order;
        // The pool runs on its own threads; this one only writes, so it never takes a worker's place.
        scope.spawn(move || {
            rayon::scope(|pool| {
                for _ in 0..width {
                    let sender = sender.clone();
                    pool.spawn(move |_| order.work(count, window, record_line, &sender));
                }
            });
        });
        write_records(&receiver, order, out)
    })
}

impl Order {
    fn work(&self, count: usize, window: usize, record_line: &(dyn Fn(usize) -> String + Sync), sender: &mpsc::Sender<(usize, String)>) {
        loop {
            let index = self.next_claim.fetch_add(1, Ordering::Relaxed);
            if index >= count || !self.wait_for_room(index, window) {
                return;
            }
            if sender.send((index, record_line(index))).is_err() {
                return;
            }
        }
    }

    /// Waits until 'index' is within the window of the record being waited for; false once the writer stopped.
    fn wait_for_room(&self, index: usize, window: usize) -> bool {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        while index >= *written + window && !self.stopped.load(Ordering::Acquire) {
            written = self.room.wait(written).unwrap_or_else(PoisonError::into_inner);
        }
        !self.stopped.load(Ordering::Acquire)
    }

    fn advance(&self, written: usize) {
        *self.written.lock().unwrap_or_else(PoisonError::into_inner) = written;
        self.room.notify_all();
    }

    fn stop(&self) {
        let _written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        self.stopped.store(true, Ordering::Release);
        self.room.notify_all();
    }
}

fn write_records(receiver: &mpsc::Receiver<(usize, String)>, order: &Order, out: &mut dyn Write) -> Result<(), VerbError> {
    let mut finished: BTreeMap<usize, String> = BTreeMap::new();
    let mut next = 0;
    for (index, line) in receiver.iter() {
        finished.insert(index, line);
        while let Some(line) = finished.remove(&next) {
            if let Err(error) = out.write_all(line.as_bytes()).and_then(|()| out.write_all(b"\n")) {
                order.stop();
                return Err(error.into());
            }
            next += 1;
            order.advance(next);
        }
        // The door reads each record as it is asked for, so nothing written waits in the buffer.
        if let Err(error) = out.flush() {
            order.stop();
            return Err(error.into());
        }
    }
    Ok(())
}

// The ack watch: the one deadline that tells a link whose peer has gone silent from one that is merely quiet.
//
// A center that holds the socket open and answers nothing (a process stopped under it, a handover that left
// it frozen) closes nothing: the TCP connection stands, heartbeats go out and are never read, and the link
// reads "linked" for good. Center DOES answer every reliable frame (`ack`, once stored or handled), so a reliable
// frame that nothing has answered for `deadlineMs` is the evidence — and ANY frame from center, whatever its type,
// is evidence the other way, so a center that is busy but alive never trips it.
//
//   expect()        a reliable frame is outstanding: the deadline starts, unless one is already running
//   heard()         center said something: a running deadline starts over
//   settle(stillOutstanding)   an `ack` arrived: the deadline ends, and starts again only for what is still unanswered
//   stop()          the link is down: no deadline runs
//
// `onSilent` runs once per expiry, with no deadline left running. It is a timer that exists only while a reliable
// frame waits; a link with nothing outstanding has none, so an idle warden wakes nothing.

/**
 * @param {number} deadlineMs how long an outstanding reliable frame may go with no word from center
 * @param {() => void} onSilent what to do when it has: the caller drops the socket
 * @returns {{ expect(): void, heard(): void, settle(stillOutstanding: boolean): void, stop(): void }}
 */
export function createAckWatch(deadlineMs, onSilent) {
  let timer = null;

  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  const start = () => {
    stop();
    timer = setTimeout(() => {
      timer = null;
      onSilent();
    }, deadlineMs);
  };

  return {
    expect() {
      if (timer === null) start();
    },
    heard() {
      if (timer !== null) start();
    },
    settle(stillOutstanding) {
      stop();
      if (stillOutstanding) start();
    },
    stop,
  };
}

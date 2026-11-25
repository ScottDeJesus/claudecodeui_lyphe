import { useCallback, useEffect, useRef, useState } from 'react';

import { switchId } from '@/modules/gemini-spend/geminiFigures';
import type { ConnectorUsage, DoorRead, FeatureRow, GeminiDoor, GeminiRange, GeminiUsageView, MeterUsage } from '@/modules/gemini-spend/types';
import { api, errorMessage } from '@/shared/api';

/** A door's answer once read: its body, or the sentence the panel draws in that door's place. */
type DoorAnswer<Body> = { ok: true; body: Body } | { ok: false; sentence: string };

/** What a switch's PUT reads back, at either door: the state its store now holds. */
type SwitchAnswer = { feature: string; enabled: boolean };

const READING = { state: 'reading' } as const;

/**
 * Both doors of the Gemini spend view, for one window.
 *
 * It reads GET /api/gemini-usage/usage and GET /api/gemini-meter/usage when the panel mounts, when the range changes,
 * when the page becomes visible and after a press, with no interval. A range the panel has no answer for yet is state
 * 'reading' at both doors, so the last window's figures never stand under the new window's name; a re-read on the
 * page's events keeps the last answer drawn until the new one lands. Each answer carries readAt, the ISO moment it
 * landed. A door that did not answer is state 'failed' with its sentence, and the other still draws. setSwitch sends the
 * PUT to the feature's own door, keeps switchId(door, feature) in held while it is out and then draws what the door read
 * back; a refused press is pressFailure, in words.
 */
export function useGeminiUsage(range: GeminiRange): GeminiUsageView {
  const [connector, setConnector] = useState<DoorRead<ConnectorUsage>>(READING);
  const [meter, setMeter] = useState<DoorRead<MeterUsage>>(READING);
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [pressFailure, setPressFailure] = useState<GeminiUsageView['pressFailure']>(null);
  const rangeRef = useRef(range);
  const doorsRef = useRef({ connector, meter });
  // Each read takes a turn per door; an answer whose turn has passed (a newer window, a newer press) is dropped.
  const turns = useRef({ connector: 0, meter: 0 });

  useEffect(() => {
    doorsRef.current = { connector, meter };
  }, [connector, meter]);

  const read = useCallback((window: GeminiRange) => {
    const connectorTurn = ++turns.current.connector;
    const meterTurn = ++turns.current.meter;
    void askDoor(() => api.geminiUsage.usage(window), isConnectorUsage).then((answer) => {
      if (turns.current.connector === connectorTurn) setConnector(drawn(answer));
    });
    void askDoor(() => api.geminiMeter.usage(window), isMeterUsage).then((answer) => {
      if (turns.current.meter === meterTurn) setMeter(drawn(answer));
    });
  }, []);

  useEffect(() => {
    rangeRef.current = range;
    setConnector(READING);
    setMeter(READING);
    read(range);
  }, [range, read]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') read(rangeRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [read]);

  const setSwitch = useCallback(
    (door: GeminiDoor, feature: string, enabled: boolean) => {
      const id = switchId(door, feature);
      const label = labelOf(doorsRef.current, door, feature);
      setHeld((prev) => new Set(prev).add(id));
      setPressFailure(null);
      const send = door === 'meter' ? () => api.geminiMeter.setSwitch(feature, enabled) : () => api.geminiUsage.setSwitch(feature, enabled);
      void askDoor(send, isSwitchAnswer).then((answer) => {
        if (answer.ok) {
          drawSwitch(door, answer.body, setConnector, setMeter);
        } else {
          setPressFailure({ label, sentence: answer.sentence });
        }
        setHeld((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        read(rangeRef.current);
      });
    },
    [read],
  );

  const dismissPressFailure = useCallback(() => setPressFailure(null), []);
  const refresh = useCallback(() => read(rangeRef.current), [read]);

  return { connector, meter, held, pressFailure, setSwitch, dismissPressFailure, refresh };
}

/** One request to one door, never thrown: a refusal, a fault of the lane and a dead network all come back as a sentence. */
async function askDoor<Body>(send: () => Promise<Response>, isBody: (value: unknown) => value is Body): Promise<DoorAnswer<Body>> {
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    return { ok: false, sentence: error instanceof Error ? error.message : String(error) };
  }
  const data = await readJson(response);
  if (!response.ok) return { ok: false, sentence: sentenceOf(data, response.status) };
  if (!isBody(data)) return { ok: false, sentence: `The door answered ${response.status} with a body this view cannot read.` };
  return { ok: true, body: data };
}

/** The body as JSON, or null when it is empty or not JSON (a proxy's HTML page, a cut answer). */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** The refusal in the door's own words: a lane's or CloudCLI's `error`, the connector's `detail`, else its status. */
function sentenceOf(data: unknown, status: number): string {
  if (data !== null && typeof data === 'object') {
    const body = data as { error?: unknown; detail?: unknown };
    const said = errorMessage(body.error) ?? errorMessage(body.detail);
    if (said !== null) return said;
  }
  return `Request failed (${status})`;
}

function drawn<Body>(answer: DoorAnswer<Body>): DoorRead<Body> {
  return answer.ok ? { state: 'answered', body: answer.body, readAt: new Date().toISOString() } : { state: 'failed', sentence: answer.sentence };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConnectorUsage(value: unknown): value is ConnectorUsage {
  return isRecord(value) && Array.isArray(value.projects) && Array.isArray(value.keys) && Array.isArray(value.days) && typeof value.total_usd === 'number';
}

function isMeterUsage(value: unknown): value is MeterUsage {
  return isRecord(value) && Array.isArray(value.features) && Array.isArray(value.keys) && Array.isArray(value.days) && (typeof value.cost_usd === 'number' || value.cost_usd === null);
}

function isSwitchAnswer(value: unknown): value is SwitchAnswer {
  return isRecord(value) && typeof value.feature === 'string' && typeof value.enabled === 'boolean';
}

/** The feature's own words for a refused press; its key when the door is not drawn. */
function labelOf(doors: { connector: DoorRead<ConnectorUsage>; meter: DoorRead<MeterUsage> }, door: GeminiDoor, feature: string): string {
  const rows: FeatureRow[] =
    door === 'meter'
      ? doors.meter.state === 'answered' ? doors.meter.body.features : []
      : doors.connector.state === 'answered' ? doors.connector.body.projects.flatMap((project) => project.features) : [];
  return rows.find((row) => row.feature === feature)?.label ?? feature;
}

/** Draws the state the door read back on its row at once; the re-read that follows confirms it with fresh figures. */
function drawSwitch(
  door: GeminiDoor,
  answer: SwitchAnswer,
  setConnector: (update: (prev: DoorRead<ConnectorUsage>) => DoorRead<ConnectorUsage>) => void,
  setMeter: (update: (prev: DoorRead<MeterUsage>) => DoorRead<MeterUsage>) => void,
): void {
  const withSwitch = (rows: FeatureRow[]) => rows.map((row) => (row.feature === answer.feature ? { ...row, enabled: answer.enabled } : row));
  if (door === 'meter') {
    setMeter((prev) => (prev.state === 'answered' ? { ...prev, body: { ...prev.body, features: withSwitch(prev.body.features) } } : prev));
    return;
  }
  setConnector((prev) =>
    prev.state === 'answered'
      ? { ...prev, body: { ...prev.body, projects: prev.body.projects.map((project) => ({ ...project, features: withSwitch(project.features) })) } }
      : prev,
  );
}

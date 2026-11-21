"""The app's sound set (src/shared/sounds), synthesized from nothing: dark bells, a low horn, a mallet's minor fall, and Kaylee's
listening breaths. Everything sits in A with its tritone (E flat) and its flat second (B flat), in one shared hall.

    python3 scripts/sounds/make-sounds.py src/shared/sounds

writes the five MP3s there and prints each one's playback gain, which goes into `SOUNDS` in src/shared/sounds/index.ts. Needs numpy,
scipy and an ffmpeg with libmp3lame. The noise is seeded, so a run gives the same sounds again; change a recipe below and run it to
change one.

LEVELS. Each file is stored with its peak at -1 dBFS. Its gain puts it level with the sound it replaced (the old two-tone chime, the
old two-note cues, rebuilt here from their code) as a laptop's speakers give it: momentary loudness, BS.1770 K-weighting, with the
lows such speakers drop cut first. The questions sit 3 dB over the old chime, a finished turn 1 dB over it, Kaylee's cues level
with the old cues."""
import json, os, subprocess, sys, tempfile
import numpy as np
import scipy.signal as ss
from scipy.io import wavfile

SR = 48000
OUT = sys.argv[1]
rng = np.random.default_rng(7)


def t_of(dur):
    return np.arange(int(dur * SR)) / SR


def place(buf, sig, at):
    """Adds `sig` into `buf` at `at` s, its last 25 ms eased to nothing: a part that stops while it still sounds never clicks."""
    sig = sig.copy()
    r = min(int(0.025 * SR), len(sig))
    sig[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    i = int(at * SR)
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n]


def fade_in(sig, a):
    n = int(a * SR)
    sig[:n] *= np.linspace(0, 1, n)
    return sig


# A church bell's partials (ratio to the prime, level, decay in s): the hum an octave down, the minor-third tierce that makes a bell sound
# grave, the quint, the nominal an octave up, and a few quick upper partials. Each partial is a pair a fraction of a hertz apart: it beats.
BELL = [(0.5, 0.30, 1.1), (1.0, 0.45, 0.85), (1.19, 0.40, 0.7), (1.5, 0.14, 0.5), (2.0, 0.50, 0.6),
        (2.52, 0.20, 0.35), (2.99, 0.14, 0.28), (4.08, 0.07, 0.18), (5.43, 0.035, 0.12)]


def bell(f0, dur, amp=1.0):
    t = t_of(dur)
    out = np.zeros_like(t)
    for r, a, d in BELL:
        f = f0 * r
        beat = 0.3 + 0.12 * r
        p = rng.uniform(0, 2 * np.pi, 2)
        pair = 0.5 * (np.sin(2 * np.pi * (f - beat / 2) * t + p[0]) + np.sin(2 * np.pi * (f + beat / 2) * t + p[1]))
        out += a * pair * np.exp(-t / d)
    n = int(0.012 * SR)
    strike = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.002 * SR))
    b, a_ = ss.butter(2, [900 / (SR / 2), 3000 / (SR / 2)], 'band')
    out[:n] += ss.lfilter(b, a_, strike) * 0.3
    return fade_in(out * amp, 0.002)


def horn(f0, dur, amp=1.0, bend_cents=0.0, attack=0.08, release=0.4, bright_peak=1400.0, bright_rest=620.0):
    """A low brass voice: three detuned voices of a harmonic stack under a lowpass that opens on the attack and closes after."""
    t = t_of(dur)
    f_line = f0 * 2 ** ((bend_cents * t / dur) / 1200)
    fc = bright_rest + (bright_peak - bright_rest) * np.clip(t / attack, 0, 1) * np.exp(-np.maximum(t - attack, 0) / 0.2)
    out = np.zeros_like(t)
    for det in (-7.0, 0.0, 6.0):
        fv = f_line * 2 ** (det / 1200)
        phase = 2 * np.pi * np.cumsum(fv) / SR
        for n in range(1, 30):
            if f0 * n > 5000:
                break
            w = (1 / n ** 1.05) / (1 + (n * fv / fc) ** 4) * (0.5 if n == 1 else 0.8 if n == 2 else 1.0)
            out += w * np.sin(n * phase + rng.uniform(0, 2 * np.pi))
    out /= 3
    env = np.clip(t / attack, 0, 1) ** 1.5
    env *= np.where(t > dur - release, np.clip((dur - t) / release, 0, 1) ** 1.6, 1.0)
    return out * env * amp


# A low bar struck soft (a marimba's tuning: the fourth partial two octaves up, the tenth above that), for a quiet fall.
MALLET = [(1.0, 1.0, 0.95), (3.93, 0.32, 0.22), (9.2, 0.08, 0.07)]


def mallet(f0, dur, amp=1.0, ring=1.0):
    t = t_of(dur)
    out = np.zeros_like(t)
    for r, a, d in MALLET:
        out += a * np.sin(2 * np.pi * f0 * r * t + rng.uniform(0, 2 * np.pi)) * np.exp(-t / (d * ring))
    n = int(0.006 * SR)
    knock = rng.standard_normal(n) * np.exp(-np.arange(n) / (0.0015 * SR))
    b, a_ = ss.butter(2, 1600 / (SR / 2))
    out[:n] += ss.lfilter(b, a_, knock) * 0.08
    return fade_in(out * amp, 0.004)


def glide(f_from, f_to, dur, amp=1.0):
    t = t_of(dur)
    f = f_from * (f_to / f_from) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + 0.35 * np.sin(2 * ph + 0.3) + 0.15 * np.sin(3 * ph + 1.1)) * amp


def swept_noise(c_from, c_to, dur, q=3.0):
    """White noise through a band-pass whose middle slides from c_from to c_to (a breath in, or out)."""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    low = band = 0.0
    for i in range(n):
        c = c_from * (c_to / c_from) ** (i / n)
        f = 2 * np.sin(np.pi * c / SR)
        high = x[i] - low - band / q
        band += f * high
        low += f * band
        out[i] = band
    return out / (np.max(np.abs(out)) + 1e-9)


def hall(rt60, seed, damp_hz=3200.0, pre=0.014):
    """The station's hall: decaying noise per ear, darker as it dies, a little late to start; unit energy."""
    n = int(rt60 * 1.1 * SR)
    t = np.arange(n) / SR
    env = np.exp(-6.91 * t / rt60)
    b1, a1 = ss.butter(1, damp_hz / (SR / 2))
    b2, a2 = ss.butter(1, (damp_hz / 3.5) / (SR / 2))
    ears = []
    for k in (0, 1):
        x = np.random.default_rng(seed + k).standard_normal(n)
        mix = np.clip(t / rt60 * 1.5, 0, 1)
        y = (ss.lfilter(b1, a1, x) * (1 - mix) + ss.lfilter(b2, a2, x) * mix * 1.6) * env
        m = int(0.02 * SR)
        y[:m] *= np.linspace(0, 1, m)
        ears.append(np.concatenate([np.zeros(int(pre * SR)), y]))
    norm = np.sqrt(np.sum(ears[0] ** 2))
    return ears[0] / norm, ears[1] / norm


def finish(mono, total, wet, rt60, seed, lp=6500.0, hp=50.0, tail_fade=0.4):
    irl, irr = hall(rt60, seed)
    n = int(total * SR)

    def fit(x):
        x = x[:n]
        return np.pad(x, (0, n - len(x)))

    dry = fit(mono)
    left = dry * (1 - wet * 0.5) + fit(ss.fftconvolve(mono, irl)) * wet
    right = dry * (1 - wet * 0.5) + fit(ss.fftconvolve(mono, irr)) * wet
    st = np.stack([left, right])
    b, a = ss.butter(2, lp / (SR / 2))
    st = ss.lfilter(b, a, st, axis=1)
    b, a = ss.butter(2, hp / (SR / 2), 'high')
    st = ss.lfilter(b, a, st, axis=1)
    fo = int(tail_fade * SR)
    st[:, -fo:] *= np.linspace(1, 0, fo) ** 2
    return st


def kweight(x):
    b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
    a1 = [1.0, -1.69065929318241, 0.73248077421585]
    b2 = [1.0, -2.0, 1.0]
    a2 = [1.0, -1.99004745483398, 0.99007225036621]
    return ss.lfilter(b2, a2, ss.lfilter(b1, a1, x, axis=-1), axis=-1)


def loudness(st, laptop=False):
    """Momentary loudness at its loudest (400 ms windows, BS.1770 K-weighting), in LUFS; `laptop` first cuts what small speakers lose."""
    if laptop:
        b, a = ss.butter(2, 180 / (SR / 2), 'high')
        st = ss.lfilter(b, a, st, axis=-1)
    k = kweight(st)
    w, hop = int(0.4 * SR), int(0.02 * SR)
    pad = np.pad(k, ((0, 0), (0, w)))
    best = max(np.sum(np.mean(pad[:, i:i + w] ** 2, axis=1)) for i in range(0, k.shape[1], hop))
    return -0.691 + 10 * np.log10(best + 1e-12)


# ---- the sounds as they were, for the level to match ----
def old_tone(buf, f, start, dur, peak):
    t = t_of(dur + 0.02)
    g = np.where(t < 0.015, 1e-4 * (peak / 1e-4) ** (t / 0.015), peak * (1e-4 / peak) ** (np.clip((t - 0.015) / (dur - 0.015), 0, 1)))
    place(buf, np.sin(2 * np.pi * f * t) * g, start)


def old_chime():
    buf = np.zeros(int(0.5 * SR))
    old_tone(buf, 740, 0.0, 0.12, 0.075)
    old_tone(buf, 988, 0.11, 0.16, 0.06)
    return np.stack([buf, buf])


def old_earcon(notes):
    buf = np.zeros(int(0.4 * SR))
    for i, f in enumerate(notes):
        t = t_of(0.11)
        env = np.clip(np.minimum(t / 0.01, (0.11 - t) / 0.01), 0, 1) * 0.12
        place(buf, np.sin(2 * np.pi * f * t) * env, i * 0.11)
    return np.stack([buf, buf])


A2, BB2, C3, E3, A3, EB4 = 110.0, 116.54, 130.81, 164.81, 220.0, 311.13

# ---- the new set ----
def asking():
    """A word is owed in a chat: a grave bell, then a quieter one a tritone up, over the hum."""
    m = np.zeros(int(2.6 * SR))
    place(m, bell(A3, 2.5, 1.0), 0.0)
    place(m, bell(EB4, 2.3, 0.62), 0.17)
    t = t_of(1.8)
    hum = np.sin(2 * np.pi * A2 * t) * np.clip(t / 0.25, 0, 1) * np.exp(-t / 0.6) * 0.18
    place(m, hum, 0.0)
    return finish(m, 2.2, wet=0.3, rt60=1.9, seed=11, tail_fade=0.45)


def plan_asks():
    """A plan wants your word: a far horn, A then the B flat a half step above it, sagging as it holds; a glint as it moves."""
    m = np.zeros(int(2.6 * SR))
    place(m, horn(A2, 0.62, 1.0, attack=0.07, release=0.22), 0.0)
    place(m, horn(BB2, 1.25, 1.0, bend_cents=-22, attack=0.06, release=0.6), 0.5)
    t = t_of(0.6)
    glint = sum(a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / d) for f, a, d in ((1864.7, 0.05, 0.35), (2793.8, 0.03, 0.22), (4186.0, 0.012, 0.12)))
    place(m, fade_in(glint, 0.003), 0.5)
    return finish(m, 2.3, wet=0.4, rt60=2.8, seed=21)


def finished():
    """A turn is done: a soft mallet falls down the minor chord to its root, E, C, A, and the hall keeps it a moment."""
    m = np.zeros(int(2.0 * SR))
    for i, (f, a, ring) in enumerate(((E3 * 2, 0.7, 0.35), (C3 * 2, 0.75, 0.45), (A3, 1.0, 1.0))):
        place(m, mallet(f, 1.6, a, ring), i * 0.085)
    t = t_of(1.3)
    bed = (np.sin(2 * np.pi * A2 * t) + 0.25 * np.sin(2 * np.pi * E3 * t)) * np.clip(t / 0.12, 0, 1) * np.exp(-t / 0.5) * 0.22
    place(m, bed, 0.17)
    return finish(m, 1.5, wet=0.3, rt60=1.7, seed=31, tail_fade=0.35)


def listen_open():
    """She is listening: a quick breath in and a low voice rising a tritone, A to E flat; crisp at its end, little hall."""
    m = np.zeros(int(0.6 * SR))
    tone = glide(A3, EB4, 0.2, 1.0)
    t = t_of(0.2)
    tone *= np.clip(t / 0.03, 0, 1) * np.clip((0.2 - t) / 0.05, 0, 1)
    place(m, tone, 0.0)
    breath = swept_noise(450, 1500, 0.2, q=5.0) * 0.15
    breath *= np.clip(t_of(0.2) / 0.12, 0, 1) ** 2 * np.clip((0.2 - t_of(0.2)) / 0.03, 0, 1)
    place(m, breath, 0.0)
    return finish(m, 0.42, wet=0.16, rt60=0.7, seed=41, tail_fade=0.15)


def listen_close():
    """She has stopped listening: the voice falls back, E flat to A, the breath goes out, and a soft low knock closes it."""
    m = np.zeros(int(0.6 * SR))
    tone = glide(EB4, A3, 0.18, 1.0)
    t = t_of(0.18)
    tone *= np.clip(t / 0.015, 0, 1) * np.clip((0.18 - t) / 0.06, 0, 1)
    place(m, tone, 0.0)
    breath = swept_noise(1500, 450, 0.18, q=5.0) * 0.13
    breath *= np.clip((0.18 - t) / 0.16, 0, 1) ** 2 * np.clip(t / 0.01, 0, 1)
    place(m, breath, 0.0)
    knock = mallet(A2, 0.3, 0.5)
    place(m, knock, 0.15)
    return finish(m, 0.45, wet=0.16, rt60=0.7, seed=51, tail_fade=0.15)


ref_chime = loudness(old_chime(), laptop=True)
ref_ear = loudness(old_earcon((440, 659)), laptop=True)
SET = [
    ('asking', asking, ref_chime + 3.0, 'A question or a permission prompt is waiting in a chat'),
    ('plan-asks', plan_asks, ref_chime + 3.0, 'A plan on the roadmap wants your word'),
    ('finished', finished, ref_chime + 1.0, 'A turn finished'),
    ('listen-open', listen_open, ref_ear, 'Kaylee started listening'),
    ('listen-close', listen_close, ref_ear, 'Kaylee stopped listening'),
]
report = {'reference': {'old_chime_lufs': round(ref_chime, 2), 'old_earcon_lufs': round(ref_ear, 2)}, 'sounds': []}
for name, make, target, what in SET:
    st = make()
    st -= st.mean(axis=1, keepdims=True)
    st *= 0.89 / np.max(np.abs(st))
    play_db = target - loudness(st, laptop=True)
    pcm = (np.clip(st, -1, 1) * 32767).astype(np.int16).T
    with tempfile.TemporaryDirectory() as scratch:
        wav = os.path.join(scratch, f'{name}.wav')
        wavfile.write(wav, SR, pcm)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '112k', f'{OUT}/{name}.mp3'], check=True)
    edge = np.max(np.abs(np.diff(st, axis=1)))
    played = st * 10 ** (play_db / 20)
    report['sounds'].append({'name': name, 'what': what, 'seconds': round(st.shape[1] / SR, 2), 'play_gain_db': round(play_db, 1),
                             'played_lufs_laptop': round(loudness(played, laptop=True), 2), 'played_lufs_full': round(loudness(played), 2),
                             'played_peak_dbfs': round(20 * np.log10(np.max(np.abs(played))), 1),
                             'largest_step': round(float(edge), 4),
                             'first_sample': round(float(np.max(np.abs(st[:, 0]))), 5), 'last_sample': round(float(np.max(np.abs(st[:, -1]))), 5)})
print(json.dumps(report, indent=1))

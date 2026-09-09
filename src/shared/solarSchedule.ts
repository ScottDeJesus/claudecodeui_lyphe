/**
 * Sunrise and sunset for the reader's own place, with no network call and no permission prompt.
 *
 * ⚠ Why not `navigator.geolocation`: it is gated on a SECURE CONTEXT. This app is reached over a
 * plain-http LAN/Tailscale origin as often as over localhost, and Chrome treats only localhost
 * and https as trustworthy — so on the origin the operator actually uses, the geolocation API is
 * simply absent. A feature that silently never runs for its user is worse than an approximate
 * one that always does.
 *
 * So the place comes from `Intl`'s IANA time zone, which every browser reports and which needs
 * no permission. That is an approximation and it is stated as one: a zone is a region, not a
 * point, so times are good to roughly ±15 minutes and drift most at a wide zone's east and west
 * edges. For choosing when to darken a UI that is comfortably inside the error that matters.
 */

/**
 * Representative coordinates for the zones a reader is actually likely to be in.
 *
 * Deliberately a short table of real places rather than a generated centroid for all ~600 IANA
 * zones: a centroid is not more correct here (it lands in empty desert for several zones), and
 * the fallback below covers everything absent.
 */
const ZONE_COORDINATES: Record<string, [latitude: number, longitude: number]> = {
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Denver': [39.74, -104.99],
  'America/Phoenix': [33.45, -112.07],
  'America/Chicago': [41.88, -87.63],
  'America/Mexico_City': [19.43, -99.13],
  'America/New_York': [40.71, -74.01],
  'America/Toronto': [43.65, -79.38],
  'America/Sao_Paulo': [-23.55, -46.63],
  'America/Bogota': [4.71, -74.07],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38],
  'Europe/London': [51.51, -0.13],
  'Europe/Dublin': [53.35, -6.26],
  'Europe/Lisbon': [38.72, -9.14],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Brussels': [50.85, 4.35],
  'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Zurich': [47.38, 8.54],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Stockholm': [59.33, 18.07],
  'Europe/Oslo': [59.91, 10.75],
  'Europe/Warsaw': [52.23, 21.01],
  'Europe/Kyiv': [50.45, 30.52],
  'Europe/Athens': [37.98, 23.73],
  'Europe/Istanbul': [41.01, 28.98],
  'Europe/Moscow': [55.76, 37.62],
  'Africa/Lagos': [6.52, 3.38],
  'Africa/Cairo': [30.04, 31.24],
  'Africa/Nairobi': [-1.29, 36.82],
  'Africa/Johannesburg': [-26.2, 28.05],
  'Asia/Jerusalem': [31.77, 35.21],
  'Asia/Dubai': [25.2, 55.27],
  'Asia/Karachi': [24.86, 67.01],
  'Asia/Kolkata': [19.08, 72.88],
  'Asia/Dhaka': [23.81, 90.41],
  'Asia/Bangkok': [13.76, 100.5],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Jakarta': [-6.21, 106.85],
  'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Shanghai': [31.23, 121.47],
  'Asia/Taipei': [25.03, 121.57],
  'Asia/Seoul': [37.57, 126.98],
  'Asia/Tokyo': [35.68, 139.65],
  'Australia/Perth': [-31.95, 115.86],
  'Australia/Brisbane': [-27.47, 153.03],
  'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96],
  'Pacific/Auckland': [-36.85, 174.76],
  'Pacific/Honolulu': [21.31, -157.86],
};

/** Where the fallback puts a reader it cannot place: mid-northern latitudes, the populous band. */
const FALLBACK_LATITUDE = 40;

/** How far the zone is from UTC right now, in minutes east-positive. */
function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    read('year'), read('month') - 1, read('day'),
    read('hour') % 24, read('minute'), read('second'),
  );
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/**
 * The reader's place, as coordinates.
 *
 * An unlisted zone falls back to longitude derived from its UTC offset — the earth turns 15° an
 * hour, so the offset IS a longitude to within the width of the zone — at a mid-northern
 * latitude. That is cruder than the table and it is the honest floor: it still tracks the
 * seasons, which is the whole point, and it never fails.
 */
export function coordinatesForZone(timeZone: string, at: Date = new Date()): [number, number] {
  const known = ZONE_COORDINATES[timeZone];
  if (known) return known;
  return [FALLBACK_LATITUDE, (zoneOffsetMinutes(timeZone, at) / 60) * 15];
}

const DEGREES = Math.PI / 180;

/** J2000.0 (2000-01-01 12:00 UTC) expressed in Unix days — the epoch NOAA's series expect. */
const J2000_UNIX_DAY = 10957.5;

/**
 * Sunrise and sunset as UTC instants for the solar day around `on`.
 *
 * NOAA's low-precision solar equations (the ones in their own spreadsheet), good to well under a
 * minute — far inside the error the zone approximation above already carries.
 *
 * `null` for either end means the sun does not cross the horizon there that day: inside the
 * polar circles there are days with no sunrise and days with no sunset, and returning a
 * fabricated time for them would flip a theme at an hour with no meaning.
 */
export function sunTimesUtc(latitude: number, longitude: number, on: Date): { sunrise: Date | null; sunset: Date | null } {
  // ⚠ Days are counted from J2000.0 — 2000-01-01 12:00 UTC — which is Unix day 10957.5, NOT
  // from the Unix epoch. NOAA's series are defined against a NOON epoch, and feeding them
  // midnight-based days puts every result exactly twelve hours out: sunrise for Los Angeles
  // came back 6:32 PM where the real one is 6:32 AM. Measured, then fixed here.
  const daysSinceJ2000 = (on.getTime() / 86_400_000) - J2000_UNIX_DAY;
  const meanSolarDay = Math.round(daysSinceJ2000 - 0.0009 + (longitude / 360));
  const solarNoonApprox = meanSolarDay + 0.0009 - (longitude / 360);
  const meanAnomaly = (357.5291 + 0.98560028 * solarNoonApprox) % 360;
  const centre = 1.9148 * Math.sin(meanAnomaly * DEGREES)
    + 0.02 * Math.sin(2 * meanAnomaly * DEGREES)
    + 0.0003 * Math.sin(3 * meanAnomaly * DEGREES);
  const eclipticLongitude = (meanAnomaly + centre + 180 + 102.9372) % 360;
  const solarTransit = solarNoonApprox
    + (0.0053 * Math.sin(meanAnomaly * DEGREES))
    - (0.0069 * Math.sin(2 * eclipticLongitude * DEGREES));
  const declination = Math.asin(Math.sin(eclipticLongitude * DEGREES) * Math.sin(23.44 * DEGREES));

  // -0.833° rather than 0°: the sun's disc has a radius, and the atmosphere refracts it into
  // view before it geometrically clears the horizon. That is the standard sunrise definition.
  const cosHourAngle = (Math.sin(-0.833 * DEGREES) - Math.sin(latitude * DEGREES) * Math.sin(declination))
    / (Math.cos(latitude * DEGREES) * Math.cos(declination));

  // |cos| > 1 has no solution: midnight sun (< -1) or polar night (> 1).
  if (cosHourAngle > 1 || cosHourAngle < -1) return { sunrise: null, sunset: null };

  const hourAngle = Math.acos(cosHourAngle) / DEGREES;
  // Back from J2000-relative days to an instant, undoing the epoch shift above.
  const toInstant = (day: number) => new Date(Math.round((day + J2000_UNIX_DAY) * 86_400_000));
  return {
    sunrise: toInstant(solarTransit - (hourAngle / 360)),
    sunset: toInstant(solarTransit + (hourAngle / 360)),
  };
}

export type SunPhase = {
  /** True between sunrise and sunset, where the app should be light. */
  isDaylight: boolean;
  /** When `isDaylight` next flips, or `null` on a polar day with no crossing to wait for. */
  nextChangeAt: Date | null;
};

/**
 * Whether it is currently daylight where the reader is, and when that next changes.
 *
 * Tomorrow is computed alongside today because "now" can sit after today's sunset, where the
 * next change is TOMORROW's sunrise. Reading only today's pair leaves the evening with nothing
 * to schedule against.
 */
export function readSunPhase(
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now: Date = new Date(),
): SunPhase {
  const [latitude, longitude] = coordinatesForZone(timeZone, now);
  const today = sunTimesUtc(latitude, longitude, now);
  const tomorrow = sunTimesUtc(latitude, longitude, new Date(now.getTime() + 86_400_000));

  if (!today.sunrise || !today.sunset) {
    // Polar day or night: no crossing today, so there is nothing to schedule against and
    // nothing measured to flip on. The caller keeps whatever theme it already had.
    return { isDaylight: false, nextChangeAt: null };
  }

  if (now < today.sunrise) return { isDaylight: false, nextChangeAt: today.sunrise };
  if (now < today.sunset) return { isDaylight: true, nextChangeAt: today.sunset };
  return { isDaylight: false, nextChangeAt: tomorrow.sunrise };
}

// Times are stored as milliseconds integers (CLAUDE.md); this is the only place that formats them
// to/from the mm:ss.hh display format used across the timing and leaderboard screens.

export function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  const totalHundredths = Math.round(ms / 10);
  const minutes = Math.floor(totalHundredths / 6000);
  const seconds = Math.floor((totalHundredths % 6000) / 100);
  const hundredths = totalHundredths % 100;
  const mm = minutes > 0 ? `${minutes}:` : '';
  const ss = minutes > 0 ? String(seconds).padStart(2, '0') : String(seconds);
  return `${mm}${ss}.${String(hundredths).padStart(2, '0')}`;
}

// Manual time entry reads as one right-anchored digit string, calculator/price-entry style — the
// coach just types digits (e.g. "13045") and they fill in from the right: hundredths, then
// seconds, then minutes ("13045" -> 1:30.45). One field instead of tabbing through mm/ss/hh.
const DIGIT_GROUPS = 6; // MMSSHH

function padDigits(digits: string): string {
  return digits.padStart(DIGIT_GROUPS, '0').slice(-DIGIT_GROUPS);
}

export function parseMsFromDigits(digits: string): number | null {
  if (!digits) return null;
  const padded = padDigits(digits);
  const minutes = Number(padded.slice(0, 2));
  const seconds = Number(padded.slice(2, 4));
  const hundredths = Number(padded.slice(4, 6));
  return minutes * 60_000 + seconds * 1000 + hundredths * 10;
}

// Live preview while typing — always shows the m:ss.hh shape (even "0:00.00") so the right-anchored
// fill-in is legible as digits are entered, unlike formatMs() which drops a zero minutes prefix.
export function formatDigitsPreview(digits: string): string {
  const padded = padDigits(digits);
  const minutes = Number(padded.slice(0, 2));
  const seconds = padded.slice(2, 4);
  const hundredths = padded.slice(4, 6);
  return `${minutes}:${seconds}.${hundredths}`;
}

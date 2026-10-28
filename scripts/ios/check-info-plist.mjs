/**
 * Fails when the FINAL Info.plist (after every config plugin's mods) lacks a purpose string
 * App Store Connect requires. Plugins can overwrite or delete each other's keys (build 6 was
 * rejected with ITMS-90683: expo-image-picker's `microphonePermission: false` removed the key
 * expo-speech-recognition had written), and the upload only fails after ~20 minutes of CI.
 *
 * Usage: node scripts/ios/check-info-plist.mjs   (runs `expo config --type introspect`)
 */
import { execSync } from 'node:child_process';

const REQUIRED_STRINGS = [
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSCalendarsUsageDescription',
  'NSCalendarsFullAccessUsageDescription',
  'NSHealthShareUsageDescription',
  'NSHealthUpdateUsageDescription',
];
const REQUIRED_BACKGROUND_MODES = ['remote-notification', 'audio'];

/** Pure check, exported for reuse: returns the list of problems (empty = OK). */
export function plistProblems(infoPlist) {
  const plist = infoPlist ?? {};
  const missing = REQUIRED_STRINGS.filter((key) => typeof plist[key] !== 'string' || plist[key].trim() === '').map(
    (key) => `missing purpose string ${key}`,
  );
  const modes = Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : [];
  const missingModes = REQUIRED_BACKGROUND_MODES.filter((mode) => !modes.includes(mode)).map((mode) => `missing UIBackgroundModes "${mode}"`);
  return [...missing, ...missingModes];
}

function introspectedInfoPlist() {
  const out = execSync('npx expo config --type introspect --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  const config = JSON.parse(out.slice(out.indexOf('{')));
  return config.ios?.infoPlist;
}

const problems = plistProblems(introspectedInfoPlist());
if (problems.length > 0) {
  process.stderr.write(`Info.plist check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Info.plist check OK (${REQUIRED_STRINGS.length} purpose strings, background modes ${REQUIRED_BACKGROUND_MODES.join(', ')}).\n`);

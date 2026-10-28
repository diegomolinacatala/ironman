/**
 * Fails when a precompiled Expo module (node_modules/<pkg>/prebuilds, shipped byte-for-byte into the
 * app) imports a Swift symbol that the precompiled framework it links against does not export.
 * Build 7 compiled, uploaded and passed App Store Connect, then died at launch on every iPhone with
 * "DYLD Symbol missing": expo-file-system@58.0.12 was prebuilt against a newer expo-modules-core
 * than the 58.0.26 that `expo` installs. Nothing else (tsc, jest, xcodebuild) notices.
 *
 * Usage: node scripts/ios/check-prebuilt-abi.mjs   (after `npm ci`; needs `tar`)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NODE_MODULES = 'node_modules';
const RELEASE_XCFRAMEWORKS = join('prebuilds', 'output', 'release', 'xcframeworks');
const DEVICE_SLICE = 'ios-arm64';

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const CPU_TYPE_ARM64 = 0x0100000c;
const LC_SYMTAB = 0x2;
const N_EXT = 0x01;
const N_TYPE = 0x0e;
const N_STAB = 0xe0;
const NLIST_64_SIZE = 16;

/** External symbols of the arm64 slice of a Mach-O binary: what it exports and what it imports. */
export function machoSymbols(file) {
  const macho = arm64Slice(file);
  if (macho.readUInt32LE(0) !== MH_MAGIC_64) throw new Error('not a 64-bit Mach-O binary');
  const defined = new Set();
  const imported = new Set();
  let offset = 32;
  for (let i = 0; i < macho.readUInt32LE(16); i++) {
    const cmd = macho.readUInt32LE(offset);
    if (cmd === LC_SYMTAB) {
      const symoff = macho.readUInt32LE(offset + 8);
      const nsyms = macho.readUInt32LE(offset + 12);
      const stroff = macho.readUInt32LE(offset + 16);
      for (let s = 0; s < nsyms; s++) {
        const entry = symoff + s * NLIST_64_SIZE;
        const type = macho[entry + 4];
        if (!(type & N_EXT) || type & N_STAB) continue;
        const start = stroff + macho.readUInt32LE(entry);
        const name = macho.toString('latin1', start, macho.indexOf(0, start));
        ((type & N_TYPE) === 0 ? imported : defined).add(name);
      }
    }
    offset += macho.readUInt32LE(offset + 4);
  }
  return { defined, imported };
}

function arm64Slice(file) {
  if (file.readUInt32BE(0) !== FAT_MAGIC) return file;
  for (let i = 0; i < file.readUInt32BE(4); i++) {
    const arch = 8 + i * 20;
    if (file.readUInt32BE(arch) === CPU_TYPE_ARM64) {
      const start = file.readUInt32BE(arch + 8);
      return file.subarray(start, start + file.readUInt32BE(arch + 12));
    }
  }
  throw new Error('no arm64 slice');
}

/**
 * Pure check, exported for reuse: `frameworks` maps a framework (= Swift module) name to its symbols.
 * A Swift symbol mangled under another prebuilt module (`$s<len><Module>…`) must be exported by it.
 */
export function abiProblems(frameworks) {
  const problems = [];
  for (const [name, { imported }] of frameworks) {
    for (const [provider, { defined }] of frameworks) {
      if (provider === name) continue;
      const prefix = `_$s${provider.length}${provider}`;
      const missing = [...imported].filter((symbol) => symbol.startsWith(prefix) && !defined.has(symbol));
      if (missing.length > 0) {
        problems.push(`${name} needs ${missing.length} symbol(s) that ${provider} does not export, e.g. ${missing[0]}`);
      }
    }
  }
  return problems;
}

function prebuiltTarballs() {
  const packages = readdirSync(NODE_MODULES).flatMap((entry) =>
    entry.startsWith('@') ? readdirSync(join(NODE_MODULES, entry)).map((pkg) => join(entry, pkg)) : [entry],
  );
  return packages.flatMap((pkg) => {
    const dir = join(NODE_MODULES, pkg, RELEASE_XCFRAMEWORKS);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((file) => file.endsWith('.tar.gz')).map((file) => ({ pkg, tarball: join(dir, file) }));
  });
}

function loadFrameworks(workDir) {
  const frameworks = new Map();
  const origin = new Map();
  for (const { pkg, tarball } of prebuiltTarballs()) {
    // Piped through stdin: GNU tar on Windows reads "C:\…" as a remote host.
    execFileSync('tar', ['-xzf', '-'], { cwd: workDir, input: readFileSync(tarball) });
    for (const xcframework of readdirSync(workDir).filter((entry) => entry.endsWith('.xcframework'))) {
      const name = xcframework.replace(/\.xcframework$/, '');
      if (frameworks.has(name)) continue;
      const binary = join(workDir, xcframework, DEVICE_SLICE, `${name}.framework`, name);
      if (!existsSync(binary)) continue;
      frameworks.set(name, machoSymbols(readFileSync(binary)));
      origin.set(name, `${pkg}@${JSON.parse(readFileSync(join(NODE_MODULES, pkg, 'package.json'), 'utf8')).version}`);
    }
  }
  return { frameworks, origin };
}

const workDir = mkdtempSync(join(tmpdir(), 'prebuilt-abi-'));
try {
  const { frameworks, origin } = loadFrameworks(workDir);
  const problems = abiProblems(frameworks);
  const versions = [...new Set(origin.values())].join(', ');
  if (problems.length > 0) {
    process.stderr.write(
      `Prebuilt framework ABI check failed (the app would crash at launch):\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        `Installed: ${versions}\nPin the module to the release prebuilt against the installed expo-modules-core.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`Prebuilt framework ABI check OK (${versions}).\n`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

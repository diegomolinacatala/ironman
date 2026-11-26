// Expo's default Metro config (https://docs.expo.dev/guides/customizing-metro), plus one rule:
// git worktrees of coding agents live under .claude/ (each with its own node_modules) and must
// never be crawled or bundled, or Metro takes minutes to start and finds every module twice.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const existing = config.resolver.blockList;
const blockList = Array.isArray(existing) ? existing : existing ? [existing] : [];
config.resolver.blockList = [...blockList, /[\\/]\.claude[\\/].*/];

module.exports = config;

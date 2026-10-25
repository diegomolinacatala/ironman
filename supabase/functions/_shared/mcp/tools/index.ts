/** The 8 Rebufo MCP tools, in a stable order (better client and prompt caching). */
import { createRegistry } from '../tool.ts';
import type { ToolRegistry } from '../tool.ts';
import { getFriendsAvailabilityTool } from './friends-availability.ts';
import { logCompletedActivityTool } from './log-completed-activity.ts';
import { logDailyMetricsTool } from './log-daily-metrics.ts';
import { logLifeEventTool } from './log-life-event.ts';
import { manageRaceTool } from './manage-race.ts';
import { getPlanForDeviceTool } from './plan-for-device.ts';
import { getPlanningContextTool } from './planning-context.ts';
import { proposePlanChangesTool } from './propose-plan-changes.ts';

export const REBUFO_TOOLS = [
  getPlanningContextTool,
  getFriendsAvailabilityTool,
  proposePlanChangesTool,
  logLifeEventTool,
  logDailyMetricsTool,
  logCompletedActivityTool,
  getPlanForDeviceTool,
  manageRaceTool,
] as const;

export function createRebufoRegistry(): ToolRegistry {
  return createRegistry(REBUFO_TOOLS);
}

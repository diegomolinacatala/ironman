/** The 10 Road to Ironman MCP tools, in a stable order (better client and prompt caching; new tools go last). */
import { createRegistry } from '../tool.ts';
import type { ToolRegistry } from '../tool.ts';
import { getFriendsAvailabilityTool } from './friends-availability.ts';
import { logCompletedActivityTool } from './log-completed-activity.ts';
import { logDailyMetricsTool } from './log-daily-metrics.ts';
import { logLifeEventTool } from './log-life-event.ts';
import { manageRaceTool } from './manage-race.ts';
import { getPlanForDeviceTool } from './plan-for-device.ts';
import { getPlanningContextTool } from './planning-context.ts';
import { proposeJointSessionTool } from './propose-joint-session.ts';
import { proposePlanChangesTool } from './propose-plan-changes.ts';
import { setWeekPlansTool } from './set-week-plans.ts';

export const MCP_TOOLS = [
  getPlanningContextTool,
  getFriendsAvailabilityTool,
  proposeJointSessionTool,
  proposePlanChangesTool,
  logLifeEventTool,
  logDailyMetricsTool,
  logCompletedActivityTool,
  getPlanForDeviceTool,
  manageRaceTool,
  setWeekPlansTool,
] as const;

export function createToolRegistry(): ToolRegistry {
  return createRegistry(MCP_TOOLS);
}

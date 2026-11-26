/** Web stub of the Apple Salud sleep watch (HealthKit only exists on iOS). */
export function watchSleep(_onChange: () => void): () => void {
  return () => undefined;
}

export async function stopSleepWatch(): Promise<void> {
  return undefined;
}

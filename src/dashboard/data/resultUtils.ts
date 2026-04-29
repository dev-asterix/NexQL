export function getSettledResult<T>(
  result: PromiseSettledResult<T>,
  defaultValue: T,
  logLabel: string,
): T {
  if (result.status === 'fulfilled') {
    return result.value;
  }
  console.error(`${logLabel}:`, (result as PromiseRejectedResult).reason?.message || (result as PromiseRejectedResult).reason);
  return defaultValue;
}

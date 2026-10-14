export const logger = (name: string) => ({
  warn: (...args: unknown[]) => console.warn(`[${name}]`, ...args),
  error: (...args: unknown[]) => console.error(`[${name}]`, ...args),
})

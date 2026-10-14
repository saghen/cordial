export const logger = (name: string) => ({
  warn: (...a: unknown[]) => console.warn(`[${name}]`, ...a),
  error: (...a: unknown[]) => console.error(`[${name}]`, ...a),
})

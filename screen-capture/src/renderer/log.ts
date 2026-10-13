export const logger = (name: string) => ({
  info: (...a: unknown[]) => console.info(`[${name}]`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${name}]`, ...a),
  error: (...a: unknown[]) => console.error(`[${name}]`, ...a),
})

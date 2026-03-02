export const logger = {
    log: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.log('[TurnBasedDrawing]', ...args)
        }
    },
    info: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.info('ℹ️ [TurnBasedDrawing]', ...args)
        }
    },
    warn: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.warn('⚠️ [TurnBasedDrawing]', ...args)
        }
    },
    error: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.error('❌ [TurnBasedDrawing]', ...args)
        }
    },
    debug: (...args: any[]) => {
        if (import.meta.env.DEV) {
            console.debug('🐛 [TurnBasedDrawing]', ...args)
        }
    }
}

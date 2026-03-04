export const logger = {
    log: (...args: any[]) => {
        console.log('[TurnBasedDrawing]', ...args)
    },
    info: (...args: any[]) => {
        console.info('[TurnBasedDrawing]', ...args)
    },
    warn: (...args: any[]) => {
        console.warn('[TurnBasedDrawing]', ...args)
    },
    error: (...args: any[]) => {
        console.error('[TurnBasedDrawing]', ...args)
    },
    debug: (...args: any[]) => {
        console.debug('[TurnBasedDrawing]', ...args)
    }
}

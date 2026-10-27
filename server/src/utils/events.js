// Topic 35: EventEmitter. Routes announce "this user's data changed"; interested modules (cache) react without coupling.
import { EventEmitter } from 'node:events';

class SpendIQBus extends EventEmitter {}
export const bus = new SpendIQBus();
bus.setMaxListeners(20);
// An emitter without an 'error' listener would crash the process when something emits 'error'.
bus.on('error', (err) => console.error('[bus] listener error:', err.message));
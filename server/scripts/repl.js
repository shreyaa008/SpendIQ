// Topic 32: Node REPL with the app's models preloaded.  Run: npm run repl
import repl from 'node:repl';
import { connectDb, disconnectDb } from '../src/config/db.js';
import * as models from '../src/models/index.js';
import * as dates from '../src/utils/dates.js';

await connectDb();
console.log('SpendIQ REPL — try: await models.User.countDocuments()   |   dates.currentPeriod()   |   process.versions.v8');
const r = repl.start({ prompt: 'spendiq> ' });
Object.assign(r.context, { models, dates, ...models });
r.on('exit', async () => { await disconnectDb(); process.exit(0); });

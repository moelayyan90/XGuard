import { readJSON } from './io.mjs';
import { loadPolicy, reviewOffer, reviewReceipt } from './verify.mjs';
import { safeReason, serve } from './mcp.mjs';

const [, , action, ...args] = process.argv;
if (action === 'mcp' && args.length === 0 && process.env.XGUARD_VERIFIER_POLICY)
  args.push(process.env.XGUARD_VERIFIER_POLICY);
const commands = new Map([['demo', 0], ['example', 0], ['mcp', 1],
  ['review', 2], ['receipt', 2], ['approve', 4], ['consume', 4], ['reconcile', 4]]);
const write = value => console.log(JSON.stringify(value, null, 2));

async function main() {
  if (commands.get(action) !== args.length) throw new Error('invalid_command_or_arguments');
  if (action === 'demo' || action === 'example') {
    const { fixture } = await import('./fixtures.mjs');
    const { policy, offerInput, receiptInput } = fixture();
    if (action === 'example') return write({ policy, offerInput, receiptInput });
    const { openJournal, recordDecision } = await import('./journal.mjs');
    const db = openJournal(':memory:');
    try {
      const rules = loadPolicy(policy);
      const approved = recordDecision(db, 'approve', rules, 'sample-job', offerInput);
      const used = recordDecision(db, 'consume', rules, 'sample-job', offerInput);
      let replay;
      try { recordDecision(db, 'consume', rules, 'sample-job', offerInput); }
      catch (error) { replay = safeReason(error); }
      if (replay !== 'approval_already_consumed') throw new Error('demo_replay_check_failed');
      write({ fixture: true, amountAtomic: used.amountAtomic, consent: [approved.status, used.status],
        secondUse: replay, receipt: reviewReceipt(rules, receiptInput).status, paymentsSubmitted: 0 });
    } finally { db.close(); }
    return;
  }
  const [policyPath, inputPath, journalPath, operation] = args;
  const policy = loadPolicy(await readJSON(policyPath));
  if (action === 'mcp') return serve(policy);
  const input = await readJSON(inputPath);
  if (action === 'review') return write(reviewOffer(policy, input));
  if (action === 'receipt') return write(reviewReceipt(policy, input));
  const { openJournal, recordDecision, reconcileReceipt } = await import('./journal.mjs');
  const db = openJournal(journalPath);
  try {
    if (action === 'reconcile') return write(reconcileReceipt(db, policy, operation, input.request, input));
    write(recordDecision(db, action, policy, operation, input));
  }
  finally { db.close(); }
}

try { await main(); }
catch (error) {
  console.error(safeReason(error));
  process.exitCode = 1;
}

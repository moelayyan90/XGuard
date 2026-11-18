// Validate existing live credentials without creating an order or moving funds.
import assert from 'node:assert/strict';
const key=process.env.LIVE_ADMIN_KEY||process.env.XGUARD_OPERATOR_KEY;
assert.ok(key&&key.length>=24,'Existing operator credential unavailable');
const r=await fetch('https://xguardgate.com/admin/action-cloud/paypal-readiness',{headers:{authorization:'Bearer '+key,'user-agent':'XGuard-PayPal-credential-check/1.0','x-xguard-traffic-class':'synthetic'},redirect:'error',signal:AbortSignal.timeout(30000)});
const value=await r.json().catch(()=>null);
const error=/^[a-z_]{1,80}$/.test(value?.error||'')?value.error:'provider_authentication_unconfirmed';
assert.equal(r.status,200,`Live PayPal OAuth not confirmed: ${error}`);
assert.equal(value.environment,'live');assert.equal(value.credentials_valid,true);assert.equal(value.transactions_submitted,0);
console.log(JSON.stringify({live_credentials:'validated',checkout_enabled:value.checkout_enabled,checkout_blockers:value.checkout_blockers,merchant_qualification:'not_proven_by_oauth',orders_created:0,captures_submitted:0,real_revenue_verified:false}));

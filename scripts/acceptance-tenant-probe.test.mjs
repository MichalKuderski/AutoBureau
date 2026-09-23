import test from 'node:test';
import assert from 'node:assert/strict';
import { probeForeignHousehold } from './acceptance-tenant-probe.mjs';
const valid = { ownId: '00000000-0000-4000-8000-000000000001', foreignId: '00000000-0000-4000-8000-000000000002', foreignReady:true,cookie:'synthetic-session' };
test('failed second signup cannot produce a misleading tenant request', async () => {
  assert.equal(await probeForeignHousehold(() => assert.fail('must not make a request'), {...valid,foreignReady:false}), null);
});
test('missing, malformed, own-tenant or unauthenticated fixtures never reach the endpoint', async () => {
  for (const changed of [{foreignId:undefined},{foreignId:''},{foreignId:'not-a-uuid'},{foreignId:valid.ownId},{ownId:undefined},{cookie:''}])
    assert.equal(await probeForeignHousehold(() => assert.fail('must not make a request'), {...valid,...changed}),null);
});
test('real distinct fixtures send the exact foreign household and retain the original caller', async () => {
  const result = await probeForeignHousehold(async (path,init) => {
    assert.equal(path,'/v1/households/current');
    assert.deepEqual(init.headers,{cookie:'synthetic-session','x-household-id':valid.foreignId});
    return new Response(null,{status:403});
  },valid);
  assert.equal(result.status,403);
});

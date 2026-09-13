import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { verifyInfrastructureIdentity } from './staging-jobs-oidc.mjs';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const { SignJWT,generateKeyPair }=await import(require.resolve('jose'));
const key=await generateKeyPair('RS256');
const now=Math.floor(Date.now()/1000);
const claims={iss:'https://token.actions.githubusercontent.com',aud:'sts.amazonaws.com',
  sub:'repo:MichalKuderski@177895094/AutoBureau@1336298759:environment:staging',
  repository:'MichalKuderski/AutoBureau',repository_id:'1336298759',repository_owner_id:'177895094',
  environment:'staging',ref:'refs/pull/5/merge',
  workflow_ref:'MichalKuderski/AutoBureau/.github/workflows/staging-jobs.yml@refs/pull/5/merge',iat:now,exp:now+300};
const sign=(p,k=key.privateKey)=>new SignJWT(p).setProtectedHeader({alg:'RS256'}).sign(k);
test('exact signed deployment identity exports only non-secret proof',async()=>{
  const token=await sign({...claims,secret:'must-not-appear'});
  const proof=await verifyInfrastructureIdentity(token,key.publicKey);
  assert.equal(proof.signatureVerified,true);assert.equal(proof.sub,claims.sub);
  assert.ok(!JSON.stringify(proof).includes(token));assert.ok(!JSON.stringify(proof).includes('must-not-appear'));
});
test('legacy subject, foreign repository, environment, workflow and ref cannot deploy',async()=>{
  for(const field of ['iss','aud','sub','repository','repository_id','repository_owner_id','environment','ref','workflow_ref'])
    await assert.rejects(verifyInfrastructureIdentity(await sign({...claims,[field]:'wrong'}),key.publicKey));
});
test('unsigned, wrong-key, expired, future and overlong capabilities are rejected',async()=>{
  await assert.rejects(verifyInfrastructureIdentity('unsigned',key.publicKey));
  const other=await generateKeyPair('RS256');
  await assert.rejects(verifyInfrastructureIdentity(await sign(claims,other.privateKey),key.publicKey));
  for(const change of [{exp:now-1},{iat:now+100},{exp:now+601}])
    await assert.rejects(verifyInfrastructureIdentity(await sign({...claims,...change}),key.publicKey));
});

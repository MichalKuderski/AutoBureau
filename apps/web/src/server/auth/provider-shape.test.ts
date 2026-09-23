// @vitest-environment node
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isPendingProviderUser, parseProviderTokens } from "./provider-shape";
const ID="11111111-1111-4111-8111-111111111111";
const valid={access_token:"at",refresh_token:"rt",expires_in:3600};
describe("provider shape projection",()=>{
  it("projects only the session fields",()=>assert.deepEqual(parseProviderTokens({...valid,private:"DO_NOT_PROPAGATE",user:{role:"admin"}}),{accessToken:"at",refreshToken:"rt",expiresIn:3600}));
  for(const [name,value] of Object.entries({null:null,array:[],empty:{},string:"token",number:1,bool:true,missingAccess:{refresh_token:"rt",expires_in:1},emptyAccess:{...valid,access_token:""},numericAccess:{...valid,access_token:42},missingRefresh:{access_token:"at",expires_in:1},emptyRefresh:{...valid,refresh_token:""},objectRefresh:{...valid,refresh_token:{}},missingExpiry:{access_token:"at",refresh_token:"rt"},stringExpiry:{...valid,expires_in:"3600"},zero:{...valid,expires_in:0},negative:{...valid,expires_in:-1},fraction:{...valid,expires_in:0.5},nan:{...valid,expires_in:NaN},infinity:{...valid,expires_in:Infinity},unsafe:{...valid,expires_in:Number.MAX_SAFE_INTEGER+1}})){
    it(`rejects ${name}`,()=>assert.equal(parseProviderTokens(value),null));
  }
  it("accepts a pending user without interpreting provider metadata",()=>assert.equal(isPendingProviderUser({id:ID,email:"different@example.test",identities:[],user_metadata:{role:"admin"}}),true));
  for(const [name,value] of Object.entries({null:null,array:[{id:ID}],empty:{},nonUUID:{id:"private"},numericID:{id:1},partialAccess:{id:ID,access_token:"at"},nullRefresh:{id:ID,refresh_token:null},partialExpiry:{id:ID,expires_in:0},session:{id:ID,...valid}})){
    it(`does not call ${name} pending`,()=>assert.equal(isPendingProviderUser(value),false));
  }
  it("does not accept an unsafe lifetime even next to a valid user id",()=>{const body={id:ID,...valid,expires_in:Number.MAX_SAFE_INTEGER+1};assert.equal(parseProviderTokens(body),null);assert.equal(isPendingProviderUser(body),false);});
});

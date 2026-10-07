import { afterEach, expect, it } from "vitest";
import { observeReadTransaction, withReadTransactions } from "./read-transactions";
import { setLogSink, resetLogSink, type LogRecord } from "./logger";
afterEach(resetLogSink);
it("isolates correlation, caps records and ignores unrelated routes without copying extra metadata",async()=>{
 const records:LogRecord[]=[];setLogSink(r=>records.push(r));
 const e={operation:"principal",outcome:"success",acquisition_ms:2,execution_ms:3,waiting_at_start:1,active_at_start:1,secret:"PRIVATE"} as const;
 await Promise.all([withReadTransactions("GET","/v1/dashboard","first",async()=>{await Promise.resolve();for(let i=0;i<20;i++)observeReadTransaction(e);}),withReadTransactions("GET","/v1/obligations","second",async()=>observeReadTransaction(e))]);
 await withReadTransactions("POST","/v1/obligations","ignored",async()=>observeReadTransaction(e));
 expect(records).toHaveLength(17); expect(records.filter(r=>r.trace_id==="first")).toHaveLength(16);
 expect(records.filter(r=>r.trace_id==="second")).toHaveLength(1);expect(JSON.stringify(records)).not.toContain("PRIVATE");
});

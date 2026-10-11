import {fork} from 'node:child_process';
import {stages,reasons,blankResults} from './staging-binding-protocol.mjs';
// Event [stage index, START=0/PASS=1/FAIL=2, reason index]. Neither output
// stream is read or forwarded. Every field and transition is validated.
export function supervise(worker, env, timeoutMs = 30000) {
  return new Promise(resolve => {
    const results=blankResults();
    let next=0,active=null,reported=false,forced=null,finished=false,child;
    const finish=(code,signal)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      const ok=!forced && !reported && next===stages.length && code===0 && !signal;
      const reason=ok?'NONE':forced ?? (reported && code===1 && !signal?'REPORTED_FAILURE':'WORKER_FAILURE');
      if(active!==null) results[active]={status:'FAIL',reason};
      resolve({ok,reason,results});
    };
    const stop=reason=>{forced=reason;child?.kill('SIGKILL');};
    const timer=setTimeout(()=>stop('WATCHDOG_TIMEOUT'),timeoutMs);
    try {child=fork(worker,[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});}
    catch {finish(null,null);return;}
    child.on('message',value=>{
      if(forced)return;
      if(!Array.isArray(value) || value.length!==3 || !value.every(Number.isInteger) ||
        reported || value[0]!==next || next>=stages.length) {stop('PROTOCOL_FAILURE');return;}
      const [index,event,reason]=value;
      if(event===0 && active===null && reason===0) {active=index;return;}
      if(active!==index || ![1,2].includes(event) ||
        (event===1 && reason!==0) || (event===2 && (reason<=0 || reason>=reasons.length))) {
        stop('PROTOCOL_FAILURE');return;
      }
      results[index]={status:event===1?'PASS':'FAIL',reason:reasons[reason]};
      active=null;
      if(event===1)next++;else reported=true;
    });
    child.on('error',()=>finish(null,null));
    child.on('exit',finish);
  });
}

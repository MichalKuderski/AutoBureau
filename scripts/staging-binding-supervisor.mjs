import {fork} from 'node:child_process';
// The child may emit arbitrary native/driver errors; neither output stream is read
// or forwarded. IPC is accepted only as the next integer in a closed sequence.
export function supervise(worker, env, timeoutMs = 30000) {
  return new Promise(resolve => {
    let count=0, invalid=false, finished=false;
    const child=fork(worker,[],{env,execArgv:[],stdio:['ignore','ignore','ignore','ipc']});
    const timer=setTimeout(()=>{invalid=true;child.kill('SIGKILL');},timeoutMs);
    const finish=ok=>{if(finished)return;finished=true;clearTimeout(timer);resolve({ok,count:invalid?0:count});};
    child.on('message',value=>{
      if (value !== count || count >= 4) {invalid=true;child.kill('SIGKILL');}
      else count++;
    });
    child.on('error',()=>finish(false));
    child.on('exit',(code,signal)=>finish(!invalid && code===0 && !signal && count===4));
  });
}

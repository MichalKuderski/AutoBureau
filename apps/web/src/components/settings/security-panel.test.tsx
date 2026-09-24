import { afterEach,expect,it,vi } from "vitest";
import { render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecurityPanel } from "./security-panel";
const id="22222222-2222-4222-8222-222222222222",cid="33333333-3333-4333-8333-333333333333";
const inventory={factors:[{id,factor_type:"totp",status:"verified"}],level:"aal1",requiresMfa:true,lostFactorSelfService:false};
afterEach(()=>vi.unstubAllGlobals());
it("keyboard request/verify flow has a labeled focused input and live confirmation",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(inventory)).mockResolvedValueOnce(Response.json({challengeId:cid,expiresAt:999})).mockResolvedValueOnce(Response.json({verified:true}));vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<SecurityPanel/>);
 await user.tab();expect(screen.getByRole('button',{name:'Refresh factors'})).toHaveFocus();await user.keyboard('{Enter}');
 await user.click(await screen.findByRole('button',{name:'Request code for authenticator 1'}));
 const input=await screen.findByLabelText('Authenticator code');await waitFor(()=>expect(input).toHaveFocus());
 await user.type(input,'123456');await user.click(screen.getByRole('button',{name:'Verify session'}));
 expect(await screen.findByText('Session verified. You can return to your household.')).toHaveAttribute('role','status');
 expect(fetcher.mock.calls[2]?.[1]).toMatchObject({credentials:'same-origin',cache:'no-store',headers:{'x-autobureau-request':'1'}});
 expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
});
it("destructive action requires confirmation; cancel returns focus without a request",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json(inventory));vi.stubGlobal('fetch',fetcher);const user=userEvent.setup();render(<SecurityPanel/>);
 await user.click(screen.getByRole('button',{name:'Refresh factors'}));const button=await screen.findByRole('button',{name:'Remove authenticator 1'});await user.click(button);
 expect(screen.getByRole('group',{name:'Confirm authenticator removal'})).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Cancel removal'}));
 expect(button).toHaveFocus();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("provider failure reports uncertainty without automatic retry or success",async()=>{
 const fetcher=vi.fn().mockRejectedValue(new Error('synthetic'));vi.stubGlobal('fetch',fetcher);const user=userEvent.setup();render(<SecurityPanel/>);
 await user.click(screen.getByRole('button',{name:'Refresh factors'}));expect(await screen.findByRole('status')).toHaveTextContent('could not be confirmed');expect(fetcher).toHaveBeenCalledTimes(1);
});
it("after a keyboard action the pressed (disabled-while-busy) button's focus moves to the announcing status, never to <body>",async()=>{
 let resolve!:(r:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));const user=userEvent.setup();render(<SecurityPanel/>);
 await user.tab();await user.keyboard('{Enter}');
 // Browsers blur a focused control when it becomes disabled; jsdom does not, so do it here.
 (document.activeElement as HTMLElement).blur();expect(document.body).toHaveFocus();
 resolve(Response.json(inventory));
 const status=await screen.findByText('Factor list refreshed.');
 await waitFor(()=>expect(status).toHaveFocus());
});

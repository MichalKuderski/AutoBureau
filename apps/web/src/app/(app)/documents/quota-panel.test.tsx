import {it,expect} from 'vitest';
import {render,screen} from '@testing-library/react';
import {QuotaPanel} from './quota-panel';
import type {DocumentQuota} from '@autobureau/contracts';
const base:DocumentQuota={plan:'free',processed:8,allowance:10,warningThreshold:8,warning:true,reservedSlots:1,queuedClean:2,processing:0,needsReview:1,actionRequired:0,nextPeriod:'2026-10-01T00:00:00.000Z',grace:false,localOnly:true};
it.each([['free',8,10],['premium',40,50]] as const)('announces the authoritative %s warning and keeps queues distinct', (plan,processed,allowance)=>{
 render(<QuotaPanel quota={{...base,plan,processed,allowance}}/>);expect(screen.getByRole('region',{name:'Document processing'})).toBeInTheDocument();
 expect(screen.getByText(new RegExp(`${processed} of ${allowance} documents`))).toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('Approaching');
 expect(screen.getByText(/1 slots reserved · 2 queued · 0 processing · 1 need review/)).toBeInTheDocument();expect(screen.queryByText(/unlimited/i)).not.toBeInTheDocument();
});
it('announces cap and pending action without a deletion or upgrade promise',()=>{render(<QuotaPanel quota={{...base,processed:10,actionRequired:1,grace:true}}/>);expect(screen.getByText(/Monthly processing allowance reached/)).toBeInTheDocument();expect(screen.getByText(/need a decision/)).toBeInTheDocument();expect(screen.getByText(/payment grace/)).toBeInTheDocument();expect(screen.getByText(/at 00:00 UTC/)).toBeInTheDocument();});
it('does not announce a warning based on browser arithmetic',()=>{render(<QuotaPanel quota={{...base,processed:7,warning:false}}/>);expect(screen.queryByRole('status')).not.toBeInTheDocument();});

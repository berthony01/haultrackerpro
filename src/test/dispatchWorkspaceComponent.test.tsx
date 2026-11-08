import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DispatchLoadForm } from '@/components/telegram/dispatch/DispatchLoadForm';
import { DispatchWorkspace } from '@/components/telegram/DispatchWorkspace';
const h=vi.hoisted(()=>({state:{} as any,rpc:vi.fn(),refresh:vi.fn()}));
vi.mock('@/hooks/useDispatchWorkspace',()=>({useDispatchWorkspace:()=>h.state,dispatchRpc:(...args:unknown[])=>h.rpc(...args)}));
const driver={relationship_id:'rel-1',display_name:'QA Driver'};
const load={id:'load-1',relationship_id:'rel-1',display_name:'QA Driver',load_reference:'QA1234',pickup_location:'Dallas, TX',dropoff_location:'Austin, TX',load_date:'2026-11-01',dropoff_date:'2026-11-03',status:'pending',loaded_miles:200,deadhead_miles:10,total_miles:210,estimated_pay:400,actual_delivery_date:null};
beforeEach(()=>{vi.clearAllMocks();h.state={scope:'user:company',permissions:{view:true,create:true,status:true},page:{loads:[load],drivers:[driver],total:51,driver_total:1,summaries:[],week_start:'2026-11-01'},verified:true,loading:false,error:null,refresh:h.refresh};});
beforeEach(()=>{
  HTMLElement.prototype.hasPointerCapture=()=>false;
  HTMLElement.prototype.setPointerCapture=()=>{};
  HTMLElement.prototype.releasePointerCapture=()=>{};
  HTMLElement.prototype.scrollIntoView=()=>{};
});
describe('Dispatch forms and confirmations',()=>{
  it('keeps failed creation open and retries exact same payload/key',async()=>{
    const save=vi.fn().mockRejectedValueOnce(new Error('Ambiguous network result')).mockResolvedValueOnce(undefined),close=vi.fn();
    render(<DispatchLoadForm drivers={[driver]} enabled save={save} close={close}/>);
    fireEvent.change(screen.getByLabelText('Paste dispatch details'),{target:{value:'LOAD# QA1234\nPickup: Dallas, TX\nDelivery: Austin, TX\nFlat rate $400'}});fireEvent.click(screen.getByRole('button',{name:'Extract for review'}));
    // Select from the real Radix control.
    fireEvent.keyDown(screen.getByRole('combobox',{name:'Connected driver'}),{key:'ArrowDown'});
    fireEvent.click(await screen.findByRole('option',{name:'QA Driver'}));
    fireEvent.click(screen.getByRole('button',{name:'Review load'}));
    fireEvent.click(await screen.findByRole('button',{name:'Confirm & save pending load'}));await screen.findByText('Ambiguous network result');expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirm & save pending load'}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(1));expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  });
  it('closing cancellation cannot submit or mutate a load',()=>{
    render(<DispatchWorkspace recruiterId="company"/>);fireEvent.click(screen.getByRole('button',{name:'Cancel Load'}));expect(screen.getByText(/QA1234 · QA Driver/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Keep unchanged / Close'}));expect(h.rpc).not.toHaveBeenCalled();
  });
  it('requires an actual delivery date and never uses the scheduled date',async()=>{
    render(<DispatchWorkspace recruiterId="company"/>);fireEvent.click(screen.getByRole('button',{name:'Mark Delivered'}));expect(screen.getByLabelText('Actual delivery date')).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'Confirm Delivered'}));expect(h.rpc).not.toHaveBeenCalled();
  });
  it('preserves status after failure, refreshes, and retries with the same key',async()=>{
    h.rpc.mockResolvedValueOnce({data:null,error:{message:'network'}}).mockResolvedValueOnce({data:{id:'load-1',status:'cancelled'},error:null});
    render(<DispatchWorkspace recruiterId="company"/>);fireEvent.click(screen.getByRole('button',{name:'Cancel Load'}));fireEvent.click(screen.getByRole('button',{name:'Yes, cancel this load'}));await waitFor(()=>expect(h.refresh).toHaveBeenCalledTimes(1));expect(screen.getByText('pending')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Yes, cancel this load'}));await screen.findByText('Cancellation confirmed.');expect(h.rpc.mock.calls[0][1]._idempotency_key).toBe(h.rpc.mock.calls[1][1]._idempotency_key);
  });
  it('removes forms/confirmation and prior load data when access is denied',()=>{
    const view=render(<DispatchWorkspace recruiterId="company"/>);fireEvent.click(screen.getByRole('button',{name:'Cancel Load'}));h.state={...h.state,permissions:{view:false,create:false,status:false},page:null};view.rerender(<DispatchWorkspace recruiterId="company"/>);expect(screen.queryByText('QA1234')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Yes, cancel this load'})).not.toBeInTheDocument();
  });
  it('blocks create and status independently for view-only staff',()=>{h.state.permissions={view:true,create:false,status:false};render(<DispatchWorkspace recruiterId="company"/>);expect(screen.getByText('QA1234')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Add Load'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Mark Delivered'})).not.toBeInTheDocument();});
  it('uses total matching rows, not page length, for pagination',()=>{render(<DispatchWorkspace recruiterId="company"/>);expect(screen.getByText('1–25 of 51')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Next loads'})).toBeEnabled();});
});
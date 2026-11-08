import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDispatchWorkspace, type DispatchQuery } from '@/hooks/useDispatchWorkspace';
import { RECRUITER_STAFF_PERMISSION_KEYS } from '@/lib/recruiterStaffPermissions';
const h=vi.hoisted(()=>({userId:'user-a',rpc:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.userId}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
const permissions=Object.fromEntries(RECRUITER_STAFF_PERMISSION_KEYS.map(key=>[key,true]));
const query:DispatchQuery={relationship:'',bucket:'active',status:'',offset:0,date:'2026-11-08',driverOffset:0};
const page=(id='a')=>({loads:[{id}],drivers:[],summaries:[],total:1,driver_total:0,week_start:'2026-11-08'});
beforeEach(()=>{h.rpc.mockReset();h.userId='user-a';});
describe('Dispatch permission and query lifetime',()=>{
  it('preserves only inactive form authority after a transient error, then clears it on explicit denial',async()=>{
    h.rpc.mockResolvedValueOnce({data:permissions,error:null}).mockResolvedValueOnce({data:page(),error:null})
      .mockResolvedValueOnce({data:permissions,error:null}).mockResolvedValueOnce({data:null,error:{code:'NETWORK'}})
      .mockResolvedValueOnce({data:{...permissions,loads_view:false},error:null});
    const {result}=renderHook(()=>useDispatchWorkspace('company',query));
    await waitFor(()=>expect(result.current.verified).toBe(true));
    await act(()=>result.current.refresh());
    expect(result.current.page).toBeNull();expect(result.current.verified).toBe(false);expect(result.current.permissions.create).toBe(true);
    await act(()=>result.current.refresh());
    expect(result.current.permissions).toEqual({view:false,create:false,status:false});expect(result.current.page).toBeNull();
  });
  it('immediately clears prior authority when the server denies a read',async()=>{
    h.rpc.mockResolvedValueOnce({data:permissions,error:null}).mockResolvedValueOnce({data:page(),error:null})
      .mockResolvedValueOnce({data:permissions,error:null}).mockResolvedValueOnce({data:null,error:{code:'42501'}});
    const {result}=renderHook(()=>useDispatchWorkspace('company',query));await waitFor(()=>expect(result.current.verified).toBe(true));
    await act(()=>result.current.refresh());expect(result.current.permissions.view).toBe(false);expect(result.current.page).toBeNull();
  });
  it('rejects partial permission payloads before querying loads',async()=>{
    h.rpc.mockResolvedValue({data:{loads_view:true},error:null});
    const {result}=renderHook(()=>useDispatchWorkspace('company',query));await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.permissions.view).toBe(false);expect(h.rpc).toHaveBeenCalledTimes(1);
  });
  it('never restores an old account response after switching users',async()=>{
    let finishOld!:(value:unknown)=>void;
    const old=new Promise(resolve=>{finishOld=resolve;});let reads=0;
    h.rpc.mockImplementation((name:string)=>name==='get_my_recruiter_permissions'?Promise.resolve({data:permissions,error:null}):++reads===1?old:Promise.resolve({data:page('b'),error:null}));
    const {result,rerender}=renderHook(()=>useDispatchWorkspace('company',query));await waitFor(()=>expect(reads).toBe(1));
    h.userId='user-b';rerender();expect(result.current.page).toBeNull();await waitFor(()=>expect(result.current.page?.loads[0].id).toBe('b'));
    await act(async()=>{finishOld({data:page('a'),error:null});await old;});expect(result.current.page?.loads[0].id).toBe('b');
  });
});

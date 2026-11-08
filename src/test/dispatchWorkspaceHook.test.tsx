import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDispatchWorkspace, type DispatchQuery } from '@/hooks/useDispatchWorkspace';
import { RECRUITER_STAFF_PERMISSION_KEYS } from '@/lib/recruiterStaffPermissions';
const h=vi.hoisted(()=>({userId:'user-a',rpc:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.userId}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc}}));
const permissions=Object.fromEntries(RECRUITER_STAFF_PERMISSION_KEYS.map(key=>[key,true]));
const query:DispatchQuery={relationship:'',bucket:'active',status:'',offset:0,date:'2026-11-08',driverOffset:0};
const page=(id='a')=>({loads:[{id}],drivers:[],summaries:[],total:1,driver_total:0,week_start:'2026-11-08'});
beforeEach(()=>{h.rpc.mockReset();h.userId='user-a';});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe('Dispatch permission and query lifetime',()=>{
  it('forces a fresh read after a mutation and ignores an older in-flight response',async()=>{
    let finish!:(value:unknown)=>void;
    const deferred=new Promise(resolve=>{finish=resolve;});let reads=0;
    h.rpc.mockImplementation((name:string)=>name==='get_my_recruiter_permissions'
      ? Promise.resolve({data:permissions,error:null})
      : ++reads===2?deferred:Promise.resolve({data:page(reads===1?'before':'after'),error:null}));
    const {result}=renderHook(()=>useDispatchWorkspace('company',query));
    await waitFor(()=>expect(result.current.verified).toBe(true));
    let old!:Promise<void>;
    act(()=>{old=result.current.refresh();});
    await waitFor(()=>expect(reads).toBe(2));
    await act(()=>result.current.refresh(true));
    expect(result.current.page?.loads[0].id).toBe('after');
    await act(async()=>{finish({data:page('stale'),error:null});await old;});
    expect(result.current.page?.loads[0].id).toBe('after');
  });
  it('clears results immediately when filters change, without labelling old loads as the new filter',async()=>{
    let finish!:(value:unknown)=>void;
    const deferred=new Promise(resolve=>{finish=resolve;});let reads=0;
    h.rpc.mockImplementation((name:string)=>name==='get_my_recruiter_permissions'
      ? Promise.resolve({data:permissions,error:null})
      : ++reads===1?Promise.resolve({data:page('active'),error:null}):deferred);
    const {result,rerender}=renderHook(({q})=>useDispatchWorkspace('company',q),{initialProps:{q:query}});
    await waitFor(()=>expect(result.current.verified).toBe(true));
    rerender({q:{...query,bucket:'history'}});
    expect(result.current.page).toBeNull();expect(result.current.verified).toBe(false);
    await act(async()=>{finish({data:page('history'),error:null});await deferred;});
    expect(result.current.page?.loads[0].id).toBe('history');
  });
  it('pauses background polling while hidden and rechecks when the app becomes visible',async()=>{
    vi.useFakeTimers();
    const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
    h.rpc.mockImplementation((name:string)=>Promise.resolve({data:name==='get_my_recruiter_permissions'?permissions:page(),error:null}));
    const {result,unmount}=renderHook(()=>useDispatchWorkspace('company',query));
    await act(async()=>{await Promise.resolve();});
    expect(result.current.verified).toBe(true);expect(h.rpc).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('hidden');
    await act(()=>vi.advanceTimersByTimeAsync(30000));
    expect(h.rpc).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue('visible');
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});
    expect(h.rpc).toHaveBeenCalledTimes(4);expect(result.current.verified).toBe(true);
    unmount();
  });
  it('coalesces overlapping focus and visibility checks instead of restarting the request',async()=>{
    let finish!:(value:unknown)=>void;
    const deferred=new Promise(resolve=>{finish=resolve;});let permissionReads=0;
    h.rpc.mockImplementation((name:string)=>name==='get_my_recruiter_permissions'
      ? ++permissionReads===1?Promise.resolve({data:permissions,error:null}):deferred
      : Promise.resolve({data:page(),error:null}));
    const {result}=renderHook(()=>useDispatchWorkspace('company',query));
    await waitFor(()=>expect(result.current.verified).toBe(true));
    act(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
    expect(permissionReads).toBe(2);
    await act(async()=>{finish({data:permissions,error:null});await deferred;});
    await waitFor(()=>expect(result.current.verified).toBe(true));
  });
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

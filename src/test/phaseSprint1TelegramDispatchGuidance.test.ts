// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { getTelegramDispatchGuidance, runTelegramPoll, TELEGRAM_DISPATCH_GUIDANCE_ENABLED,
  type TelegramPollLedger, type TelegramGateway } from '../../supabase/functions/_shared/telegram-poll-ingest';
import { TGG1B_DISPATCH_GROUP_REVIEW_ENABLED } from '../../supabase/functions/_shared/telegram-dispatch-group-review';
const input = (text='/dispatch', chatType='group', telegramUserId=501, telegramChatId=-100) => ({text,chatType,telegramUserId,telegramChatId});
describe('Sprint 1 dispatcher guidance production-used path',()=>{
 it('only read-only guidance is on; test-injected OFF never calls authorization',async()=>{
   const auth=vi.fn(); expect(TELEGRAM_DISPATCH_GUIDANCE_ENABLED).toBe(true);
   expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
   expect(await getTelegramDispatchGuidance(input(),auth,false)).toBe(false); expect(auth).not.toHaveBeenCalled();
 });
 it.each(['/dispatch','/dispatch@HaulTrackerBot','/help','/help@HaulTrackerBot'])('authorizes exact transport group command %s',async(text)=>{
   const auth=vi.fn().mockResolvedValue(true); expect(await getTelegramDispatchGuidance(input(text),auth,true)).toBe(true);
   expect(auth).toHaveBeenCalledWith({telegramUserId:501,telegramChatId:-100,chatType:'group'});
 });
 it.each(['/start','/menu','/status','/help','/dispatch'])('private %s checks authorized bound workspace without caller-supplied workspace',async(text)=>{
   const auth=vi.fn().mockResolvedValue(true); expect(await getTelegramDispatchGuidance(input(text,'private',501,501),auth,true)).toBe(true);
   expect(auth).toHaveBeenCalledWith({telegramUserId:501,telegramChatId:null,chatType:'private'});
 });
 it.each(['Load AB123 delivered','/bind '+ 'a'.repeat(64),'/dispatch@OtherBot','/dispatch extra','hello'])('never sends unsolicited or mismatched guidance: %s',async(text)=>{
   const auth=vi.fn(); expect(await getTelegramDispatchGuidance(input(text),auth,true)).toBe(false); expect(auth).not.toHaveBeenCalled();
 });
 it.each([false,null,undefined,{},'true',1])('strictly denies malformed/negative RPC output %s',async(result)=>{
   expect(await getTelegramDispatchGuidance(input(),async()=>result,true)).toBe(false);
 });
 it('missing RPC, error and invalid transport identity fail closed',async()=>{
   expect(await getTelegramDispatchGuidance(input(),undefined,true)).toBe(false);
   expect(await getTelegramDispatchGuidance(input(),async()=>{throw Error('PGRST202');},true)).toBe(false);
   expect(await getTelegramDispatchGuidance(input('/dispatch','private',501,502),async()=>true,true)).toBe(false);
 });
 it.each([true,false])('receipt replay suppresses sends; denial preserves cursor (%s)',async(allowed)=>{
   const sendMessage=vi.fn().mockResolvedValue({ok:true,status:200});
   const auth=vi.fn().mockResolvedValue(allowed);
   const ignored=vi.fn().mockResolvedValueOnce({isNew:true,resultCode:'non_private_message'}).mockResolvedValueOnce({isNew:false,resultCode:'non_private_message'});
   const ledger={claimLease:async()=>({leaseToken:'lease',nextOffset:1}),releaseLease:async()=>true,
     advanceCursor:vi.fn().mockResolvedValue(2),recordIgnoredUpdate:ignored} as unknown as TelegramPollLedger;
   const gateway={getUpdates:async()=>({ok:true,status:200,result:[{update_id:1,message:{from:{id:501},chat:{id:-100,type:'group'},text:'/dispatch'}}]}),sendMessage} as TelegramGateway;
   for(let n=0;n<2;n++) expect((await runTelegramPoll({ledger,gateway,sha256:async()=> 'a'.repeat(64),authorizeDispatchGuidance:auth,
     dispatchGuidanceButtons:{private:[],group:[[{text:'Open Dispatch Menu',url:'https://t.me/HaulTrackerBot'}]]}})).kind).toBe('ok');
   expect(sendMessage).toHaveBeenCalledTimes(allowed?1:0); expect(ledger.advanceCursor).toHaveBeenCalledTimes(2);
   if(allowed) expect(sendMessage.mock.calls[0][0].buttons[0][0].url).toBe('https://t.me/HaulTrackerBot');
 });
 it.each([
   ['/dispatch','group',true,true,1],
   ['/dispatch@HaulTrackerBot','supergroup',true,true,1],
   ['/help','group',true,true,1],
   ['/help@HaulTrackerBot','supergroup',true,true,1],
   ['/dispatch','group',false,true,0],
   ['/dispatch','group',true,false,0],
   ['Load AB123 delivered','group',true,true,0],
   ['hello','supergroup',true,true,0],
 ] as const)('explicit group flow %s/%s allowed=%s enabled=%s',async(text,chatType,allowed,enabled,sends)=>{
   const auth=vi.fn().mockResolvedValue(allowed);
   const sendMessage=vi.fn().mockResolvedValue({ok:true,status:200});
   const ledger={claimLease:async()=>({leaseToken:'lease',nextOffset:1}),releaseLease:async()=>true,advanceCursor:async()=>2,
     recordIgnoredUpdate:async()=>({isNew:true,resultCode:'non_private_message'})} as unknown as TelegramPollLedger;
   const gateway={getUpdates:async()=>({ok:true,status:200,result:[{update_id:1,message:{from:{id:501},chat:{id:-100,type:chatType},text}}]}),sendMessage} as TelegramGateway;
   expect((await runTelegramPoll({ledger,gateway,sha256:async()=> 'a'.repeat(64),authorizeDispatchGuidance:auth,dispatchGuidanceEnabled:enabled})).kind).toBe('ok');
   expect(sendMessage).toHaveBeenCalledTimes(sends);
   expect(auth).toHaveBeenCalledTimes(enabled && text.startsWith('/')?1:0);
 });
 it.each(['/start','/menu','/help','/status'])('private multi-role %s preserves menu actions alongside authorized dispatcher section',async(text)=>{
   const menuButtons=[[{text:'Post Opportunity',callbackData:'q1:new'}],[{text:'Find Work',url:'https://haultrackerpro.com/find-work'}]];
   const menu=vi.fn().mockResolvedValue({isNew:true,resultCode:'menu_multi_role',menuText:'Driver\nRecruiter',menuButtons});
   const ledger={claimLease:async()=>({leaseToken:'lease',nextOffset:1}),releaseLease:async()=>true,advanceCursor:async()=>2,processMenuUpdate:menu} as unknown as TelegramPollLedger;
   const sendMessage=vi.fn().mockResolvedValue({ok:true,status:200});
   const auth=vi.fn().mockResolvedValue(true);
   const gateway={getUpdates:async()=>({ok:true,status:200,result:[{update_id:1,message:{from:{id:501},chat:{id:501,type:'private'},text}}]}),sendMessage} as TelegramGateway;
   expect((await runTelegramPoll({ledger,gateway,sha256:async()=> 'a'.repeat(64),authorizeDispatchGuidance:auth,
     dispatchGuidanceButtons:{private:[[{text:'Open App',url:'https://haultrackerpro.com/dashboard'}]],group:[]}})).kind).toBe('ok');
   expect(menu).toHaveBeenCalledTimes(1);
   expect(auth).toHaveBeenCalledWith({telegramUserId:501,telegramChatId:null,chatType:'private'});
   expect(sendMessage).toHaveBeenCalledTimes(2);
   expect(sendMessage.mock.calls[0][0].buttons).toEqual(menuButtons);
   expect(sendMessage.mock.calls[1][0].buttons).toEqual([[{text:'Open App',url:'https://haultrackerpro.com/dashboard'}]]);
 });
});
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { getTelegramDispatchGuidance, runTelegramPoll, TELEGRAM_DISPATCH_GUIDANCE_ENABLED,
  type TelegramPollLedger, type TelegramGateway } from '../../supabase/functions/_shared/telegram-poll-ingest';
import { TGG1B_DISPATCH_GROUP_REVIEW_ENABLED } from '../../supabase/functions/_shared/telegram-dispatch-group-review';
const input = (text='/dispatch', chatType='group', telegramUserId=501, telegramChatId=-100) => ({text,chatType,telegramUserId,telegramChatId});
describe('Sprint 1 dispatcher guidance production-used path',()=>{
 it('both production gates remain false and never call authorization by default',async()=>{
   const auth=vi.fn(); expect(TELEGRAM_DISPATCH_GUIDANCE_ENABLED).toBe(false);
   expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);
   expect(await getTelegramDispatchGuidance(input(),auth)).toBe(false); expect(auth).not.toHaveBeenCalled();
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
   for(let n=0;n<2;n++) expect((await runTelegramPoll({ledger,gateway,sha256:async()=> 'a'.repeat(64),dispatchGuidanceEnabled:true,authorizeDispatchGuidance:auth,
     dispatchGuidanceButtons:{private:[],group:[[{text:'Open Dispatch Menu',url:'https://t.me/HaulTrackerBot'}]]}})).kind).toBe('ok');
   expect(sendMessage).toHaveBeenCalledTimes(allowed?1:0); expect(ledger.advanceCursor).toHaveBeenCalledTimes(2);
   if(allowed) expect(sendMessage.mock.calls[0][0].buttons[0][0].url).toBe('https://t.me/HaulTrackerBot');
 });
});
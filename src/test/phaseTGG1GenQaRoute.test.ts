// Synthetic transport/ports only; real SQL authority remains in the disposable PG suite.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyUpdate, runTelegramPoll, runDispatchReviewDeliveryDrain, type TelegramPollLedger, type TelegramGateway } from '../../supabase/functions/_shared/telegram-poll-ingest';
import { TELEGRAM_GENQA_GROUP_ACCEPTANCE_ENABLED, TGG1B_DISPATCH_GROUP_REVIEW_ENABLED, TELEGRAM_SINGLE_LOAD_QA_ENABLED, TELEGRAM_GENQA_RPCS, TELEGRAM_GENQA_CHAT_ID as CHAT, buildGenQaDeliveryLedger, composeDispatchReviewData } from '../../supabase/functions/_shared/telegram-dispatch-group-review';
const ID='00000000-0000-4000-8000-000000000001';
const cmd='/cancelled@HaulTrackerBot HTP-QA-GEN1';
const identity=(text=cmd,chat=CHAT)=>({updateId:1,telegramUserId:501,telegramChatId:chat,chatType:'group',text,callbackData:null,callbackQueryId:null,replyToMessageId:null});
const msg=(text=cmd,chat=CHAT)=>({update_id:1,message:{from:{id:501},chat:{id:chat,type:'group'},text}});
const cb=(actor=501)=>({update_id:2,callback_query:{id:'c2',from:{id:actor},data:composeDispatchReviewData('accept',ID),message:{chat:{id:CHAT,type:'group'}}}});
function fixture(updates:unknown[]){
 const intake=vi.fn(async()=>({isNew:true,resultCode:'dispatch_review_proposed' as const}));
 const review=vi.fn(async(i:{telegramUserId:number})=>({isNew:true,resultCode:i.telegramUserId===501?'dispatch_review_accepted' as const:'dispatch_review_denied' as const}));
 const generic=vi.fn(),old=vi.fn(),claimLease=vi.fn(async()=>({leaseToken:ID,nextOffset:1}));
 const ledger:TelegramPollLedger={claimLease,releaseLease:async()=>true,advanceCursor:async(_,n)=>n,recordIgnoredUpdate:async i=>({isNew:true,resultCode:i.resultCode}),processStartUpdate:async()=>({isNew:true,resultCode:'link_rejected'}),processBindUpdate:async()=>({isNew:true,resultCode:'bind_rejected'}),processConversationActionUpdate:async()=>({isNew:true,resultCode:'conversation_action_invalid'}),processGenQaDispatchGroupUpdate:intake,processGenQaDispatchReviewActionUpdate:review,processDispatchGroupUpdate:generic,processDispatchReviewActionUpdate:generic,processQaDispatchGroupUpdate:old,processQaDispatchReviewActionUpdate:old};
 const gateway:TelegramGateway={getUpdates:vi.fn(async()=>({ok:true,status:200,result:updates})),sendMessage:vi.fn(async()=>({ok:true,status:200,result:{message_id:9}})),answerCallbackQuery:vi.fn(async()=>({ok:true,status:200}))};
 const poll=(genQaEnabled=true,extra={})=>runTelegramPoll({ledger,gateway,sha256:async()=> 'a'.repeat(64),genQaEnabled,...extra});
 return {ledger,gateway,intake,review,generic,old,claimLease,poll};
}
afterEach(()=>vi.useRealTimers());
describe('GENQA isolated route',()=>{
 it('restricted GENQA gate is ON with general and legacy QA OFF',()=>{expect(TELEGRAM_GENQA_GROUP_ACCEPTANCE_ENABLED).toBe(true);expect(TGG1B_DISPATCH_GROUP_REVIEW_ENABLED).toBe(false);expect(TELEGRAM_SINGLE_LOAD_QA_ENABLED).toBe(false);});
 it.each([cmd,'/cancelled HTP-QA-GEN1'])('exact %s enters only GENQA',text=>expect(classifyUpdate(identity(text),false,false,true)).toMatchObject({kind:'dispatch_group_message',genQaOnly:true}));
 it.each(['Load HTP-QA-GEN1 cancelled','/delivered HTP-QA-GEN1','/cancelled HTP-QA-L2','/cancelled@OtherBot HTP-QA-GEN1',cmd+' extra',cmd+'\n','/help','/dispatch'])('ignores %s',text=>expect(classifyUpdate(identity(text),false,false,true).kind).toBe('ignored'));
 it('wrong group/private transport never enters GENQA',()=>{expect(classifyUpdate(identity(cmd,-100),false,false,true).kind).toBe('ignored');expect(classifyUpdate({...identity(),chatType:'private'},false,false,true).kind).not.toBe('dispatch_group_message');});
 it('all OFF invokes no processing or send',async()=>{const f=fixture([msg(),cb()]);await f.poll(false);expect(f.intake).not.toHaveBeenCalled();expect(f.review).not.toHaveBeenCalled();expect(f.generic).not.toHaveBeenCalled();expect(f.old).not.toHaveBeenCalled();expect(f.gateway.sendMessage).not.toHaveBeenCalled();});
 it('intake only proposes and uses transport scope; callback passes actual reviewer',async()=>{const f=fixture([msg(),cb()]);expect((await f.poll()).kind).toBe('ok');expect(f.intake).toHaveBeenCalledWith(expect.objectContaining({reference:'HTP-QA-GEN1',proposedStatus:'cancelled',telegramChatId:CHAT}));expect(f.review).toHaveBeenCalledWith(expect.objectContaining({telegramUserId:501,proposalId:ID,action:'accept'}));expect(f.generic).not.toHaveBeenCalled();expect(f.old).not.toHaveBeenCalled();expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);});
 it('unauthorized role is rejected by isolated authority; no feedback message',async()=>{const f=fixture([cb(999)]);await f.poll();expect(f.review).toHaveBeenCalled();expect(f.gateway.sendMessage).not.toHaveBeenCalled();});
 it.each(['intake','review'])('missing %s fails without fallback',async path=>{const f=fixture([path==='intake'?msg():cb()]);if(path==='intake')delete f.ledger.processGenQaDispatchGroupUpdate;else delete f.ledger.processGenQaDispatchReviewActionUpdate;expect((await f.poll()).kind).toBe('failed');expect(f.generic).not.toHaveBeenCalled();expect(f.old).not.toHaveBeenCalled();});
 it('trusted replay suppresses feedback',async()=>{const f=fixture([cb()]);f.review.mockResolvedValue({isNew:false,resultCode:'dispatch_review_accepted'});await f.poll();expect(f.gateway.sendMessage).not.toHaveBeenCalled();});
 it.each([{dispatchReviewEnabled:true},{singleLoadQaEnabled:true},{dispatchReviewEnabled:true,singleLoadQaEnabled:true}])('conflict stops before poll lease %j',async extra=>{const f=fixture([]);expect(await f.poll(true,extra)).toMatchObject({kind:'failed',errorCode:'dispatch_modes_conflict'});expect(f.claimLease).not.toHaveBeenCalled();expect(f.gateway.getUpdates).not.toHaveBeenCalled();});
 it('expiry ignores intake/callback and makes no GENQA processing',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T23:59:59Z'));const f=fixture([msg(),cb()]);await f.poll();expect(f.intake).not.toHaveBeenCalled();expect(f.review).not.toHaveBeenCalled();});
});
describe('GENQA committed cancellation feedback',()=>{
 it.each(['group','supergroup'])('accepted %s callback sends once after commit without buttons',async type=>{
  const update=cb();update.callback_query.message.chat.type=type;
  const f=fixture([update]);let committed=false;
  f.review.mockImplementation(async()=>{committed=true;return {isNew:true,resultCode:'dispatch_review_accepted'};});
  vi.mocked(f.gateway.sendMessage).mockImplementation(async input=>{
   expect(committed).toBe(true);
   expect(input).toEqual({chatId:CHAT,text:'✅ Cancellation confirmed for QA load HTP-QA-GEN1. Status: Cancelled.'});
   return {ok:true,status:200,result:{message_id:9}};
  });
  expect((await f.poll()).kind).toBe('ok');expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
  expect(f.gateway.answerCallbackQuery).toHaveBeenCalledTimes(1);
  f.review.mockResolvedValue({isNew:false,resultCode:'dispatch_review_accepted'});
  expect((await f.poll()).kind).toBe('ok');expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
 });
 it('proposal intake alone never confirms cancellation',async()=>{const f=fixture([msg()]);await f.poll();expect(f.gateway.sendMessage).not.toHaveBeenCalled();});
 it.each(['dispatch_review_rejected','dispatch_review_denied','dispatch_review_stale','dispatch_review_expired','dispatch_review_invalid'] as const)('no status claim for %s',async resultCode=>{
  const f=fixture([cb()]);f.ledger.processGenQaDispatchReviewActionUpdate=vi.fn(async()=>({isNew:true,resultCode}));
  await f.poll();expect(f.gateway.sendMessage).not.toHaveBeenCalled();
 });
 it('reject action cannot confirm even with an accepted result',async()=>{const update=cb();update.callback_query.data=composeDispatchReviewData('reject',ID);const f=fixture([update]);await f.poll();expect(f.gateway.sendMessage).not.toHaveBeenCalled();});
 it.each([{id:-100,type:'group'},{id:CHAT,type:'private'},{id:CHAT,type:'channel'}])('invalid callback transport %j never confirms',async chat=>{
  const update=cb();update.callback_query.message.chat=chat;const f=fixture([update]);await f.poll();expect(f.review).not.toHaveBeenCalled();expect(f.gateway.sendMessage).not.toHaveBeenCalled();
 });
 it('expiry after committed result suppresses confirmation',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T23:59:58Z'));const f=fixture([cb()]);
  f.review.mockImplementation(async()=>{vi.setSystemTime(new Date('2026-11-05T23:59:59Z'));return {isNew:true,resultCode:'dispatch_review_accepted'};});
  expect((await f.poll()).kind).toBe('ok');expect(f.gateway.sendMessage).not.toHaveBeenCalled();
 });
 it.each(['response','throw'])('send %s failure preserves commit/cursor and replay suppression',async failure=>{
  const f=fixture([cb()]);const advance=vi.fn(async(_lease:string,n:number)=>n);f.ledger.advanceCursor=advance;
  if(failure==='throw')vi.mocked(f.gateway.sendMessage).mockRejectedValue(new Error('network_failure'));
  else vi.mocked(f.gateway.sendMessage).mockResolvedValue({ok:false,status:500,errorCode:'network_failure'});
  expect((await f.poll()).kind).toBe('ok');expect(advance).toHaveBeenCalledWith(ID,2);
  expect(f.review).toHaveBeenCalledTimes(1);expect(f.gateway.answerCallbackQuery).toHaveBeenCalledTimes(1);
  f.review.mockResolvedValue({isNew:false,resultCode:'dispatch_review_accepted'});
  expect((await f.poll()).kind).toBe('ok');expect(f.gateway.sendMessage).toHaveBeenCalledTimes(1);
 });
});
describe('GENQA five-path RPC and outbox isolation',()=>{
 function delivery(){const row={outbox_id:ID,claim_token:ID,proposal_id:ID,telegram_chat_id:CHAT,load_reference:'HTP-QA-GEN1',proposed_status:'cancelled',expires_at:'2026-11-05T23:59:58Z'};const rpc=vi.fn(async(name:string)=>({data:name===TELEGRAM_GENQA_RPCS.claim?[row]:true,error:null}));return {rpc,row,ledger:buildGenQaDeliveryLedger(rpc)};}
 it.each(['ack','fail'])('claim then %s uses only exact GENQA RPCs',async mode=>{const d=delivery(),f=fixture([]),generic={claim:vi.fn(),ack:vi.fn(),fail:vi.fn()};if(mode==='fail')f.gateway.sendMessage=vi.fn(async()=>({ok:false,status:500}));expect(await runDispatchReviewDeliveryDrain({ledger:generic,genQaLedger:d.ledger,gateway:f.gateway,genQaEnabled:true,limit:1})).toMatchObject({status:'ok'});expect(d.rpc.mock.calls.map(c=>c[0])).toEqual([TELEGRAM_GENQA_RPCS.claim,TELEGRAM_GENQA_RPCS[mode]]);expect(generic.claim).not.toHaveBeenCalled();});
 it.each(['claim','ack','fail'])('missing %s RPC fails closed without generic calls',async missing=>{const d=delivery(),f=fixture([]),generic={claim:vi.fn(),ack:vi.fn(),fail:vi.fn()};d.rpc.mockImplementation(async name=>({data:name===TELEGRAM_GENQA_RPCS.claim?[d.row]:true,error:name===TELEGRAM_GENQA_RPCS[missing]?{}:null}));if(missing==='fail')f.gateway.sendMessage=vi.fn(async()=>({ok:false,status:500}));expect((await runDispatchReviewDeliveryDrain({ledger:generic,genQaLedger:d.ledger,gateway:f.gateway,genQaEnabled:true,limit:1})).status).toBe('failed');expect(generic.claim).not.toHaveBeenCalled();expect(generic.ack).not.toHaveBeenCalled();expect(generic.fail).not.toHaveBeenCalled();});
 it('missing isolated ledger makes zero claims/sends',async()=>{const f=fixture([]),d=delivery();expect((await runDispatchReviewDeliveryDrain({ledger:d.ledger,gateway:f.gateway,genQaEnabled:true})).status).toBe('failed');expect(d.rpc).not.toHaveBeenCalled();});
 it.each([{telegram_chat_id:-100},{load_reference:'HTP-QA-L2'},{proposed_status:'completed'},{expires_at:'bad'}])('unsafe claim %j is blocked before send/ack/fail',async bad=>{const f=fixture([]),d=delivery();Object.assign(d.row,bad);expect((await runDispatchReviewDeliveryDrain({ledger:d.ledger,genQaLedger:d.ledger,gateway:f.gateway,genQaEnabled:true,limit:1})).status).toBe('failed');expect(f.gateway.sendMessage).not.toHaveBeenCalled();expect(d.rpc).toHaveBeenCalledTimes(1);});
 it.each([{enabled:true},{singleLoadQaEnabled:true}])('conflict stops before outbox %j',async extra=>{const f=fixture([]),d=delivery();expect((await runDispatchReviewDeliveryDrain({ledger:d.ledger,genQaLedger:d.ledger,gateway:f.gateway,genQaEnabled:true,...extra})).status).toBe('failed');expect(d.rpc).not.toHaveBeenCalled();});
 it('expired lane performs zero outbox calls',async()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T23:59:59Z'));const f=fixture([]),d=delivery();expect((await runDispatchReviewDeliveryDrain({ledger:d.ledger,genQaLedger:d.ledger,gateway:f.gateway,genQaEnabled:true})).status).toBe('disabled');expect(d.rpc).not.toHaveBeenCalled();});
});

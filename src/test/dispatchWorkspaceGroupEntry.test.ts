// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { runTelegramPoll, type TelegramGateway, type TelegramPollLedger } from '../../supabase/functions/_shared/telegram-poll-ingest';

describe('Dispatch entry from connected-group help', () => {
  it('sends a private-bot Dispatch link on the actual group-feedback branch and suppresses receipt replays', async () => {
    const sendMessage=vi.fn().mockResolvedValue({ok:true,status:200});
    const gateway={getUpdates:async()=>({ok:true,status:200,result:[{update_id:1,message:{from:{id:501},chat:{id:-100,type:'group'},text:'/help@HaulTrackerBot'}}]}),sendMessage} as TelegramGateway;
    const ignored=vi.fn().mockResolvedValueOnce({isNew:true,resultCode:'non_private_message'}).mockResolvedValueOnce({isNew:false,resultCode:'non_private_message'});
    const ledger={claimLease:async()=>({leaseToken:'lease',nextOffset:1}),releaseLease:async()=>true,advanceCursor:async()=>2,recordIgnoredUpdate:ignored} as unknown as TelegramPollLedger;
    const group=[[{text:'Open Dispatch',url:'https://t.me/HaulTrackerBot?start=dispatch'}]];
    for(let n=0;n<2;n++) expect((await runTelegramPoll({ledger,gateway,sha256:async()=>'a'.repeat(64),getDispatchGroupConnection:async()=>true,dispatchGuidanceButtons:{private:[],group}})).kind).toBe('ok');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({chatId:-100,text:expect.stringContaining('Connected ·'),buttons:group}));
    expect(sendMessage.mock.calls[0][0].buttons[0][0]).not.toHaveProperty('web_app');
  });
});

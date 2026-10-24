import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Users, RefreshCw } from 'lucide-react';
import { useRecruiterCardScope, useRecruiterJobSearchCards, type RecruiterCardsState } from '@/hooks/jobSearch/useJobSearchCard';
import { CARD_ERRORS, EmploymentCardDetails } from './DriverJobSearchCard';
export default function RecruiterJobSearchCards({ recruiterId }: {
    recruiterId: string;
}) {
    const scope = useRecruiterCardScope(recruiterId);
    if (!scope.allowed || !scope.key)
        return <p role="status" className="text-sm text-muted-foreground">
        Available-driver discovery is unavailable in this workspace.
        </p>;
    return <ConnectedRecruiterCards key={scope.key} recruiterId={recruiterId} scope={scope}/>;
}
function ConnectedRecruiterCards({ recruiterId, scope }: {
    recruiterId: string;
    scope: ReturnType<typeof useRecruiterCardScope>;
}) {
    const state = useRecruiterJobSearchCards(scope, recruiterId);
    return <RecruiterJobSearchCardsView state={state}/>;
}
export function RecruiterJobSearchCardsView({ state }: {
    state: RecruiterCardsState;
}) {
    return <section aria-label="Available drivers" className="min-w-0 space-y-5 text-foreground">
    <header className="flex flex-wrap items-center gap-3">
    <Users className="h-6 w-6 text-primary"/>
    <h2 className="text-xl font-bold">
    Available drivers
    </h2>
    </header>
    <Button variant="outline" disabled={state.busy || state.error === 'unavailable'} onClick={() => void state.load()}>
    <RefreshCw className="mr-2 h-4 w-4"/>
    {state.loaded ? 'Refresh cards' : 'Find available drivers'}
    </Button>
    {state.busy && <p role="status">
    Loading…
    </p>}
    {state.error && <p role="alert" className="text-sm text-muted-foreground">
    {state.error === 'denied' ? 'Discovery requires an eligible approved owner workspace with an active approved opening.' : CARD_ERRORS[state.error]}
    </p>}
    {state.loaded && !state.busy && !state.rows.length && <p role="status" className="text-muted-foreground">
    No eligible available-driver cards on this page.
    </p>}
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    {state.rows.map(card => <Card key={card.id} className="min-w-0 space-y-4 rounded-lg p-4">
    <p className="text-xs font-medium text-muted-foreground">
    Card reference 
    {card.id.slice(0, 8).toUpperCase()}
    </p>
    <EmploymentCardDetails payload={card.payload}/>
    <p className="text-xs text-muted-foreground">
    Available until 
    {new Date(card.expires_at).toLocaleDateString('en-US')}
    </p>
    </Card>)}
    </div>
    {state.more && <Button variant="outline" disabled={state.busy} onClick={() => void state.load(true)}>
    Next page
    </Button>}
    </section>;
}

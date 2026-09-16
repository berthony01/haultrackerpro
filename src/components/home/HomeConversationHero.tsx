import HomeConversationFlow, {
  type HomeConversationFlowProps,
} from '@/components/home/HomeConversationFlow';
import { HOME_INTAKE_NEXT_PATH } from '@/lib/home/conversationIntake';

/**
 * Thin wrapper kept so the homepage hero has one stable import point.
 *
 * All behavior lives in HomeConversationFlow + the pure intake module. The old
 * one-shot textarea/draft handoff was removed in HP-2: it captured a single
 * message that nothing ever consumed.
 */
export const HOME_CONVERSATION_NEXT_PATH = HOME_INTAKE_NEXT_PATH;

export type HomeConversationHeroProps = HomeConversationFlowProps;

export default function HomeConversationHero(props: HomeConversationHeroProps) {
  return <HomeConversationFlow {...props} />;
}

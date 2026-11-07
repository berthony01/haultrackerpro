import { Card } from '@/components/ui/card';

export function MiniAppNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return <Card className="space-y-3 border-border/60 p-5" role="status"><h1 className="text-xl font-bold">{title}</h1><div className="text-sm leading-relaxed text-muted-foreground">{children}</div></Card>;
}

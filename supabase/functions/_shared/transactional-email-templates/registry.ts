/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcome } from './welcome.tsx'
import { template as lifecycleDay2 } from './lifecycle-day2.tsx'
import { template as lifecycleDay7 } from './lifecycle-day7.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'welcome': welcome,
  'lifecycle-day2': lifecycleDay2,
  'lifecycle-day7': lifecycleDay7,
}

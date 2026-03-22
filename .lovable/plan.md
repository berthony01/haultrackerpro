

## Plan: Compact & Readable ProTimeSavedCard

The card is too tall and the breakdown chips use `bg-secondary/80` which renders as dark navy — hard to read. Fix both issues.

### Changes to `src/components/ProTimeSavedCard.tsx`

1. **Hero stat section** — reduce padding from `py-3` to `py-1.5`, shrink font from `text-4xl` to `text-2xl`
2. **Breakdown chips** — change `bg-secondary/80` to `bg-muted/60` so text is visible on light background; reduce padding from `p-2.5` to `p-2`; remove `mb-1.5` on icon wrapper
3. **Overall spacing** — change `space-y-4` to `space-y-2` and `p-4` to `p-3`

Result: compact card, light readable chip backgrounds matching the platform theme.

### Files changed
- `src/components/ProTimeSavedCard.tsx`


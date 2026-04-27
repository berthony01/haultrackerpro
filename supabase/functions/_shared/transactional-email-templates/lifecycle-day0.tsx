import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'HaulTrackerPro'
const APP_URL = 'https://haultrackerpro.com'

interface Props { name?: string }

const Day0Email = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME} — your account is ready</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `Welcome, ${name}!` : `Welcome to ${SITE_NAME}!`}
        </Heading>
        <Text style={text}>
          You're all set. {SITE_NAME} helps you stop driving blind — track loads,
          expenses, and fuel so you know exactly what each mile actually pays.
        </Text>
        <Text style={text}>
          Your account is on the <strong>Free plan</strong>. Start tracking
          right away — and upgrade to Pro when you want Smart Alerts, Profit
          Check, lane intelligence, and the Weekly Closeout summary.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard`}>
            Log my first load
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={tipsHeading}>Quick start</Text>
        <Text style={text}>
          1. Add your first load to see your true rate per mile.<br />
          2. Log an expense or fuel stop — we'll categorize it for Schedule C.<br />
          3. Check the dashboard Sunday for your Weekly Closeout.
        </Text>
        <Text style={footer}>
          Drive smart,<br />The {SITE_NAME} Team
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Day0Email,
  subject: `Welcome to ${SITE_NAME} — your 14-day Pro trial is active`,
  displayName: 'Lifecycle — Day 0 (welcome)',
  previewData: { name: 'Sam' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#0b1220', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const buttonContainer = { margin: '28px 0' }
const button = { backgroundColor: '#f59e0b', color: '#0b1220', fontSize: '15px', fontWeight: 'bold', padding: '12px 22px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0' }
const tipsHeading = { fontSize: '14px', fontWeight: 'bold', color: '#0b1220', margin: '0 0 8px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const footer = { fontSize: '13px', color: '#6b7280', margin: '28px 0 0' }

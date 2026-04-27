import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'HaulTrackerPro'
const APP_URL = 'https://haultrackerpro.com'

interface Props { name?: string }

const Day7Email = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Keep building your tracking habit</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `${name}, keep building your tracking habit` : 'Keep building your tracking habit'}</Heading>
        <Text style={text}>
          You've had your {SITE_NAME} account for about a week. Drivers who log
          even a few loads each week get a much clearer picture of what each mile
          actually pays. Here's what unlocks once you upgrade to Pro:
        </Text>
        <Text style={text}>
          • <strong>Profit Check</strong> on every load before you book it<br />
          • <strong>Smart Alerts</strong> when a lane or broker hurts your margin<br />
          • <strong>Weekly Closeout</strong> with anomaly detection<br />
          • <strong>Lane intelligence</strong> — best/weakest routes from your own history
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard`}>Log a load</Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Day7Email,
  subject: 'Keep building your tracking habit',
  displayName: 'Lifecycle — Day 7 (habit nudge)',
  previewData: { name: 'Sam' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#0b1220', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const buttonContainer = { margin: '28px 0' }
const button = { backgroundColor: '#f59e0b', color: '#0b1220', fontSize: '15px', fontWeight: 'bold', padding: '12px 22px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0' }
const footer = { fontSize: '13px', color: '#6b7280', margin: '20px 0 0' }

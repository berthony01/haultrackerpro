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
    <Preview>Your Pro trial ends in 7 days</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `${name}, your Pro trial is half over` : 'Your Pro trial is half over'}</Heading>
        <Text style={text}>
          You've got <strong>7 days left</strong> on your 14-day Pro trial — and your
          account is still empty. Here's what Pro unlocks the moment you log a load:
        </Text>
        <Text style={text}>
          • <strong>Profit Check</strong> on every load before you book it<br />
          • <strong>Smart Alerts</strong> when a lane or broker hurts your margin<br />
          • <strong>Weekly Closeout</strong> with anomaly detection<br />
          • <strong>Lane intelligence</strong> — best/weakest routes from your own history
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard`}>Log a load and use Pro</Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Day7Email,
  subject: 'Your Pro trial ends in 7 days',
  displayName: 'Lifecycle — Day 7 (trial midpoint)',
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

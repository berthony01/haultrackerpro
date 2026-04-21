import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'HaulTrackerPro'
const APP_URL = 'https://haultrackerpro.com'

interface Props { name?: string }

const Day2Email = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Need a hand logging your first load?</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{name ? `Hey ${name},` : 'Hey driver,'} need a hand?</Heading>
        <Text style={text}>
          Noticed you haven't logged your first load yet. It takes about 30 seconds —
          we even pre-fill a sample so you just edit the numbers.
        </Text>
        <Text style={text}>
          Once one load is in, your dashboard lights up: real rate per mile, deadhead %,
          and a Profit Check on every future load.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard`}>Log my first load</Button>
        </Section>
        <Hr style={hr} />
        <Text style={text}>
          Stuck? Just reply to this email and we'll help you get set up.
        </Text>
        <Text style={footer}>The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Day2Email,
  subject: 'Need a hand logging your first load?',
  displayName: 'Lifecycle — Day 2 (no loads)',
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

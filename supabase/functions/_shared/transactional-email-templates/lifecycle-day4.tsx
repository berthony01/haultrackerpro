import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'HaulTrackerPro'
const APP_URL = 'https://haultrackerpro.com'

interface Props { name?: string }

const Day4Email = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{SITE_NAME} works best once your first load is in.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `${name}, still no load logged?` : 'Still no load logged?'}
        </Heading>
        <Text style={text}>
          You signed up a few days ago — totally understand if life got in the
          way. {SITE_NAME} only really starts helping once your first load is in.
        </Text>
        <Text style={text}>
          What to do next: open the add-load form, edit the pre-filled sample
          (pickup, dropoff, miles, rate), and save. That's it — your dashboard
          will start showing real numbers right after.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard?page=add`}>
            Log my first load
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={text}>
          If something's blocking you, just reply to this email — a real person
          will help you get set up.
        </Text>
        <Text style={footer}>The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Day4Email,
  subject: 'Still no load logged — want help getting started?',
  displayName: 'Lifecycle — Day 4 (final first-load rescue)',
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

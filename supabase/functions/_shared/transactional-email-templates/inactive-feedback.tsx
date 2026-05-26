import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Button, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'HaulTrackerPro'
const APP_URL = 'https://haultrackerpro.com'

interface Props { name?: string }

const InactiveFeedbackEmail = ({ name }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>What stopped you from using {SITE_NAME}?</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>
          {name ? `Hey ${name},` : 'Hey there,'}
        </Heading>
        <Text style={text}>
          I noticed you signed up for {SITE_NAME} but never logged a load.
          Totally fine — I'm not writing to push anything on you.
        </Text>
        <Text style={text}>
          I'm trying to make this genuinely useful for drivers, and I'd really
          appreciate one honest answer:
        </Text>
        <Text style={textBold}>
          What made you sign up, and what stopped you from logging your first load?
        </Text>
        <Text style={text}>
          You can just hit reply — it comes straight to me. Or if you want to
          give it another shot, the link below opens the add-load form directly.
        </Text>
        <Section style={buttonContainer}>
          <Button style={button} href={`${APP_URL}/dashboard?page=add`}>
            Log my first load
          </Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>Thanks,<br />The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: InactiveFeedbackEmail,
  subject: `What stopped you from using ${SITE_NAME}?`,
  displayName: 'Inactive user feedback (manual send)',
  previewData: { name: 'Sam' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 'bold', color: '#0b1220', margin: '0 0 20px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const textBold = { fontSize: '15px', color: '#0b1220', lineHeight: '1.6', margin: '0 0 16px', fontWeight: 'bold' as const }
const buttonContainer = { margin: '28px 0' }
const button = { backgroundColor: '#f59e0b', color: '#0b1220', fontSize: '15px', fontWeight: 'bold', padding: '12px 22px', borderRadius: '8px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0' }
const footer = { fontSize: '13px', color: '#6b7280', margin: '20px 0 0' }

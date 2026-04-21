/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  siteUrl?: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  confirmationUrl,
  siteUrl = 'https://haultrackerpro.com',
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your HaulTrackerPro login link</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={brand}>HaulTrackerPro</Text>
          <Text style={tagline}>Stop driving blind. Start driving profitable.</Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Your login link</Heading>
          <Text style={text}>
            Click the button below to sign in to HaulTrackerPro. This link expires shortly for your security.
          </Text>
          <Section style={buttonWrap}>
            <Button style={button} href={confirmationUrl}>Log In</Button>
          </Section>
          <Text style={smallText}>Or paste this link into your browser:</Text>
          <Text style={linkText}>
            <Link href={confirmationUrl} style={link}>{confirmationUrl}</Link>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            If you didn't request this link, you can safely ignore this email.
          </Text>
        </Section>
        <Section style={footerBlock}>
          <Text style={footerText}>
            HaulTrackerPro · <Link href={siteUrl} style={footerLink}>{siteUrl.replace(/^https?:\/\//, '')}</Link>
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', margin: 0, padding: 0 }
const container = { maxWidth: '560px', margin: '0 auto', padding: '24px 16px' }
const header = { backgroundColor: '#0F1A2E', borderRadius: '12px 12px 0 0', padding: '28px 28px 20px', textAlign: 'center' as const }
const brand = { color: '#F59E0B', fontSize: '22px', fontWeight: 'bold' as const, letterSpacing: '0.3px', margin: 0 }
const tagline = { color: '#94A3B8', fontSize: '12px', margin: '6px 0 0' }
const card = { backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0F1A2E', margin: '0 0 16px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 16px' }
const smallText = { fontSize: '13px', color: '#6B7280', lineHeight: '1.5', margin: '20px 0 6px' }
const linkText = { fontSize: '12px', color: '#374151', wordBreak: 'break-all' as const, margin: '0 0 8px' }
const link = { color: '#F59E0B', textDecoration: 'underline' }
const buttonWrap = { textAlign: 'center' as const, margin: '24px 0 8px' }
const button = { backgroundColor: '#F59E0B', color: '#0F1A2E', fontSize: '15px', fontWeight: 'bold' as const, borderRadius: '8px', padding: '14px 28px', textDecoration: 'none', display: 'inline-block' }
const hr = { borderColor: '#E5E7EB', margin: '24px 0 16px' }
const footer = { fontSize: '12px', color: '#9CA3AF', margin: 0 }
const footerBlock = { textAlign: 'center' as const, padding: '20px 0 0' }
const footerText = { fontSize: '12px', color: '#9CA3AF', margin: 0 }
const footerLink = { color: '#9CA3AF', textDecoration: 'underline' }

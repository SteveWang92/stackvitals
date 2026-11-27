import { describe, expect, it } from 'vitest';
import { connectSources } from '../../../scripts/securityHeaders';

describe('security headers', () => {
  it('allows a custom-domain or self-hosted Supabase origin, including its realtime socket', () => {
    expect(connectSources('https://db.example.com/')).toEqual([
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://db.example.com',
      'wss://db.example.com',
    ]);
    expect(connectSources('https://abc.supabase.co')).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']);
  });
});

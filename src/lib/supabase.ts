import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
// Comma-separated allowlist; RLS on public.dashboard_users must list the same emails.
const allowedEmails = ((import.meta.env.VITE_DASHBOARD_ALLOWED_EMAIL as string | undefined) ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabaseAnonKey && allowedEmails.length > 0);

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

export function isAllowedDashboardEmail(email: string | null | undefined) {
  return Boolean(email && allowedEmails.includes(email.trim().toLowerCase()));
}

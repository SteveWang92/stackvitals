import { Activity, Cloud, Database, Server } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import type { ProviderKey } from '../types';

export const providerIcon: Record<ProviderKey, typeof Cloud | typeof SiGithub> = {
  aws: Cloud,
  amplify: Server,
  supabase: Database,
  resend: Server,
  cloudflare: Cloud,
  openai: Server,
  github: SiGithub,
  http: Activity,
};

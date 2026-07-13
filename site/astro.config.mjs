import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://stackvitals.dev',
  integrations: [
    starlight({
      title: 'StackVitals',
      logo: {
        src: './src/assets/stackvitals-icon.svg',
        replacesTitle: false,
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/SteveWang92/stackvitals' }],
      customCss: ['./src/styles/landing.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', slug: 'getting-started/overview' },
            { label: 'Self-Hosting Guide', slug: 'getting-started/self-hosting' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Adding a Provider', slug: 'guides/adding-a-provider' },
            { label: 'Architecture', slug: 'guides/architecture' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Adapters', slug: 'reference/adapters' },
            { label: 'Environment Variables', slug: 'reference/environment-variables' },
            { label: 'Database Schema', slug: 'reference/database-schema' },
          ],
        },
        {
          label: 'About',
          items: [
            { label: 'Contributing', slug: 'about/contributing' },
            { label: 'Security', slug: 'about/security' },
            { label: 'Changelog', slug: 'about/changelog' },
            { label: 'License', slug: 'about/license' },
          ],
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://stackvitals.dev/og-image.png' },
        },
      ],
    }),
  ],
});

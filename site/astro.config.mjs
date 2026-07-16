import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://stackvitals.dev',
  integrations: [
    starlight({
      title: 'StackVitals',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      logo: {
        dark: './src/assets/stackvitals-icon-light.svg',
        light: './src/assets/stackvitals-icon-dark.svg',
        replacesTitle: false,
      },
      social: [
        { icon: 'open-book', label: 'Docs', href: '/getting-started/overview/' },
        { icon: 'github', label: 'GitHub', href: 'https://github.com/SteveWang92/stackvitals' },
      ],
      customCss: ['./src/styles/landing.css'],
      sidebar: [
        {
          label: 'Getting Started',
          translations: { 'zh-CN': '快速入门' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '概述' }, slug: 'getting-started/overview' },
            { label: 'Self-Hosting Guide', translations: { 'zh-CN': '自托管指南' }, slug: 'getting-started/self-hosting' },
          ],
        },
        {
          label: 'Guides',
          translations: { 'zh-CN': '指南' },
          items: [
            { label: 'Adding a Provider', translations: { 'zh-CN': '添加提供商' }, slug: 'guides/adding-a-provider' },
            { label: 'Architecture', translations: { 'zh-CN': '架构' }, slug: 'guides/architecture' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          items: [
            { label: 'Adapters', translations: { 'zh-CN': '适配器' }, slug: 'reference/adapters' },
            { label: 'Environment Variables', translations: { 'zh-CN': '环境变量' }, slug: 'reference/environment-variables' },
            { label: 'Database Schema', translations: { 'zh-CN': '数据库结构' }, slug: 'reference/database-schema' },
          ],
        },
        {
          label: 'About',
          translations: { 'zh-CN': '关于' },
          items: [
            { label: 'Contributing', translations: { 'zh-CN': '参与贡献' }, slug: 'about/contributing' },
            { label: 'Security', translations: { 'zh-CN': '安全' }, slug: 'about/security' },
            { label: 'Changelog', translations: { 'zh-CN': '更新日志' }, slug: 'about/changelog' },
            { label: 'License', translations: { 'zh-CN': '许可证' }, slug: 'about/license' },
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

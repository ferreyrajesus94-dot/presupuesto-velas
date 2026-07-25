This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Testing and Browser Setup

This project ships with three test layers: unit/integration (Vitest + Testing Library + jsdom), end-to-end (Playwright with Chromium), and formatting/linting (Prettier + ESLint). A fresh checkout can run unit tests immediately but must install the Playwright browser before running E2E for the first time.

### Fresh checkout sequence

```bash
# 1. Install npm dependencies (does NOT install browsers).
npm ci

# 2. Install the Playwright Chromium browser binary. Run once per
#    fresh environment, or whenever Playwright itself is upgraded.
npm run e2e:install

# 3. Verify the toolchain.
npm run typecheck
npm run lint
npm run format:check
npm test
npm run e2e
npm run build
```

### Why browser installation is a separate step

`playwright install chromium` downloads a platform-specific Chromium build into the Playwright cache (typically `~/.cache/ms-playwright`). It is intentionally NOT wired to `postinstall`:

- Browser binaries are large (hundreds of MB) and would slow every `npm install`.
- They are host-OS-specific and are not a property of `node_modules`, so they belong outside the dependency tree.
- Some environments (CI runners, shared caches, Docker layers) provide browsers out of band; a forced `postinstall` would fight those setups.
- Operators choose when to refresh the browser — for example, after upgrading `@playwright/test`.

If you want system libraries installed alongside the browser, run `npx playwright install --with-deps chromium` directly (requires `sudo` on Linux); the script intentionally stays non-interactive.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

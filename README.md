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

Calculadora Flor is a multi-user Next.js 16 app with a serverless Postgres backend (Neon) and managed auth (Neon Auth). One Neon Auth account is auto-promoted to `role='owner'` via the `BOOTSTRAP_OWNER_EMAIL` env var; all other verified signers land as `role='user'`. Production deployment uses Vercel with the environment variables declared in `.env.example`.

### Prerequisites

1. **Neon project** in region `aws-sa-east-1` (São Paulo). Neon region is immutable post-create — verify before production.
2. **Neon Auth** provisioned on the project (Better Auth, branch-scoped base URL + JWKS URL).
3. **Bootstrap owner account** already created in Neon Auth. Add its email to `BOOTSTRAP_OWNER_EMAIL` in Vercel env so the matching verified sign-in is auto-promoted to `role='owner'` in `app_user` (ROLE-MODEL scenario). Leave the env unset to default every verified signer to `role='user'`.
4. **Vercel account** with this repo imported (or `vercel link` from a local clone).

### Region selection

Vercel project region **must be `gru1`** (São Paulo) to minimize latency from Argentina. The pairing is intentional:

- Neon region `aws-sa-east-1` ↔ Vercel region `gru1` (same metro, ~10 ms RTT).
- Lower Argentina p50/p95 is an assumption to validate with pre-prod metrics before general availability.

### Vercel project settings

| Setting          | Value                       |
| ---------------- | --------------------------- |
| Framework Preset | Next.js                     |
| Build Command    | `npm run build`             |
| Install Command  | `npm ci`                    |
| Output Directory | (Next.js default — `.next`) |
| Node Version     | 22.x (matches `.nvmrc`)     |
| Region           | `gru1`                      |

### Environment variables

Configure the following in the Vercel project (Settings → Environment Variables). All values are **server-only**; never prefix any of them with `NEXT_PUBLIC_`.

| Variable                | Environment         | Required for                                                                                                                                             |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_BASE_URL`          | Production, Preview | Server-side auth callbacks (use the canonical Vercel URL, e.g. `https://presupuesto-velas.vercel.app`)                                                   |
| `DATABASE_URL`          | Production, Preview | Runtime queries (use the **pooled** endpoint — hostname ends in `-pooler`)                                                                               |
| `DIRECT_URL`            | Production, Preview | Migrations only (use the **direct/unpooled** endpoint; `drizzle.config.ts` also reads `DATABASE_URL_UNPOOLED` as a fallback)                             |
| `NEON_AUTH_BASE_URL`    | Production, Preview | Neon Auth (Better Auth) base URL — branch-scoped                                                                                                         |
| `NEON_AUTH_JWKS_URL`    | Production, Preview | Neon Auth JWKS endpoint for session validation                                                                                                           |
| `BOOTSTRAP_OWNER_EMAIL` | Production, Preview | **Optional**. Email that auto-promotes a verified Neon Auth sign-in to `role='owner'` in `app_user`. Unset = all verified signers land as `role='user'`. |

Local development uses `.env.local` (never committed) with the same keys.

### Production smoke test

After the first deploy succeeds:

1. Visit the production URL (e.g. `https://presupuesto-velas.vercel.app/`).
2. Confirm the root redirects to `/sign-in` when unauthenticated.
3. Sign in with the owner credentials.
4. Confirm redirect to the dashboard (`/`).
5. Create a draft quote at `/quotes/new`.
6. Transition the draft to `sent` then `accepted`.
7. Download the PDF from `/api/quotes/{id}/pdf` and confirm `application/pdf` content-type.
8. Open the WhatsApp share link and confirm it contains a `wa.me/?text=...` URL with the customer name and total.
9. Trigger the Playwright E2E suite against the preview URL with `E2E_OWNER_EMAIL` + `E2E_OWNER_PASSWORD` set.

### HC-B checklist

- [ ] Neon project exists in `aws-sa-east-1`.
- [ ] Neon Auth provisioned on the project.
- [ ] Bootstrap owner account created in Neon Auth; its email added to `BOOTSTRAP_OWNER_EMAIL` in Vercel env (Production + Preview).
- [ ] Vercel project created in region `gru1`.
- [ ] All six environment variables from the table above are set in Vercel (Production + Preview environments).
- [ ] No env var is prefixed with `NEXT_PUBLIC_`.
- [ ] First production deploy succeeded (`vercel --prod` or via Git integration).
- [ ] Production smoke test (9 steps above) all pass.

For automated deploys, see [Vercel CLI with tokens](https://github.com/anthropics/skills/tree/main/skills/vercel-cli-with-tokens); for human-friendly setup, use the Vercel dashboard.

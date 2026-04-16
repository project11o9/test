# Fidelity Platform

Production-oriented web platform with:

- User authentication and account state controls
- Wallet, deposit and withdrawal request flow
- Stock review rewards and spin rewards
- Real-time admin console for users, stocks, notifications and settings

## Architecture

- **Backend**: `server.ts` (Express + Firebase Admin SDK)
- **Admin frontend**: React/Vite app served at `/admin`
- **User frontend**: static HTML/JS pages in `public/`
- **Database**: Cloud Firestore

## Key API Endpoints

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/csrf`

### User
- `GET /api/user/profile`
- `GET /api/wallet`
- `POST /api/deposit`
- `POST /api/withdraw`
- `POST /api/reviews/submit`
- `POST /api/spin/claim`

### Settings
- `GET /api/settings/features`
- `GET /api/settings/spin`

### Admin
- `POST /api/admin/users/:uid/toggle-active`
- `POST /api/admin/users/:uid/reset-password`
- `POST /api/admin/deposits/:id/decision`
- `POST /api/admin/withdraws/:id/decision`
- `POST /api/admin/settings/spin`
- `POST /api/admin/injection-rules`
- `POST /api/admin/reconcile/user/:uid`
- `POST /api/admin/idempotency/cleanup`
- `GET /api/admin/audit-logs/export`

### Contract
- `GET /api/openapi`

## Environment Variables

Create `.env.local` or set runtime env vars:

- `JWT_SECRET` (required)
- `GEMINI_API_KEY` (if AI integrations are used)
- `APP_URL`

## Run Locally

```bash
npm install
npm run dev
```

Server runs on `http://localhost:3000`.

## Security Notes

- JWT secret is mandatory at startup.
- Auth token is stored in secure HTTP-only cookie and used server-side.
- Admin APIs verify Firebase ID tokens and enforce admin role from Firestore.
- CSRF protection is enforced for cookie-auth state-changing user endpoints.
- Admin financial decision APIs enforce idempotency via `x-idempotency-key`.
- CSRF checks include origin/referer validation and environment-aware cookie policies (`lax` in local/test, `none+secure` in prod/staging).

## Quality Gates

```bash
npm run lint
npm test
npm run build
```

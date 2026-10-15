# workers/contact: contact form Worker

A Cloudflare Worker (`tnelection-contact`) that receives the form on
[../../src/pages/contact.astro](../../src/pages/contact.astro), verifies Turnstile, and emails the message through
Cloudflare Email Routing.

| File | Purpose |
| --- | --- |
| [src/index.js](src/index.js) | The whole Worker: CORS, honeypot, Turnstile check, validation, MIME message |
| [wrangler.jsonc](wrangler.jsonc) | Name, `send_email` binding, `vars` (addresses, allowed origins) |

## Rules

- **Not deployed by the site build or CI.** Deploy by hand with `npx wrangler deploy` from this folder. A site
  deploy doesn't update the Worker, so ship form changes in both places.
- The form contract is the field names (`topic`, `message`, `source`, `name`, `email`, `website`, `page`,
  `cf-turnstile-response`), the `TOPICS` keys, and the `LIMITS`, which mirror the `maxlength`s in `contact.astro`.
  `npm run check:contact` (also run in CI) fails if the two drift. The response is `{ ok: true }` or
  `{ ok: false, error }`, and the page shows `error` to the visitor, so write it for voters.
- `TURNSTILE_SECRET` is a Worker secret (`wrangler secret put`); never commit it. The site key in
  [../../src/lib/site.ts](../../src/lib/site.ts) is public.
- `ALLOWED_ORIGINS` includes `http://localhost:4321` so the dev server can post to the live Worker. A message sent
  from dev is a real email.
- The destination inbox in `wrangler.jsonc` is private. The public address is `contact@tnelection.org`; never put
  the inbox address on the site.
- Header values are stripped of line breaks to stop header injection. Keep that when adding fields.

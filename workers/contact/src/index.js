// Receives the contact form from tnelection.org/contact/, checks the Turnstile token,
// and forwards the message to the project inbox via Email Routing.
import { EmailMessage } from 'cloudflare:email';

const TOPICS = {
  correction: 'Correction',
  missing: 'Missing argument or platform',
  question: 'Question',
  other: 'Other',
};
const LIMITS = { name: 100, email: 200, source: 500, message: 5000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGINS.split(',').includes(origin);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const json = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: allowed ? 204 : 403,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' },
      });
    }
    if (request.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
    if (!allowed) return json(403, { ok: false, error: 'Forbidden.' });

    let form;
    try {
      form = await request.formData();
    } catch {
      return json(400, { ok: false, error: 'Could not read the form.' });
    }
    const field = (k) => String(form.get(k) ?? '').trim();

    // Honeypot: real visitors never see or fill this field.
    if (field('website')) return json(200, { ok: true });

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: field('cf-turnstile-response'),
        remoteip: request.headers.get('CF-Connecting-IP') ?? '',
      }),
    }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!verify.success) return json(400, { ok: false, error: 'The spam check failed. Please reload the page and try again.' });

    const data = {
      topic: TOPICS[field('topic')] ?? TOPICS.other,
      name: field('name').slice(0, LIMITS.name),
      email: field('email').slice(0, LIMITS.email),
      source: field('source').slice(0, LIMITS.source),
      page: field('page').slice(0, LIMITS.source),
      message: field('message').slice(0, LIMITS.message),
    };
    if (!data.message) return json(400, { ok: false, error: 'Please write a message.' });
    if (data.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(data.email)) {
      return json(400, { ok: false, error: 'That email address doesn’t look right.' });
    }

    try {
      await env.MAILER.send(new EmailMessage(env.FROM_ADDRESS, env.TO_ADDRESS, buildMime(env, data)));
    } catch (err) {
      console.error('send failed', err);
      return json(502, { ok: false, error: 'The message could not be sent. Please email us instead.' });
    }
    return json(200, { ok: true });
  },
};

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
// Header values: strip line breaks (header injection) and encode non-ASCII.
const header = (s) => {
  const clean = s.replace(/[\r\n]+/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
};

function buildMime(env, d) {
  const preview = d.message.replace(/\s+/g, ' ').slice(0, 60);
  const body = [
    `Topic: ${d.topic}`,
    `Name: ${d.name || '(not given)'}`,
    `Reply to: ${d.email || '(not given)'}`,
    `Page: ${d.page || '(not given)'}`,
    `Source link: ${d.source || '(none)'}`,
    '',
    d.message,
  ].join('\n');
  const lines = [
    `From: ${header('tnelection.org contact form')} <${env.FROM_ADDRESS}>`,
    `To: <${env.TO_ADDRESS}>`,
    ...(d.email ? [`Reply-To: <${header(d.email)}>`] : []),
    `Subject: ${header(`[${d.topic}] ${preview}`)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@tnelection.org>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body).replace(/.{76}/g, '$&\r\n'),
  ];
  return lines.join('\r\n');
}

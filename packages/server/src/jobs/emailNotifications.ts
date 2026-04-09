import { jobQueue, type JobRecord } from './queue.js';

export const BOOKING_EMAIL_JOB_TYPE = 'booking-email';

export type BookingEmailJobPayload = {
  event: 'booked' | 'rescheduled' | 'cancelled' | 'waitlisted' | 'waitlist_opened';
  bookingToken: string;
  projectName: string;
  clientEmail: string;
  clientFirstName: string;
  rescheduleUrl?: string;
  bookingUrl?: string;
  sessionStartIso?: string;
  sessionEndIso?: string;
};

type EmailProvider = 'console' | 'resend';

type BookingEmailContent = {
  subject: string;
  text: string;
  html: string;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  return fallback;
}

function resolveEmailProvider(rawProvider: string | undefined): EmailProvider {
  if (rawProvider === 'resend') {
    return 'resend';
  }

  return 'console';
}

function resolveBookingPortalBaseUrl(): string {
  return process.env.BOOKING_PORTAL_BASE_URL ?? 'http://localhost:3000';
}

function resolveRescheduleUrl(payload: BookingEmailJobPayload): string | null {
  if (!payload.rescheduleUrl) {
    return null;
  }

  if (payload.rescheduleUrl.startsWith('http://') || payload.rescheduleUrl.startsWith('https://')) {
    return payload.rescheduleUrl;
  }

  const base = resolveBookingPortalBaseUrl().replace(/\/+$/, '');
  const path = payload.rescheduleUrl.startsWith('/') ? payload.rescheduleUrl : `/${payload.rescheduleUrl}`;
  return `${base}${path}`;
}

function resolveBookingUrl(payload: BookingEmailJobPayload): string | null {
  if (!payload.bookingUrl) {
    return null;
  }

  if (payload.bookingUrl.startsWith('http://') || payload.bookingUrl.startsWith('https://')) {
    return payload.bookingUrl;
  }

  const base = resolveBookingPortalBaseUrl().replace(/\/+$/, '');
  const path = payload.bookingUrl.startsWith('/') ? payload.bookingUrl : `/${payload.bookingUrl}`;
  return `${base}${path}`;
}

function formatSessionWindow(payload: BookingEmailJobPayload): string | null {
  if (!payload.sessionStartIso || !payload.sessionEndIso) {
    return null;
  }

  const start = new Date(payload.sessionStartIso);
  const end = new Date(payload.sessionEndIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return `${start.toISOString()} to ${end.toISOString()}`;
}

export function buildBookingEmailContent(payload: BookingEmailJobPayload): BookingEmailContent {
  const rescheduleUrl = resolveRescheduleUrl(payload);
  const bookingUrl = resolveBookingUrl(payload);
  const sessionWindow = formatSessionWindow(payload);

  if (payload.event === 'booked') {
    const subject = `Booking confirmed: ${payload.projectName}`;
    const lines = [
      `Hi ${payload.clientFirstName},`,
      '',
      `Your booking for "${payload.projectName}" is confirmed.`,
      sessionWindow ? `Session: ${sessionWindow}` : '',
      rescheduleUrl ? `Reschedule: ${rescheduleUrl}` : '',
      `Booking token: ${payload.bookingToken}`
    ].filter(Boolean);

    const text = lines.join('\n');
    const html = `
      <p>Hi ${payload.clientFirstName},</p>
      <p>Your booking for <strong>${payload.projectName}</strong> is confirmed.</p>
      ${sessionWindow ? `<p><strong>Session:</strong> ${sessionWindow}</p>` : ''}
      ${rescheduleUrl ? `<p><a href="${rescheduleUrl}">Reschedule your session</a></p>` : ''}
      <p><strong>Booking token:</strong> ${payload.bookingToken}</p>
    `;

    return { subject, text, html };
  }

  if (payload.event === 'rescheduled') {
    const subject = `Booking updated: ${payload.projectName}`;
    const lines = [
      `Hi ${payload.clientFirstName},`,
      '',
      `Your booking for "${payload.projectName}" has been rescheduled.`,
      sessionWindow ? `New session: ${sessionWindow}` : '',
      rescheduleUrl ? `Reschedule again: ${rescheduleUrl}` : '',
      `Booking token: ${payload.bookingToken}`
    ].filter(Boolean);

    const text = lines.join('\n');
    const html = `
      <p>Hi ${payload.clientFirstName},</p>
      <p>Your booking for <strong>${payload.projectName}</strong> has been rescheduled.</p>
      ${sessionWindow ? `<p><strong>New session:</strong> ${sessionWindow}</p>` : ''}
      ${rescheduleUrl ? `<p><a href="${rescheduleUrl}">Manage your booking</a></p>` : ''}
      <p><strong>Booking token:</strong> ${payload.bookingToken}</p>
    `;

    return { subject, text, html };
  }

  if (payload.event === 'waitlisted') {
    const subject = `Waitlist confirmed: ${payload.projectName}`;
    const lines = [
      `Hi ${payload.clientFirstName},`,
      '',
      `You are on the waitlist for "${payload.projectName}".`,
      sessionWindow ? `Requested slot: ${sessionWindow}` : '',
      'We will email you if a slot opens up.'
    ].filter(Boolean);

    const text = lines.join('\n');
    const html = `
      <p>Hi ${payload.clientFirstName},</p>
      <p>You are on the waitlist for <strong>${payload.projectName}</strong>.</p>
      ${sessionWindow ? `<p><strong>Requested slot:</strong> ${sessionWindow}</p>` : ''}
      <p>We will email you if a slot opens up.</p>
    `;

    return { subject, text, html };
  }

  if (payload.event === 'waitlist_opened') {
    const subject = `Slot available: ${payload.projectName}`;
    const lines = [
      `Hi ${payload.clientFirstName},`,
      '',
      `A slot has opened for "${payload.projectName}".`,
      sessionWindow ? `Available slot: ${sessionWindow}` : '',
      bookingUrl ? `Book now: ${bookingUrl}` : ''
    ].filter(Boolean);

    const text = lines.join('\n');
    const html = `
      <p>Hi ${payload.clientFirstName},</p>
      <p>A slot has opened for <strong>${payload.projectName}</strong>.</p>
      ${sessionWindow ? `<p><strong>Available slot:</strong> ${sessionWindow}</p>` : ''}
      ${bookingUrl ? `<p><a href="${bookingUrl}">Book this slot</a></p>` : ''}
    `;

    return { subject, text, html };
  }

  const subject = `Booking cancelled: ${payload.projectName}`;
  const lines = [
    `Hi ${payload.clientFirstName},`,
    '',
    `Your booking for "${payload.projectName}" has been cancelled.`,
    `Cancelled booking token: ${payload.bookingToken}`
  ];

  const text = lines.join('\n');
  const html = `
    <p>Hi ${payload.clientFirstName},</p>
    <p>Your booking for <strong>${payload.projectName}</strong> has been cancelled.</p>
    <p><strong>Cancelled booking token:</strong> ${payload.bookingToken}</p>
  `;

  return { subject, text, html };
}

async function sendWithResend(args: {
  from: string;
  to: string;
  content: BookingEmailContent;
}): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.content.subject,
      text: args.content.text,
      html: args.content.html
    })
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`Resend request failed (${response.status}): ${responseBody}`);
  }
}

async function sendWithConsole(args: {
  from: string;
  to: string;
  content: BookingEmailContent;
  payload: BookingEmailJobPayload;
  job: JobRecord<BookingEmailJobPayload>;
}): Promise<void> {
  console.log(JSON.stringify({
    level: 'info',
    event: 'booking_email_job_processed',
    provider: 'console',
    job_id: args.job.id,
    job_attempt: args.job.attempts + 1,
    from: args.from,
    to: args.to,
    subject: args.content.subject,
    booking_token: args.payload.bookingToken,
    booking_event: args.payload.event,
    project_name: args.payload.projectName,
    client_first_name: args.payload.clientFirstName
  }));
}

async function processBookingEmailJob(
  payload: BookingEmailJobPayload,
  job: JobRecord<BookingEmailJobPayload>
): Promise<void> {
  const forceFailure = parseBoolean(process.env.EMAIL_QUEUE_FORCE_FAILURE, false);
  if (forceFailure) {
    throw new Error('EMAIL_QUEUE_FORCE_FAILURE is enabled');
  }

  const fromEmail = process.env.EMAIL_FROM ?? 'no-reply@opencalendar.local';
  const provider = resolveEmailProvider(process.env.EMAIL_PROVIDER);
  const content = buildBookingEmailContent(payload);
  const recipient = payload.clientEmail;

  if (provider === 'resend') {
    await sendWithResend({
      from: fromEmail,
      to: recipient,
      content
    });
    return;
  }

  await sendWithConsole({
    from: fromEmail,
    to: recipient,
    content,
    payload,
    job
  });
}

export function registerEmailQueueHandlers(): void {
  jobQueue.registerHandler<BookingEmailJobPayload>(BOOKING_EMAIL_JOB_TYPE, processBookingEmailJob);
}

export function enqueueBookingEmailJob(payload: BookingEmailJobPayload): string {
  const job = jobQueue.enqueue(BOOKING_EMAIL_JOB_TYPE, payload);
  return job.id;
}

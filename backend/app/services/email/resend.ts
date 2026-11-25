import { auth } from '@config/auth';
import { config } from '@config/config';
import { EmailSend, User } from '@app/models';
import { InvalidRequestError } from '@app/errors';
import { sendWelcomeEmail } from '@app/mailers/email';
import { isSuppressed } from './suppression';

/** Kinds an admin can send again. Each is rebuilt from scratch, never replayed: a sign-in link is single-use, so the
 * reader gets a new one. */
export const RESENDABLE_KINDS = ['magic-link', 'welcome'] as const;

type ResendableKind = (typeof RESENDABLE_KINDS)[number];

/** The plugin endpoint is not on the inferred `auth.api` type (the options are built at runtime); name only what this
 * file calls. */
type MagicLinkApi = {
  signInMagicLink: (args: { body: { email: string; callbackURL: string }; headers: Headers }) => Promise<unknown>;
};

function isResendable(kind: string): kind is ResendableKind {
  return (RESENDABLE_KINDS as readonly string[]).includes(kind);
}

/** Whether `resendEmail` can send this again; the admin view shows its button from this. A welcome needs its account. */
export function canResend(send: { kind: string; userId?: number | null }): boolean {
  return isResendable(send.kind) && (send.kind !== 'welcome' || send.userId != null);
}

/** Send a fresh copy of a logged message to the same address. The new send lands in the log like any other. */
export async function resendEmail(send: EmailSend): Promise<void> {
  if (!isResendable(send.kind)) {
    throw new InvalidRequestError(`A ${send.kind} email cannot be resent.`);
  }
  if (await isSuppressed(send.address)) {
    throw new InvalidRequestError('That address is suppressed.');
  }

  if (send.kind === 'magic-link') {
    // Through better-auth, so the link and code are minted, stored and expire exactly as a reader's own request would.
    await (auth.api as unknown as MagicLinkApi).signInMagicLink({
      body: { email: send.address, callbackURL: `${config.BASE_URL}/` },
      headers: new Headers(),
    });
    return;
  }

  const user = send.userId ? await User.findOneBy({ id: send.userId }) : null;
  if (!user?.email) {
    throw new InvalidRequestError('That welcome email has no account to send to.');
  }
  await sendWelcomeEmail(user.id, user.username ?? '', user.email);
}

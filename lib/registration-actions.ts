'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { databaseErrorCode, registerWorkshop } from './db/registration';
import { hitRateLimit } from './db/rate-limit';
import { parseRegistrationForm, parseWorkshopName, REGISTRATION_LIMIT, registerWorkshopOutcome, safeOrigin } from './registration';
import { createClient } from './supabase/server';

/** Step 1 (page /registrieren): create the login. Supabase sends the confirmation e-mail. */
export async function signUp(formData: FormData): Promise<void> {
  const parsed = parseRegistrationForm({
    workshopName: formData.get('workshopName'),
    email: formData.get('email'),
    password: formData.get('password'),
    terms: formData.get('terms'),
  });
  if (!parsed.ok) redirect(`/registrieren?error=${parsed.error}`);

  const requestHeaders = headers();
  let allowed = true;
  try {
    allowed = await hitRateLimit(requestHeaders, REGISTRATION_LIMIT);
  } catch (error) {
    console.error('Das Anfragelimit konnte nicht geprüft werden.', error); // fail open, Supabase limits sign-ups too
  }
  if (!allowed) redirect('/registrieren?error=rate');

  const origin = safeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ?? safeOrigin(requestHeaders.get('origin'));
  if (!origin) redirect('/registrieren?error=failed');

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.value.email,
    password: parsed.value.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/werkstatt-anlegen`,
      data: { workshop_name: parsed.value.workshopName, terms_accepted_at: new Date().toISOString() },
    },
  });
  if (error) {
    // never say whether the address already exists; only a too weak password is the user's to fix
    if (error.code === 'weak_password') redirect('/registrieren?error=password');
    if (error.code === 'over_email_send_rate_limit' || error.status === 429) redirect('/registrieren?error=rate');
    console.error('Registrierung fehlgeschlagen.', error.code ?? error.status);
    redirect('/registrieren?error=failed');
  }
  redirect('/registrieren?sent=1');
}

/** Step 2 (page /werkstatt-anlegen, after the e-mail link): create the workshop, the user becomes owner. */
export async function createWorkshop(formData: FormData): Promise<void> {
  const name = parseWorkshopName(formData.get('workshopName'));
  if (!name.ok) redirect('/werkstatt-anlegen?error=name');

  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login?error=session');

  try {
    await registerWorkshop(user.id, name.value);
  } catch (error) {
    const outcome = registerWorkshopOutcome(databaseErrorCode(error));
    if (outcome === 'has-workshop') redirect('/');
    if (outcome === 'failed') console.error('Die Werkstatt konnte nicht angelegt werden.', error);
    redirect(`/werkstatt-anlegen?error=${outcome}`);
  }
  redirect('/');
}

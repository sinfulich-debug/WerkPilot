'use server';

import { redirect } from 'next/navigation';
import { createClient } from './server';

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/login?error=credentials');

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect('/login?error=credentials');

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) redirect('/login?error=credentials');

  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (user) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
  redirect('/login');
}

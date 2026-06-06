// Guardrail Financial — Shared Auth Module
// Requires window.supabase (Supabase CDN UMD) to be loaded before this module runs.

const SUPABASE_URL = 'https://cskgpnmgsrkuexbucrqr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yHtOvUkDevZi_8e9XeCX0g_k7sjER12';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session ?? null;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.replace('/login.html');
    return null;
  }
  return session.user;
}

export async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return error ? null : data;
}

export function redirectToDashboard(accountType) {
  const paths = {
    individual: '/dashboard/individual.html',
    business: '/dashboard/business.html',
  };
  window.location.replace(paths[accountType] ?? '/login.html');
}

export async function logout() {
  await supabaseClient.auth.signOut();
  window.location.replace('/login.html');
}

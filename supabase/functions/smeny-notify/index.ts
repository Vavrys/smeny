// Supabase Edge Function: smeny-notify
//
// Sends "schedule published" emails when an admin publishes a rozpis:
// one email per employee recipient, plus a separate confirmation email
// to the admin who published. Emails are resolved from each user_id via
// the Supabase Auth Admin API, which needs the service role key — Edge
// Functions get that automatically as SUPABASE_SERVICE_ROLE_KEY.
//
// The app calls this with .invoke() and treats failures as best-effort
// (the in-app notifications are already inserted client-side before this
// runs), so a missing RESEND_API_KEY or a lookup failure never blocks
// publishing — it's just recorded in the response for the debug log.
//
// Deploy:
//   supabase functions deploy smeny-notify
// Configure the email provider key (Resend — https://resend.com), same as smeny-support:
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
// Optionally override the from-address (defaults below, shared with smeny-support):
//   supabase secrets set SUPPORT_FROM_EMAIL="Směny <support@yourdomain.com>"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const FROM_EMAIL = Deno.env.get('SUPPORT_FROM_EMAIL') || 'Směny <onboarding@resend.dev>';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

async function getUserEmail(userId: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.email || data?.user?.email || null;
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ emailed: boolean; reason?: string }> {
  if (!RESEND_API_KEY) return { emailed: false, reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) return { emailed: false, reason: await res.text() };
  return { emailed: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { user_ids = [], admin_user_id, month_label } = await req.json();

    if (!month_label) {
      return new Response(JSON.stringify({ error: 'Missing month_label' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const results: Record<string, unknown>[] = [];
    for (const uid of user_ids) {
      const email = await getUserEmail(uid);
      if (!email) {
        results.push({ user_id: uid, emailed: false, reason: 'no email found' });
        continue;
      }
      const html = `
        <h2>Nový rozpis směn</h2>
        <p>Byl publikován nový rozpis na <strong>${month_label}</strong>. Podívej se na své směny v aplikaci Směny.</p>
      `;
      const r = await sendEmail(email, `Nový rozpis na ${month_label}`, html);
      results.push({ user_id: uid, email, ...r });
    }

    let admin: Record<string, unknown> | null = null;
    if (admin_user_id) {
      const email = await getUserEmail(admin_user_id);
      if (email) {
        const html = `
          <h2>Rozpis publikován</h2>
          <p>Rozpis na <strong>${month_label}</strong> byl úspěšně publikován. Zaměstnanci (${user_ids.length}) byli upozorněni in-app notifikací${RESEND_API_KEY ? ' a emailem' : ''}.</p>
        `;
        const r = await sendEmail(email, `Rozpis ${month_label} publikován`, html);
        admin = { user_id: admin_user_id, email, ...r };
      } else {
        admin = { user_id: admin_user_id, emailed: false, reason: 'no email found' };
      }
    }

    return new Response(JSON.stringify({ ok: true, results, admin }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

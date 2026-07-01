// Supabase Edge Function: smeny-support
//
// Sends an email notification when someone submits the Help Center
// contact form. The form already saves the request to the
// `support_requests` table client-side — this function is a
// best-effort notification on top of that (the app calls it with
// .catch(()=>{}), so a failure here never blocks the saved request).
//
// Deploy:
//   supabase functions deploy smeny-support
// Configure the email provider key (Resend — https://resend.com):
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
// Optionally override the notification recipient (defaults below):
//   supabase secrets set SUPPORT_NOTIFY_EMAIL=you@example.com
//   supabase secrets set SUPPORT_FROM_EMAIL="Směny <support@yourdomain.com>"

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTIFY_EMAIL = Deno.env.get('SUPPORT_NOTIFY_EMAIL') || 'vavra@dp-partners.cz';
const FROM_EMAIL = Deno.env.get('SUPPORT_FROM_EMAIL') || 'Směny <onboarding@resend.dev>';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

function escapeHtml(s: string){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
}

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS'){
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { org_id, name, email, phone, message } = await req.json();

    if(!name || !email || !message){
      return new Response(JSON.stringify({ error: 'Missing name, email or message' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if(!RESEND_API_KEY){
      // No email provider configured — the request is already saved in
      // support_requests, so this isn't fatal, just skip the email.
      return new Response(JSON.stringify({ ok: true, emailed: false, reason: 'RESEND_API_KEY not set' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const html = `
      <h2>Nová zpráva z Help Centra — Směny</h2>
      <p><strong>Jméno:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Telefon:</strong> ${escapeHtml(phone || '—')}</p>
      <p><strong>Organizace (ID):</strong> ${escapeHtml(org_id || '—')}</p>
      <p><strong>Zpráva:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_EMAIL,
        reply_to: email,
        subject: `[Směny Support] ${name}`,
        html,
      }),
    });

    if(!res.ok){
      const errText = await res.text();
      return new Response(JSON.stringify({ ok: true, emailed: false, reason: errText }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, emailed: true }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});

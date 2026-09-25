// Send a WhatsApp text message. Two providers are supported behind a flag:
//   - meta     → official WhatsApp Business Cloud API (Graph API)
//   - wasender → WasenderAPI (https://wasenderapi.com), unofficial gateway
// DEMO: without provider creds this becomes log-only, so the /retailer chat
// simulator (which reads replies from the webhook HTTP response) keeps working
// with zero external setup.
const GRAPH_URL = 'https://graph.facebook.com/v20.0';
const WASENDER_URL = 'https://www.wasenderapi.com/api/send-message';

// Which backend to use. Defaults to wasender if its key is set, else meta.
function provider() {
  const explicit = (process.env.WHATSAPP_PROVIDER || '').toLowerCase();
  if (explicit === 'meta' || explicit === 'wasender') return explicit;
  return process.env.WASENDER_API_KEY ? 'wasender' : 'meta';
}

export async function sendText(to, body) {
  console.log(`→ outbound to ${to}: ${body.replaceAll('\n', ' | ')}`);
  if (provider() === 'wasender') return sendViaWasender(to, body);
  return sendViaMeta(to, body);
}

async function sendViaMeta(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.log('  (Meta WhatsApp creds not set — message logged only)');
    return;
  }

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    if (!res.ok) {
      console.error(`  WhatsApp send failed (${res.status}):`, await res.text());
    }
  } catch (err) {
    // DEMO: never let a send failure crash the webhook mid-demo.
    console.error('  WhatsApp send error:', err.message);
  }
}

async function sendViaWasender(to, body) {
  const key = process.env.WASENDER_API_KEY;
  if (!key) {
    console.log('  (WaSender key not set — message logged only)');
    return;
  }

  try {
    const res = await fetch(WASENDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      // WaSender wants E.164 (leading +) for plain numbers; JIDs pass through.
      body: JSON.stringify({ to: wasenderRecipient(to), text: body }),
    });
    if (!res.ok) {
      console.error(`  WhatsApp send failed (${res.status}):`, await res.text());
    }
  } catch (err) {
    // DEMO: never let a send failure crash the webhook mid-demo.
    console.error('  WhatsApp send error:', err.message);
  }
}

// Inbound numbers arrive as bare digits (e.g. 923001234567); WaSender's send
// endpoint expects E.164. Leave JIDs (…@s.whatsapp.net / …@g.us) and already
// +-prefixed numbers untouched.
function wasenderRecipient(to) {
  const s = String(to);
  if (s.includes('@') || s.startsWith('+')) return s;
  return `+${s}`;
}

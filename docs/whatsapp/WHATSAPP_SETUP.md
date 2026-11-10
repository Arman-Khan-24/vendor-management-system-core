# WhatsApp + Gemini/Groq setup

Localhost ordering is implemented and verified with real Gemini text/photo requests, PostgreSQL concurrency/rollback tests, and both production builds. Start with [localhost setup](LOCALHOST_SETUP.md); it needs no Meta account or hosting. The remaining sections explain optional real WhatsApp setup. Meta account connection and actual delivery are pending; deployment is outside the current task.

## 1. Source and local checkout

The tested implementation is in `/home/aakaa/work/orderledger`, with Linux dependencies. Source changes are also applied to `D:\Atkind work\orderledger` (`/media/d/Atkind work/orderledger`). Existing source edits, demo files, original `.env`, and Windows dependencies are preserved. Only AI credentials were imported into new private `.env.local` files; the original business database was not used or migrated.

The complete patch is `/home/aakaa/work/orderledger-whatsapp.patch`, against the pre-integration snapshot. It is already applied to the D-drive project. For another matching source copy, check before applying:

```bash
cd '/media/d/Atkind work/orderledger'
git apply --check --ignore-space-change /home/aakaa/work/orderledger-whatsapp.patch
git apply --ignore-space-change /home/aakaa/work/orderledger-whatsapp.patch
```

Do not repeat these commands on an already updated project. Resolve any conflicts before applying elsewhere. Use dependencies installed for the host's operating system.

## 2. Verify locally with a disposable business

For actual Meta testing, stop the localhost launcher first: its transport deliberately captures replies. Use the isolated API below with a separate synthetic business and real Meta credentials. On Windows, use PowerShell in the D-drive project:

```powershell
Set-Location 'D:\Atkind work\orderledger\backend'
npm ci
npm run typecheck:tests
npm run test:whatsapp
npm run test:compiled
npm run build
npm run dev:isolated
```

`dev:isolated` runs the API and WhatsApp worker on `127.0.0.1:5100`, using a temporary PostgreSQL database. It never uses your business database. Use this mode only for development: it has a fixed development signing secret, and the business/configuration disappear when it stops.

In another terminal:

```powershell
Set-Location 'D:\Atkind work\orderledger\frontend'
npm ci
npm run build
$env:VITE_API_URL = 'http://127.0.0.1:5100'
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://127.0.0.1:5174`, create a business such as **WhatsApp Test**, and add a customer with your own verified test recipient number, including its country code. Add **Tomato**, unit **kg**, price **40**. Use synthetic catalog/customer data only. Tests always use their own disposable PostgreSQL, with mocked provider responses; running them does not send WhatsApp messages or call AI providers.

## 3. Create your Meta test account

Start at [Meta's WhatsApp developer hub](https://whatsappbusiness.com/developers/developer-hub/). Sign into your own Meta account, create a developer app with WhatsApp access, and open its WhatsApp API setup. Meta may change the names of these screens; follow the setup offered by your account.

1. Use Meta's provided test sending number for the initial test. You do not need to connect your everyday WhatsApp number as the business sender yet.
2. Add your own WhatsApp number as a test recipient and complete its verification. In development mode, use only recipients allowed by Meta's test setup.
3. Copy the **Phone Number ID**, **WhatsApp Business Account ID**, **access token**, and **Graph API version** shown in API setup. The number ID is different from the displayed telephone number.
4. Obtain the **app secret** from the app's basic settings. Generate your own random **webhook verify token** and save it securely; it is separate from the app secret and access token.

You can generate a verify token locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Enter secrets in OrderLedger's connection form or your local server environment where specified. Do not paste tokens, app secrets or database passwords into chat, Git, screenshots or frontend `VITE_` variables. Test access tokens expire; follow Meta's token setup for a persistent deployment.

## 4. Save and test AI settings

In **Settings → Connections → AI provider connections**:

| Slot | Provider | Endpoint | Model |
|---|---|---|---|
| Primary | Gemini | `https://generativelanguage.googleapis.com/v1beta` | A currently available Gemini model that supports structured JSON and images; `gemini-2.5-flash` is the code default |
| Fallback | Groq | `https://api.groq.com/openai/v1` | A model currently available in your Groq console; choose one supporting images if you want photo fallback |

Save your own provider keys. Choose model IDs from your provider console and verify availability; an API key existing in an old environment file does not prove it is valid or that a model remains available. See [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini images](https://ai.google.dev/gemini-api/docs/image-understanding), and [Groq vision](https://console.groq.com/docs/vision).

Click **Test saved AI connection**. This makes a real, small AI request using a synthetic order and may consume provider quota; it sends no WhatsApp message. It reports whether primary or fallback succeeded. That text test does not prove photo support or prove that both providers work independently. To test fallback, temporarily select an unavailable primary model in this disposable business, verify the result reports fallback, then restore the primary model.

Saved business configuration overrides global environment defaults, including an explicitly cleared key. A saved Groq slot uses its selected model for both text and photos, so a text-only model will fail on photos. For environment-only configuration, `AI_PRIMARY_VISION_MODEL` and `AI_FALLBACK_VISION_MODEL` can choose separate image models. Custom/OpenAI settings can still be stored, but this ordering pipeline supports Gemini and Groq.

## 5. Connect the public webhook

Meta cannot call `localhost`. Use an HTTPS tunnel to your disposable API for development, or a deployed backend. For example, after following [ngrok setup](https://ngrok.com/docs/getting-started/):

```powershell
ngrok http 5100
```

Keep both the tunnel and disposable API running. Restrict the tunnel to this test instance. In **Settings → Connections → WhatsApp ordering**, save the IDs, access token, app secret, Graph version, country code (`91` for Indian local customer numbers), and your verify token. Leave ordering disabled while setting up the callback.

Use this callback in Meta, replacing the origin with the public tunnel/deployment URL and copying the business UUID shown in OrderLedger:

```text
https://YOUR-PUBLIC-BACKEND/webhooks/whatsapp/YOUR-BUSINESS-UUID
```

If the application displays a localhost callback, substitute the public tunnel origin yourself. Use exactly the same verify token in Meta and OrderLedger. Complete Meta's webhook verification and subscribe to **messages** for the intended WhatsApp Business Account. The GET challenge works while ordering is disabled; POST ingestion returns 503 until ordering is enabled.

Click **Test saved Meta connection**. This reads the configured Meta number; it does not send a message. After AI testing, callback verification and the messages subscription succeed, enable WhatsApp and save. This authorizes processing customer-initiated orders for that business. Requests require Meta's HMAC signature over the exact raw body, and events are scoped to the saved WABA/Phone Number IDs.

## 6. Run live text and photo acceptance

From your verified recipient's WhatsApp, send to the Meta test number:

1. Send **Tomato 500 g**. Check the inbox shows a draft and WhatsApp receives **Tomato — 0.5 kg**, total **₹20** if tax is zero. No ledger order should exist yet.
2. Reply **YES** after receiving the summary. Confirm exactly one `Received` order, quantity `0.5 kg`, total `₹20`, source `whatsapp_text`.
3. Reply YES again. Confirm it does not create another order.
4. Send a new order, then a correction such as **change Tomato to 1 kg**. Confirm a fresh summary arrives, and only its final quantities become an order after YES.
5. Test **NO**, an unknown product, a missing unit, and two tomato varieties. Confirm no order is created from unresolved input. Review items in the inbox, send the reviewed summary, then confirm from WhatsApp.
6. Send a clear JPEG/PNG photo below 5 MB with **Tomato 500 g** written on it. Check extraction, corrected catalog quantity, summary and delivery status, then YES. Confirm source `whatsapp_image`. Repeat with Hindi/Hinglish, crossed-out lines, an unclear quantity and an unfamiliar product; inspect the result instead of assuming OCR accuracy.
7. Let a quote expire or edit its catalog price before YES. It must request a fresh order and create no order from the old quote.

Free-form replies require a customer-initiated message within the preceding 24 hours. Proactive templates, invoice notifications, voice notes and document/PDF ingestion are outside this implementation. `sent` means Meta accepted the send; delivery/read receipts provide stronger evidence. If Meta reports delivery failure for a summary, review its original inbound order and send a fresh summary.

The inbox offers explicit retry for failed jobs. A timeout, worker crash or persistence failure after sending can leave delivery uncertain. Check the actual conversation before retrying an outbound job, since it may send the reply again. Inbound provider failures retry with bounded backoff; ambiguous extracted orders require clarification or owner review.

## 7. Hosting is deferred

This task runs on localhost. No Render/Vercel account, remote deployment, or production database migration was performed. Real Gemini text/photo requests were verified in the local demo; actual Meta delivery still needs the account and callback steps above. If hosting is added later, use the README build instructions and repeat text/photo acceptance and restart/recovery checks on that host.

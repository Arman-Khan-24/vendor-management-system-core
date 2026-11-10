# Run OrderLedger on localhost

Requires Node.js 22 or newer. The launcher installs missing dependencies, starts a temporary PostgreSQL database, and opens the frontend and API on loopback addresses. No PostgreSQL account or hosting service is needed.

From the project root:

```bash
node start-local.mjs
```

On Windows, the project root is `D:\Atkind work\orderledger`. The verified Linux checkout is `/home/aakaa/work/orderledger`; it has Linux dependencies. The original D-drive dependency installations are preserved.

Open **http://127.0.0.1:5174**, click **Open localhost demo**, then open **WhatsApp inbox**. The API is **http://127.0.0.1:5100**. Keep the launcher terminal open; Ctrl+C stops both servers and removes the temporary database. Stop an existing launcher before starting another on these ports.

## Credentials

The project's existing Gemini key was verified with real requests and configured privately in `backend/.env.local`. Text and photo extraction use **gemini-2.5-flash**. The saved Groq key returned HTTP 401 (`invalid_api_key`), so Groq fallback is disabled in the local configuration. A replacement Groq key and an available model are needed to enable that fallback.

The launcher imports only AI keys and model settings from `backend/.env` when a local value is missing. It generates a separate signing secret and preserves that local secret on subsequent runs. Explicitly cleared local keys stay cleared. It does not import the source database credentials or signing secret, and it does not edit the original `.env`.

To import AI settings from a different private file on the first run:

```bash
node start-local.mjs --env-source "/absolute/path/to/private.env"
```

Existing `backend/.env.local` values take precedence. Edit that file to replace a configured key or model, then restart. Backend secrets stay out of `frontend/.env.local`, which contains only the local API address. Both files are ignored by Git.

## Try the complete flow

The disposable **OrderLedger Local Test** business includes **Demo Restaurant** and this catalog:

| Product | Unit | Price |
|---|---|---:|
| Tomato | kg | ₹40 |
| Onion | kg | ₹30 |
| Rice | kg | ₹60 |
| Milk | litre | ₹55 |
| Eggs | dozen | ₹72 |

1. Send **Tomato 500 g** using the local test form. Wait for the captured **Tomato — 0.5 kg**, **₹20** summary. No order is created yet.
2. Send **YES**. One **Received** order appears, with source `whatsapp_text`. Send YES again to check the duplicate guard.
3. Upload a clear JPEG or PNG below 5 MB. A photo containing **Tomato 500 g** and **Onion 1 kg** should produce a **₹50** summary. Send YES after checking it; the order source is `whatsapp_image`.
4. Try a correction or **NO**. Unclear products, units, and quantities need clarification or owner review before confirmation.

The inbox updates every ten seconds. Use **Refresh** for an immediate update. Orders also appear on the normal Orders page. All accounts, messages, and orders in this database disappear when the demo stops.

## Local replies and real WhatsApp

Gemini requests are real and use provider quota. Customer messages are submitted from the local form; replies are captured inside OrderLedger. This mode never sends a WhatsApp message and needs no Meta credentials.

The demo endpoints exist only in the dedicated local entry point, are restricted to localhost, and permit message submission only by the disposable business's owner. The standard production server does not expose them.

For actual WhatsApp delivery, stop this demo and follow [WhatsApp setup](WHATSAPP_SETUP.md) using a separate business, your Meta test account, and an HTTPS tunnel to the standard or isolated API. Meta account connection and real delivery remain pending; deployment is outside the current localhost task.

See [verification results](WHATSAPP_VERIFICATION.md) for the database tests, builds, and live Gemini browser checks completed on 10 November 2026.

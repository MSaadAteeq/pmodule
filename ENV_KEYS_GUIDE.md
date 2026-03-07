# Where to put your keys and where to find them

## 1. Create the `.env` file

Create a file named **`.env`** in the **project root** (same folder as `package.json`):

```
d:\Parakeet\.env
```

Paste your keys there, one per line. Example:

```
OPENAI_API_KEY=sk-...
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

After saving `.env`, restart the app (`npm run tauri dev`).

---

## 2. Where to find each value

### OPENAI_API_KEY (app / backend)

Used by the app for AI answers (GPT). Users do not enter this; you set it once in `.env`.

1. Go to [platform.openai.com](https://platform.openai.com) → API keys.
2. Create a key (starts with `sk-...`).
3. In `.env` set: `OPENAI_API_KEY=sk-...`

---

### VITE_SUPABASE_URL

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Open your project (or create one).
3. Click **Settings** (gear icon in the left sidebar).
4. Click **API** under "Project Settings".
5. Under **Project URL**, copy the URL. It looks like:
   - `https://abcdefghijkl.supabase.co`
6. In your `.env` file set:
   - `VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co`  
   (use your actual URL, not this example.)

### VITE_SUPABASE_ANON_KEY

1. Same place: **Settings → API**.
2. Under **Project API keys**, find **anon** **public**.
3. Click to copy the long key (starts with `eyJ...`).
4. In `.env` set:
   - `VITE_SUPABASE_ANON_KEY=eyJ...`  
   (paste the full key.)

---

### Optional: Stripe payment links

Only needed if you use the Upgrade modal with static links.

- **VITE_STRIPE_LINK_3** – Stripe Payment Link for the $20 / 3 sessions product.
- **VITE_STRIPE_LINK_10** – Stripe Payment Link for the $50 / 10 sessions product.
- **VITE_STRIPE_LINK_UNLIMITED** – Stripe Payment Link for the $40/month product.

Create them in [Stripe Dashboard](https://dashboard.stripe.com) → **Payment links** → Create link, then paste each URL into `.env`.

---

## 3. Summary: what goes in `.env`

| Variable | Where to get it |
|----------|------------------|
| `OPENAI_API_KEY` | OpenAI → API keys (for app backend) |
| `VITE_SUPABASE_URL` | Supabase → Settings → API → **Project URL** |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon public** key |
| `VITE_STRIPE_LINK_3` | (Optional) Stripe Dashboard → Payment links |
| `VITE_STRIPE_LINK_10` | (Optional) Stripe Dashboard → Payment links |
| `VITE_STRIPE_LINK_UNLIMITED` | (Optional) Stripe Dashboard → Payment links |

File location: **`d:\Parakeet\.env`**

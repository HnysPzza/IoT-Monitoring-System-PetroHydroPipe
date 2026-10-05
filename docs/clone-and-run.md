# Clone and Run the Project

This guide sets up a local copy of the app connected to **your own Supabase project**. It does not use the project owner's database.

## What You Need

| Tool | Version or setup | Required? |
|---|---|---|
| Git | Current version | Yes, to clone the repository |
| Node.js | **Node 24 LTS recommended.** Vite 8 requires Node 20.19+ or 22.12+; use a supported LTS release. | Yes |
| npm | Included with the Node.js installer. The repo has separate npm lockfiles for the frontend and backend. | Yes |
| Supabase | A new hosted project in your own Supabase account | Yes |
| Modern browser | Current Chrome, Edge, Firefox, or Safari | Yes |
| Code editor | Any editor, including VS Code | Optional |
| Editor/browser extensions | None required | No |
| Docker, local PostgreSQL, Supabase CLI | Not needed for this hosted Supabase setup | No |

The source code, SQL files, package manifests, and lockfiles come with `git clone`. `node_modules`, `.env` files, Supabase credentials, database tables, and database data do not. `npm ci` downloads and installs the locked packages on the new computer.

The project packages include React `^19.2.7`, Vite `^8.0.16`, Express `^5.2.1`, and Supabase JS `^2.107.0`. They are installed by `npm ci`; do not install them globally. This repo does not pin a Node.js version in `engines`, `.nvmrc`, or `.node-version`, so Node 24 LTS is the recommended runtime.

## 1. Install Git and Node.js

Install [Git](https://git-scm.com/install/) and [Node.js 24 LTS](https://nodejs.org/en/download/). npm is installed with Node.js. Open a new terminal and check:

```bash
git --version
node --version
npm --version
```

## 2. Clone the Repository

If the GitHub repository is private, the owner must first grant your GitHub account access. Then run:

```bash
git clone https://github.com/HnysPzza/IoT-Monitoring-System-PetroHydroPipe.git
cd IoT-Monitoring-System-PetroHydroPipe
```

## 3. Install Frontend and Backend Packages

Run `npm ci` once in each folder. It installs the exact dependency tree recorded in each lockfile.

```bash
cd Backend
npm ci
cd ../Frontend
npm ci
cd ..
```

## 4. Create Your Own Supabase Project and Database

Create a new project in [Supabase](https://supabase.com/dashboard). In that project's **SQL Editor**, run these files from the cloned repository in this order:

1. `Backend/database/schema.sql`
2. `Backend/database/seed.sql`

The seed adds the app roles, machine M-01, and its five sensor rows. It does not create a user account.

### Create the Initial App Admin

The app uses its own `public.users` table; creating a user in Supabase Auth does not create an app login. Before running migration 029, create exactly one active Admin in `public.users`.

From the `Backend` folder, generate a bcrypt hash for a unique local development password. Enter a password you do not use for other accounts at the prompt, then copy the printed hash:

```bash
node -e "const bcrypt=require('bcryptjs');const rl=require('node:readline').createInterface({input:process.stdin,output:process.stdout});rl.question('Local admin password: ',p=>bcrypt.hash(p,10).then(hash=>{console.log(hash);rl.close()}))"
```

In the Supabase SQL Editor, run this once after replacing `PASTE_BCRYPT_HASH_HERE` with the hash:

```sql
insert into public.users (
  role_id, name, username, email, password_hash, status, must_change_password
)
select
  id, 'Local Admin', 'local-admin', null, 'PASTE_BCRYPT_HASH_HERE', 'Active', false
from public.roles
where name = 'Admin';
```

Now run every SQL file in `Backend/database/migrations/` from **029 through 045**, in numeric order. The base schema already includes migrations through 028, so do not replay migrations 001–028 on this fresh database. Finally run:

```sql
select public.get_backend_readiness();
```

It must return `45`. The detailed database instructions are in [`Backend/database/README.md`](../Backend/database/README.md).

## 5. Configure Local Environment Files

Create local environment files from the committed examples:

```bash
cp Backend/.env.example Backend/.env
cp Frontend/.env.example Frontend/.env
```

Edit `Backend/.env` and set these values from **your** Supabase project:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-side-secret-or-service-role-key
JWT_SECRET=your-private-random-secret-at-least-24-characters-long
```

The backend reads the Supabase key from `SUPABASE_SERVICE_ROLE_KEY`. Use the server-side secret/service-role key from the project's API settings; never put it in the frontend or share it. Generate a random JWT secret locally with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Copy the output into `JWT_SECRET`. Keep all real values in local `.env` files; never commit them. The example already sets the local API URL and `VITE_USE_MOCK_LOGIN=false` in `Frontend/.env`. Leave these values unless you changed the local ports:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_USE_MOCK_LOGIN=false
```

Brevo credentials are optional for starting the app. Configure them in `Backend/.env` only if the app needs to send account invitation or password reset emails. Simulator/device keys are only needed to send sensor events; see the optional section below.

## 6. Start the App

Open two terminals at the cloned repository root.

**Terminal 1 — backend:**

```bash
cd Backend
npm run dev
```

The backend runs at `http://localhost:3000`. Check `http://localhost:3000/api/health/ready`; it should return a ready status.

**Terminal 2 — frontend:**

```bash
cd Frontend
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`. Sign in with username `local-admin` and the password used to create its bcrypt hash.

## Optional: Generate Test Sensor Events

No physical ESP32 hardware is required to run the app. To send simulated sensor events, run this from `Backend`:

```bash
npm run iot:keys
```

The command prints five simulator secrets and SQL containing their hashes. Put each printed `IOT_SIM_S01_KEY` through `IOT_SIM_S05_KEY` value in `Backend/.env`, then run the printed SQL once in your Supabase SQL Editor. Keep the plaintext keys private. With the backend running, send one sample batch:

```bash
npm run iot:simulate:demo-once
```

## Official References

- [Node.js downloads and releases](https://nodejs.org/en/download/)
- [Vite guide and Node.js requirements](https://vite.dev/guide/)
- [npm `ci` command](https://docs.npmjs.com/cli/commands/npm-ci/)
- [Supabase database and SQL Editor](https://supabase.com/docs/guides/database/overview)
- [Supabase API keys and key handling](https://supabase.com/docs/guides/getting-started/api-keys)

# Enable Steady accounts and cloud saving

Steady works without an account and saves its board in the current browser. To enable email/password accounts and sync each user's board between devices:

1. Create a Supabase project.
2. In the project's SQL Editor, run [`supabase-schema.sql`](./supabase-schema.sql). It creates one JSONB board row per account and restricts reads and writes to that account with row-level security.
3. Put the project's URL and **publishable** key (or legacy anon key) in `supabase-config.js`. These are public client settings protected by row-level security; never put a service-role key in the browser app.
4. In Supabase Authentication settings, enable email/password sign-in and set the site's URL and allowed redirect URLs for the local address and deployed app. Email confirmation can be enabled; new users will be asked to confirm their address before logging in.
5. Serve the app over HTTP (for example, `python -m http.server 8000`) and open `http://localhost:8000`. Supabase auth redirects do not work from a `file://` URL.

The app stores tasks, habits, daily history, and sound preference in the user's board row. It does not record a click-by-click activity log. When an account has no board yet, Steady asks before copying an existing board from the current browser. Existing account data replaces the view for that session; signing out returns to this browser's local board.

Without a configured Supabase project, the app continues to work in local-only mode. Account sign-in and cloud syncing require the project URL/key, schema, and auth redirect settings above. Before opening this to customers, add and publish a privacy policy and provide an account/data deletion process appropriate for your users.

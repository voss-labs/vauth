import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { VossMark } from "~/components/voss-mark";

// No web-font CDN. Geist is bundled via @fontsource-variable/geist, so the login
// page never blocks on a third-party request — this is the one screen that has to
// render on a bad campus connection.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        {/* An identity provider has nothing to gain from being indexed. */}
        <meta name="robots" content="noindex" />
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Something broke";
  let detail = "An unexpected error occurred. Try again in a moment.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Not found" : `Error ${error.status}`;
    detail =
      error.status === 404
        ? "That page does not exist."
        : error.statusText || detail;
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
    stack = error.stack;
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden p-6">
      <div className="voss-grid pointer-events-none absolute inset-0" />
      <div className="relative w-full max-w-sm">
        <VossMark status="error" className="mb-9" />
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {detail}
        </p>
        <a
          href="/sign-in"
          className="text-foreground mt-6 inline-block text-sm underline underline-offset-4"
        >
          Back to sign in
        </a>
        {stack && (
          <pre className="border-border text-muted-foreground mt-8 max-h-72 overflow-auto rounded-md border p-4 text-xs">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}

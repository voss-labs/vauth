// Trusted OAuth clients — configuration as code.
//
// This file is the source of truth for which products may authenticate against
// vauth. It is deliberately a checked-in file rather than a table an admin edits
// through a web console: adding a product that can log your students in is a
// change that should arrive as a pull request somebody reviewed, not a row
// somebody inserted at midnight.
//
// Run `npm run clients` to sync this file to the database.
// Run `npm run clients:add` to add a product interactively.

export type TrustedClient = {
  /** Human name, shown on the consent screen if it is ever displayed. */
  name: string;

  /** What this product is. Documentation for the next person, not used at runtime. */
  description: string;

  /**
   * Every URI the provider is allowed to send an authorization code to.
   * An attacker who can add a redirect URI can steal every login, so this list
   * is the security boundary — keep it exact, no wildcards, no trailing slashes.
   * Include localhost entries so contributors can develop against the real IdP.
   */
  redirectUris: string[];

  /** Scopes this product may request. Keep it minimal: it can only ask for these. */
  scopes: string[];

  /**
   * First-party means VOSS owns the product, so the consent screen is skipped —
   * the same reason Google does not ask you to authorize Gmail. Set this to false
   * for anything VOSS does not control, and the user will be asked explicitly.
   */
  firstParty: boolean;
};

export const clients: TrustedClient[] = [
  {
    name: "VERP",
    description:
      "College ERP — student records, attendance, marks. The reference integration.",
    redirectUris: [
      "https://verp.vosslabs.org/api/auth/oauth2/callback/voss",
      "http://localhost:3000/api/auth/oauth2/callback/voss",
    ],
    scopes: ["openid", "profile", "email"],
    firstParty: true,
  },
  {
    name: "vroom",
    description:
      "Open discussion rooms for the college. Any VIT student can read and post without being invited, which is the one thing a WhatsApp group cannot do.",
    redirectUris: [
      "https://vroom.vosslabs.org/api/auth/oauth2/callback/voss",
      "http://localhost:5173/api/auth/oauth2/callback/voss",
    ],
    // vroom needs a name to show beside a post and an email to prove the person
    // is a VIT student. It asks for nothing else: the roll number, branch and
    // year it displays are collected by vroom itself at onboarding, because the
    // vauth user table deliberately never grows product columns.
    scopes: ["openid", "profile", "email"],
    firstParty: true,
  },
];

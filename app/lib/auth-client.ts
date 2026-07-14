import { createAuthClient } from "better-auth/react";
import { emailOTPClient, adminClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    adminClient(),
    // Carries the signed `oauth_query` through the login and consent screens.
    // Without it, a user who arrives mid-authorization signs in successfully and
    // then lands nowhere, because the provider has lost the request it was
    // resuming.
    oauthProviderClient(),
  ],
});

export const { useSession, signOut } = authClient;

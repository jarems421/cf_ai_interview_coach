import { ClerkProvider, SignIn, UserButton, useAuth } from "@clerk/react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { App } from "./App";

type AuthGateProps = {
  publishableKey: string;
};

function ClerkAuthGate({ publishableKey: _publishableKey }: AuthGateProps) {
  const { isSignedIn, getToken, userId } = useAuth();

  // Expose Clerk auth state via window so App can read it without a hard
  // dependency on @clerk/react (App is also rendered without Clerk when no
  // publishable key is set).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__clerkUseAuth = () => ({
      isSignedIn,
      userId: userId ?? null,
      getToken: async () => (await getToken()) ?? null
    });
    return () => {
      delete (window as unknown as Record<string, unknown>).__clerkUseAuth;
    };
  }, [isSignedIn, userId, getToken]);

  if (!isSignedIn) {
    return (
      <main className="authShell">
        <div className="authCard">
          <SignIn routing="hash" />
        </div>
      </main>
    );
  }

  // Render the app with auth state read from window.__clerkUseAuth, plus the
  // UserButton via a portal so it can appear inside App's sidebar without App
  // needing a Clerk import.
  const portal = document.getElementById("clerk-user-button-portal");

  return (
    <>
      <App />
      {portal ? createPortal(<UserButton />, portal) : null}
    </>
  );
}

export function ClerkWrapper({ publishableKey }: AuthGateProps) {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkAuthGate publishableKey={publishableKey} />
    </ClerkProvider>
  );
}

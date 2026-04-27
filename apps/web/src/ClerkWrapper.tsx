import { ClerkProvider, SignIn, UserButton, useAuth } from "@clerk/react";
import { createPortal } from "react-dom";
import { App } from "./App";

type AuthGateProps = {
  publishableKey: string;
};

function ClerkAuthGate({ publishableKey }: AuthGateProps) {
  const { isSignedIn, getToken, userId } = useAuth();

  if (!isSignedIn) {
    return (
      <main className="authShell">
        <div className="authCard">
          <SignIn routing="hash" />
        </div>
      </main>
    );
  }

  // Render the app with auth state injected, plus the UserButton via a portal
  // so it can appear inside App's sidebar without App needing a Clerk import.
  const portal = document.getElementById("clerk-user-button-portal");

  return (
    <>
      <App
        userId={userId}
        getToken={getToken}
        isSignedIn={isSignedIn}
      />
      {portal
        ? createPortal(
            <UserButton afterSignOutUrl={window.location.href} />,
            portal
          )
        : null}
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

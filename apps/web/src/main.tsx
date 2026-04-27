import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

// Lazily import the Clerk wrapper only when a publishable key is configured.
const ClerkWrapper = clerkPublishableKey
  ? lazy(() =>
      import("./ClerkWrapper").then((m) => ({ default: m.ClerkWrapper }))
    )
  : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {ClerkWrapper ? (
      <Suspense fallback={null}>
        <ClerkWrapper publishableKey={clerkPublishableKey!} />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);

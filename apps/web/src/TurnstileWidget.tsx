import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

type Props = {
  siteKey: string;
  onSuccess: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
};

export const TurnstileWidget = forwardRef<TurnstileInstance, Props>(
  function TurnstileWidget({ siteKey, onSuccess, onExpire, onError }, ref) {
    return (
      <Turnstile
        ref={ref}
        siteKey={siteKey}
        onSuccess={onSuccess}
        onExpire={onExpire}
        onError={onError}
      />
    );
  }
);

"use client";

import { useFormStatus } from "react-dom";
import { primaryButton, secondaryButton } from "./styles";

export function SubmitButton({
  label,
  pendingLabel,
  name,
  value,
  variant = "primary",
}: {
  label: string;
  pendingLabel: string;
  name?: string;
  value?: string;
  variant?: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button className={variant === "primary" ? primaryButton : secondaryButton} disabled={pending} name={name} type="submit" value={value}>
      {pending ? pendingLabel : label}
    </button>
  );
}

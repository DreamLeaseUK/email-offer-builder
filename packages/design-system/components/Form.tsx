import React, { useId } from 'react';

export interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}

/**
 * Wraps any control with label, help text and error state. Pass a render
 * function that receives the generated `id` to wire the control to the label.
 * @category Forms
 */
export function Field({ label, help, error, children }: FieldProps) {
  const id = useId();
  return (
    <div className={`dl-field${error ? ' dl-field--error' : ''}`}>
      <label className="dl-label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <span className="dl-error-text">{error}</span>
      ) : help ? (
        <span className="dl-help">{help}</span>
      ) : null}
    </div>
  );
}

/**
 * Text input styled with DreamLease tokens (green focus ring, matching the live site).
 * @category Forms
 */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="dl-input" {...props} />;
}

/**
 * Native select styled with DreamLease tokens.
 * @category Forms
 */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="dl-select" {...props} />;
}

/**
 * Multiline text input styled with DreamLease tokens (4 rows by default).
 * @category Forms
 */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="dl-textarea" rows={4} {...props} />;
}

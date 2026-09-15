import React from 'react';

export interface AlertProps {
  /** info = Skybound, warning = Flashpoint, error = Ignition, neutral = grey, success = green. */
  tone?: 'info' | 'warning' | 'error' | 'neutral' | 'success';
  title?: string;
  children: React.ReactNode;
}

/**
 * Inline message banner. Tone maps to the brand palette: info = Skybound,
 * warning = Flashpoint, error = Ignition, neutral = grey.
 * @category Feedback
 */
export function Alert({ tone = 'info', title, children }: AlertProps) {
  return (
    <div className={`dl-alert dl-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <span className="dl-alert__title">{title}</span>}
        {children}
      </div>
    </div>
  );
}

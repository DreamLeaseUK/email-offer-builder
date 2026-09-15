import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary   — CTA Green #31BD51 (the live-site conversion colour). The main CTA; use once per view.
   * secondary — dark charcoal #393838. Supporting actions.
   * outline   — green border with red label (the live-site outline pattern). Tertiary actions.
   * ghost     — text-only. Inline/low-emphasis actions.
   * reversed  — white. For use on dark (#393838) surfaces.
   */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'reversed';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * The DreamLease button. `primary` (CTA Green, matching the live site's
 * conversion buttons) is the main CTA — one per view; `secondary`/`outline`/
 * `ghost` step down the emphasis; `reversed` is for dark (#393838) surfaces.
 * Ignition Red is NOT a button colour — red is for prices, badges and links.
 * @category Actions
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'dl-btn',
    `dl-btn--${variant}`,
    size !== 'md' ? `dl-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

/**
 * Anchor styled as a button — for links that look like CTAs.
 * @category Actions
 */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cls = [
    'dl-btn',
    `dl-btn--${variant}`,
    size !== 'md' ? `dl-btn--${size}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <a className={cls} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {children}
    </a>
  );
}

import React from 'react';
import { Logo } from './Logo';
import { Button } from './Button';

export interface NavLink {
  label: string;
  href: string;
  active?: boolean;
}

/**
 * Site header: DreamLease logo, horizontal nav links (with an `active` state),
 * and a primary CTA button on the right.
 * @category Navigation
 */
export function Header({
  links,
  ctaLabel = 'Get a quote',
  onCta,
}: {
  links: NavLink[];
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <header className="dl-header">
      <Logo size={24} />
      <nav className="dl-nav">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={`dl-nav__link${l.active ? ' dl-nav__link--active' : ''}`}
          >
            {l.label}
          </a>
        ))}
      </nav>
      <Button variant="primary" size="sm" onClick={onCta}>
        {ctaLabel}
      </Button>
    </header>
  );
}

/**
 * Site footer on a dark charcoal (#393838) surface, matching the live site:
 * reversed logo, link columns, and a legal line.
 * @category Navigation
 */
export function Footer({
  columns,
  legal = `© ${new Date().getFullYear()} DreamLease. All rights reserved.`,
}: {
  columns: { heading: string; links: NavLink[] }[];
  legal?: string;
}) {
  return (
    <footer className="dl-footer">
      <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Logo size={22} variant="dark" />
        {columns.map((col) => (
          <div key={col.heading}>
            <h4 className="dl-h4" style={{ color: '#fff', marginBottom: 12 }}>
              {col.heading}
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.links.map((l) => (
                <a key={l.href} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="dl-footer__meta">{legal}</p>
    </footer>
  );
}

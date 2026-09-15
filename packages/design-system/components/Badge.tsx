import React from 'react';

export interface BadgeProps {
  /**
   * navy — dark charcoal #393838 pill, the default emphasis (tone name kept
   * for compatibility). sky — informational. orange — attention/special.
   * red — hot offers only (Ignition Red at 100%, use sparingly).
   * green — positive/availability (CTA green). grey — neutral metadata.
   * outline — quiet emphasis.
   */
  tone?: 'navy' | 'sky' | 'orange' | 'red' | 'green' | 'grey' | 'outline';
  children: React.ReactNode;
}

/**
 * Small pill for status, metadata, and offer flags. `red` is Ignition Red at
 * 100% — reserve it for hot offers.
 * @category Feedback
 */
export function Badge({ tone = 'navy', children }: BadgeProps) {
  return <span className={`dl-badge dl-badge--${tone}`}>{children}</span>;
}

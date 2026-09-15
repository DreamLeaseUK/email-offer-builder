import React from 'react';
import { Badge, BadgeProps } from './Badge';
import { Button } from './Button';

/**
 * The base surface — rounded, bordered, subtle shadow. Compose with
 * `CardMedia` and `CardBody`, or use `OfferCard` for the vehicle-offer preset.
 * @category Cards
 */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`dl-card ${className}`.trim()}>{children}</div>;
}

/**
 * 16:9 media slot at the top of a Card (image, or a positioned badge).
 * @category Cards
 */
export function CardMedia({ children }: { children?: React.ReactNode }) {
  return <div className="dl-card__media">{children}</div>;
}

/**
 * Padded content region of a Card.
 * @category Cards
 */
export function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="dl-card__body">{children}</div>;
}

export interface OfferCardProps {
  make: string;
  model: string;
  derivative?: string;
  /** Monthly price, e.g. "£299" — rendered in Ignition Red. */
  monthly: string;
  /** e.g. "48 months · 8,000 miles p.a. · £2,691 initial rental" */
  terms?: string;
  image?: React.ReactNode;
  badge?: { label: string; tone?: BadgeProps['tone'] };
  ctaLabel?: string;
  onEnquire?: () => void;
}

/**
 * Vehicle offer card — the core commercial unit of any DreamLease surface.
 * Monthly price renders in Ignition Red; badge defaults to `red` for hot offers.
 * @category Cards
 */
export function OfferCard({
  make,
  model,
  derivative,
  monthly,
  terms,
  image,
  badge,
  ctaLabel = 'View deal',
  onEnquire,
}: OfferCardProps) {
  return (
    <Card>
      <CardMedia>
        {badge && (
          <span className="dl-card__badge-slot">
            <Badge tone={badge.tone ?? 'red'}>{badge.label}</Badge>
          </span>
        )}
        {image}
      </CardMedia>
      <CardBody>
        <p className="dl-caption" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {make}
        </p>
        <h3 className="dl-h4" style={{ margin: '2px 0 4px' }}>
          {model}
        </h3>
        {derivative && <p className="dl-small">{derivative}</p>}
        <div className="dl-price" style={{ margin: '14px 0 4px' }}>
          <span className="dl-price__amount">{monthly}</span>
          <span className="dl-price__period">per month inc. VAT</span>
        </div>
        {terms && <p className="dl-price__note">{terms}</p>}
        <div style={{ marginTop: 16 }}>
          <Button variant="primary" size="sm" onClick={onEnquire}>
            {ctaLabel}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

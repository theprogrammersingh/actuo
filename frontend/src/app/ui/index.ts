/**
 * Aurora Ledger design-system layer (Design Doc §4).
 *
 * Every component here is standalone, OnPush and presentational — no HTTP, no
 * router, no business logic. Feature code composes from these rather than
 * reaching for raw utilities, so theme parity stays in one place.
 */
export { Button } from './button';
export type { ButtonSize, ButtonVariant } from './button';

export { Card } from './card';
export type { CardPadding } from './card';

export { Badge, EXPENSE_STATUS_LABEL, EXPENSE_STATUS_TONE } from './badge';
export type { BadgeTone, ExpenseStatus } from './badge';

export { Input } from './input';
export type { InputType } from './input';

export { StatCard } from './stat-card';
export type { DeltaTone } from './stat-card';

export { ProgressBar } from './progress-bar';
export type { ProgressTone } from './progress-bar';

export { Skeleton } from './skeleton';
export type { SkeletonShape } from './skeleton';

export { EmptyState } from './empty-state';
export { ErrorState } from './error-state';

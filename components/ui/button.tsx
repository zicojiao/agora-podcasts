import * as React from 'react';
import { cn } from '@/lib/utils';

type Variant = 'solid' | 'outline' | 'ghost';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const VARIANTS: Record<Variant, string> = {
  solid: 'border-2 border-ink bg-cue text-white shadow-card-sm hover:-translate-y-0.5 disabled:hover:translate-y-0',
  outline: 'border-2 border-ink bg-white text-ink shadow-card-sm hover:-translate-y-0.5',
  ghost: 'border-2 border-transparent text-ink/70 hover:border-ink hover:bg-listener',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'solid', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold',
        'transition outline-none focus-visible:ring-4 focus-visible:ring-cue/30 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

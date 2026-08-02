'use client';

import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmentierte Steuerung (Benutzerverwaltung-Brief.md §3: "Kein · Mitglied · Admin" statt
 * RadioGroup) - baut direkt auf dem rohen Radix RadioGroup-Primitiv auf (nicht der
 * vorgestylten components/ui/radio-group.tsx, deren Punkt-Optik sich nicht sinnvoll in Segmente
 * umbauen lässt) für native Tastaturbedienung (Pfeiltasten, ein Tab-Stopp) bei komplett eigener
 * Optik.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-sunken p-[3px]', className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'rounded-md px-3 py-1.5 text-[13px] font-medium text-ink-muted outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring',
            'data-[state=checked]:bg-white data-[state=checked]:font-semibold data-[state=checked]:text-ink data-[state=checked]:shadow-sm',
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

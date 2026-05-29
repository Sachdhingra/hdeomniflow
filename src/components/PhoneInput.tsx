import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { extractTenDigits } from "@/lib/phone";

interface PhoneInputProps {
  value: string;
  onChange: (tenDigits: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  error?: string;
  id?: string;
}

/**
 * Phone input with non-editable "+91" prefix.
 * The `value` is the 10-digit string only; parent stores +91 prefix on save.
 */
const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ value, onChange, placeholder = "9876543210", disabled, className, error, id }, ref) => {
    const tenDigits = extractTenDigits(value);
    return (
      <div className="w-full">
        <div className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          error && "border-destructive",
          disabled && "opacity-50",
          className,
        )}>
          <span className="inline-flex items-center px-3 text-sm font-medium text-muted-foreground bg-muted rounded-l-md border-r border-input select-none">
            +91
          </span>
          <input
            ref={ref}
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            disabled={disabled}
            value={tenDigits}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 10))}
            placeholder={placeholder}
            className="flex-1 bg-transparent px-3 py-2 text-base md:text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed rounded-r-md"
          />
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  },
);
PhoneInput.displayName = "PhoneInput";

export default PhoneInput;

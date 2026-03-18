import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateInputProps {
  value: string; // ISO string YYYY-MM-DD
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

export function DateInput({ value, onChange, id, placeholder = "MM/DD/YYYY", className }: DateInputProps) {
  const [open, setOpen] = React.useState(false);

  const dateObj = React.useMemo(() => {
    if (!value) return undefined;
    const d = parse(value, "yyyy-MM-dd", new Date());
    return isValid(d) ? d : undefined;
  }, [value]);

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"));
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            !dateObj && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {dateObj ? format(dateObj, "MM/dd/yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateObj}
          onSelect={handleSelect}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

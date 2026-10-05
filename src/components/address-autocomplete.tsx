export function AddressAutocomplete({ value, onChange, className, placeholder }: { value: string; onChange: (value: string) => void; className?: string; placeholder?: string }) {
  return (
    <input value={value} onChange={(event) => onChange(event.target.value)} className={className} placeholder={placeholder} autoComplete="street-address" />
  );
}

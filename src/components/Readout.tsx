type ReadoutProps = {
  label: string;
  value: string;
  detail?: string;
};

export function Readout({ label, value, detail }: ReadoutProps) {
  return (
    <div className="readout" role="group" aria-label={label}>
      <span>{label}</span>
      <strong aria-live="polite" aria-atomic="true">{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}
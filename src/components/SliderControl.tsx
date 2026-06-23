import { useMemo } from 'react';

type SliderControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  scale?: 'linear' | 'log';
  onChange: (value: number) => void;
  format?: (value: number) => string;
};

const defaultFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function SliderControl({
  label, value, min, max, step = 1, unit, scale = 'linear', onChange,
  format = (v) => defaultFormatter.format(v),
}: SliderControlProps) {
  const sliderMin = scale === 'log' ? Math.log10(min) : min;
  const sliderMax = scale === 'log' ? Math.log10(max) : max;
  const sliderValue = scale === 'log' ? Math.log10(value) : value;
  const sliderStep = scale === 'log' ? 0.01 : step;

  const formatted = useMemo(() => format(value), [format, value]);
  const valueText = unit ? `${formatted} ${unit}` : formatted;

  const handleChange = (rawValue: string) => {
    const parsed = Number(rawValue);
    const next = scale === 'log' ? 10 ** parsed : parsed;
    onChange(next);
  };

  return (
    <label className="control-row">
      <span className="control-header">
        <span>{label}</span>
        <strong>{formatted}{unit ? `${unit}` : ''}</strong>
      </span>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={sliderValue}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText}
        onChange={(event) => handleChange(event.target.value)}
      />
    </label>
  );
}
import React from 'react';

interface AudioSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  leftLabel?: string;
  rightLabel?: string;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
  onChange: (value: number) => void;
}

export const AudioSlider: React.FC<AudioSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  leftLabel,
  rightLabel,
  showValue = true,
  valueFormatter,
  onChange,
}) => {
  const displayValue = valueFormatter ? valueFormatter(value) : value.toString();
  const percentage = ((value - min) / (max - min)) * 100;

  const handleReset = () => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  return (
    <div className="audio-slider-container" style={{ marginBottom: 14 }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 6 
      }}>
        <span style={{ fontSize: 12, color: '#aaa' }}>{label}</span>
        {showValue && (
          <span 
            style={{ 
              fontSize: 12, 
              color: '#6b9fff',
              cursor: defaultValue !== undefined ? 'pointer' : 'default',
            }}
            onClick={handleReset}
            title={defaultValue !== undefined ? '点击重置' : undefined}
          >
            {displayValue}
          </span>
        )}
      </div>
      
      <div style={{ position: 'relative' }}>
        <input
          type="range"
          className="audio-slider-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            width: '100%',
            height: 4,
            appearance: 'none',
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #333 ${percentage}%, #333 100%)`,
            borderRadius: 2,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </div>

      {(leftLabel || rightLabel) && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          marginTop: 4 
        }}>
          <span style={{ fontSize: 10, color: '#666' }}>{leftLabel}</span>
          <span style={{ fontSize: 10, color: '#666' }}>{rightLabel}</span>
        </div>
      )}

      <style>{`
        .audio-slider-input::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
          transition: transform 0.1s;
        }
        .audio-slider-input::-webkit-slider-thumb:hover {
          transform: scale(1.15);
        }
        .audio-slider-input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          background: #fff;
          border-radius: 50%;
          cursor: pointer;
          border: none;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
      `}</style>
    </div>
  );
};


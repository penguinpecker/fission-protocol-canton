import { Line, LineChart, ResponsiveContainer, YAxis, XAxis, Tooltip } from 'recharts';

interface Point { t: number; rate: number; }

interface Props {
  points: Point[];
  height?: number;
  color?: string;
}

export function Sparkline({ points, height = 56, color = 'var(--ink)' }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points}>
        <Line
          type="monotone"
          dataKey="rate"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <YAxis hide domain={['dataMin - 0.001', 'dataMax + 0.001']} />
        <XAxis hide dataKey="t" />
        <Tooltip
          contentStyle={{
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
          }}
          labelFormatter={(v) => new Date(v).toLocaleDateString()}
          formatter={(v: number) => [v.toFixed(6), 'rate']}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
